import { test } from "node:test";
import assert from "node:assert/strict";
import { doorFit, doorways } from "../doorFit";

test("door fit: too big is refused, a little smaller fits, much smaller leaves a gap", () => {
  const opening = { width: 0.9, height: 2.1 };
  assert.equal(doorFit({ width: 0.95, height: 2.0 }, opening).status, "too_big");
  assert.equal(doorFit({ width: 0.9, height: 2.2 }, opening).status, "too_big");
  assert.equal(doorFit({ width: 0.85, height: 2.05 }, opening).status, "fits");
  assert.deepEqual(doorFit({ width: 0.7, height: 2.05 }, opening), { status: "gap", wide: 20, tall: 5 });
});

test("doorways measure each door opening; the height is capped by the ceiling", () => {
  const [d] = doorways({ height: 2.0, doors: [{ id: "d1", start: [0, 0], end: [0.8, 0], thickness: 0.15 }] });
  assert.equal(d.id, "d1");
  assert.ok(Math.abs(d.width - 0.8) < 1e-9);
  assert.equal(d.height, 2.0);
});
