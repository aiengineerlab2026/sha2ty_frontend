import assert from "node:assert/strict";
import { test } from "node:test";
import { walkStart } from "../walkStart";
import type { PlanGeometry } from "../types";

// Living (0–4) | dining (4–8) along X, depth 4. Door A: living↔outside at z=0; door B: dining↔outside at z=4.
const zone = (id: string, kind: string, x0: number): NonNullable<PlanGeometry["zones"]>[number] =>
  ({ id, kind, polygon: [[x0, 0], [x0 + 4, 0], [x0 + 4, 4], [x0, 4]], label_point: [x0 + 2, 2] }) as never;

test("walk starts inside the dining entrance door, facing into dining", () => {
  const g = {
    rooms: [],
    zones: [zone("l", "living", 0), zone("d", "dining", 4)],
    doors: [
      { start: [1, 0], end: [2, 0], thickness: 0.2 },
      { start: [6, 4], end: [7, 4], thickness: 0.2 },
    ],
  } as unknown as PlanGeometry;
  const { position, yaw } = walkStart(g, [0, 0]);
  assert.ok(Math.abs(position[0] - 6.5) < 1e-9 && Math.abs(position[1] - 3.4) < 1e-9, `${position}`);
  // facing −Z (into the room from the z=4 wall): yaw 0
  assert.ok(Math.abs(yaw) < 1e-9, `${yaw}`);
});

test("no doors: dining centre", () => {
  const g = { rooms: [], zones: [zone("l", "living", 0), zone("d", "dining", 4)], doors: [] } as unknown as PlanGeometry;
  assert.deepEqual(walkStart(g, [0, 0]).position, [6, 2]);
});

test("walk can start in a chosen room: at its door, facing in", () => {
  const g = {
    rooms: [],
    zones: [zone("l", "living", 0), zone("d", "dining", 4)],
    doors: [
      { start: [1, 0], end: [2, 0], thickness: 0.2 },
      { start: [6, 4], end: [7, 4], thickness: 0.2 },
    ],
  } as unknown as PlanGeometry;
  const { position, yaw } = walkStart(g, [0, 0], "l");
  assert.ok(Math.abs(position[0] - 1.5) < 1e-9 && Math.abs(position[1] - 0.6) < 1e-9, `${position}`);
  assert.ok(Math.abs(Math.abs(yaw) - Math.PI) < 1e-9, `${yaw}`); // facing +Z, into the living room
});

import { cameraForView } from "../coordinateSystem";

test("3D camera frames the whole apartment: a bigger plan puts the camera further away", () => {
  const dist = (w: number, d: number) => {
    const { position: p, target: t } = cameraForView("perspective", w, d, 2.7, 50);
    return Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
  };
  const radius = Math.hypot(10, 6, 2.7) / 2;
  assert.ok(dist(10, 6) >= radius / Math.sin((25 * Math.PI) / 180)); // sphere fits the 50° view
  assert.ok(dist(20, 12) > 1.9 * dist(10, 6));
});

test("front and side views look at the plan centre from the south and the east", () => {
  const front = cameraForView("front", 10, 6, 2.8);
  const side = cameraForView("side", 10, 6, 2.8);
  assert.equal(front.position[0], front.target[0]); // straight on, no sideways offset
  assert.ok(front.position[2] > 6); // south of the plan (+z)
  assert.equal(side.position[2], side.target[2]);
  assert.ok(side.position[0] > 10); // east of the plan (+x)
});
