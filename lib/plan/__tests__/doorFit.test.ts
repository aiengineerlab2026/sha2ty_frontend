import { test } from "node:test";
import assert from "node:assert/strict";
import { doorFit, doorPose, doorways, isDoorModel, raiseLintel } from "../doorFit";
import { localWarnings, rotateY } from "../placementValidation";
import type { PlacedItem, PlanGeometry } from "../types";

test("door fit: too big is refused, a little smaller fits, much smaller leaves a gap", () => {
  const opening = { width: 0.9, height: 2.1 };
  assert.equal(doorFit({ width: 0.95, height: 2.0 }, opening).status, "too_big");
  assert.equal(doorFit({ width: 0.9, height: 2.2 }, opening).status, "too_big");
  assert.equal(doorFit({ width: 0.85, height: 2.05 }, opening).status, "fits");
  assert.deepEqual(doorFit({ width: 0.7, height: 2.05 }, opening), { status: "gap", wide: 20, tall: 5, over: -5, raised: false });
});

test("doorways measure each door opening; the height is capped by the ceiling", () => {
  const [d] = doorways({ height: 2.0, doors: [{ id: "d1", start: [0, 0], end: [0.8, 0], thickness: 0.15 }] });
  assert.equal(d.id, "d1");
  assert.ok(Math.abs(d.width - 0.8) < 1e-9);
  assert.equal(d.height, 2.0);
});

test("a door model stands in the doorway's middle with its width along the wall", () => {
  for (const [start, end] of [
    [[2, 3], [2.9, 3]], // wall along x
    [[5, 1], [5, 1.8]], // wall along z
    [[1, 1], [1.6, 1.6]], // diagonal wall
  ] as [[number, number], [number, number]][]) {
    const pose = doorPose({ start, end });
    assert.deepEqual([pose.x, pose.z], [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]);
    const along = rotateY(1, 0, pose.yaw);
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
    assert.ok(Math.abs(along.x - (end[0] - start[0]) / len) < 0.02 && Math.abs(along.z - (end[1] - start[1]) / len) < 0.02);
  }
});

test("a fitted door is not reported outside the rooms (it stands in the wall gap)", () => {
  const geometry = { rooms: [{ id: "r", name: "Hall", polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] }], height: 3 } as unknown as PlanGeometry;
  const door = { instanceId: "d", title: "Oak door", category: "door", x: 2, z: 1, rotation_y: 90, width_m: 0.9, height_m: 2.05, depth_m: 0.05 } as PlacedItem;
  assert.deepEqual(localWarnings(door, geometry, []), []);
  assert.notDeepEqual(localWarnings({ ...door, category: "furniture" }, geometry, []), []); // a sofa there would be
});

test("a door taller than the 2.1 m cut fits under a 3 m ceiling and raises the wall above it", () => {
  const [opening] = doorways({ height: 3, doors: [{ id: "o0", start: [0, 0], end: [0.8, 0] }] });
  const tall = doorFit({ width: 0.72, height: 2.38 }, opening);
  assert.equal(tall.status, "fits"); // 8 cm narrower than the opening: fits with a gap
  assert.ok(tall.raised);
  assert.equal(doorFit({ width: 0.72, height: 3.1 }, opening).status, "too_big"); // above the ceiling
  const walls = [
    { id: "o0-lintel", start: [0, 0], end: [0.8, 0], thickness: 0.2, height: 0.9, elevation: 2.1 },
    { id: "w1", start: [0.8, 0], end: [3, 0], thickness: 0.2, height: 3 },
  ] as Parameters<typeof raiseLintel>[0];
  const raised = raiseLintel(walls, "o0", 2.38, 3);
  assert.deepEqual([raised[0].elevation, Number(raised[0].height.toFixed(2))], [2.38, 0.62]);
  assert.equal(raised[1], walls[1]);
  assert.equal(raiseLintel(walls, "o0", 3, 3).length, 1); // door up to the ceiling: no wall left above it
});

test("doors are recognised by category or by name", () => {
  assert.ok(isDoorModel({ category: "door", title: "Oak" }));
  assert.ok(isDoorModel({ category: "furniture", title: "Door" }));
  assert.ok(isDoorModel({ category: "furniture", title: "باب خشب" }));
  assert.ok(!isDoorModel({ category: "wardrobe", title: "Wardrobe with doors" })); // other categories: only by category
  assert.ok(!isDoorModel({ category: "furniture", title: "Cabinet with two doors" })); // a piece of furniture with doors
  assert.ok(!isDoorModel({ category: "furniture", title: "Outdoor bench" }));
});
