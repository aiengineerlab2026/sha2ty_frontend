import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWalls, polygonFromSides, wallsProblem } from "../roomSize";

const lengths = (poly: [number, number][]) => poly.map((p, i) => {
  const q = poly[(i + 1) % poly.length];
  return Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]) * 1000) / 1000;
});

test("each value is one wall, in order around the room", () => {
  assert.deepEqual(parseWalls("4 × 14 × 16 × 17"), [4, 14, 16, 17]);
  assert.deepEqual(parseWalls("3,5*4x5"), [3.5, 4, 5]);
  assert.equal(parseWalls("4*a"), null);
  assert.equal(wallsProblem([4, 5]), "few");
  assert.equal(wallsProblem([1, 1, 5]), "open");
});

test("the outline has exactly those wall lengths, and is not forced to a rectangle", () => {
  for (const sides of [[4, 14, 16, 17], [4, 5, 4, 5], [3, 4, 5], [2, 2, 3, 3, 2, 6], [1, 1, 1.9]]) {
    assert.deepEqual(lengths(polygonFromSides(sides)), sides);
  }
  const square = polygonFromSides([4, 4, 4, 4]);
  assert.deepEqual(square, [[0, 0], [4, 0], [4, 4], [0, 4]]);
});

test("every corner of a closed room gets a post, sharp ones too", async () => {
  const { wallJoints } = await import("../wallJoints");
  const poly = polygonFromSides([3, 4, 5]);
  const walls = poly.map((p, i) => ({ start: p, end: poly[(i + 1) % poly.length], thickness: 0.2, height: 2.8 }));
  const joints = wallJoints(walls);
  assert.equal(joints.length, 3);
  assert.ok(joints.every((j) => j.outline.length >= 3 && j.height === 2.8));
});

test("closure is checked: impossible walls are refused, a flat sliver too", async () => {
  const { closes } = await import("../roomSize");
  assert.equal(wallsProblem([2, 3, 10]), "open"); // the last wall cannot reach the first
  assert.equal(wallsProblem([5, 5, 9.95]), "open"); // closes only as a flat sliver
  for (const sides of [[3, 4, 5], [4, 5, 4, 5], [4, 14, 16, 17], [2, 7, 3, 6, 4]]) assert.ok(closes(polygonFromSides(sides), sides));
  assert.equal(closes([[0, 0], [4, 0], [4, 4], [0, 4]], [4, 4, 4, 5]), false);
});
