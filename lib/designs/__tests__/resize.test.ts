import assert from "node:assert/strict";
import { test } from "node:test";
import { dragLength, formatLength, resized, stretch } from "../resize";

const bed = { width: 1.8, height: 1.1, depth: 2.1 };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test("dragging the width handle 15 cm out makes the bed 30 cm wider (centre anchored)", () => {
  close(dragLength(bed, "width", 1, 0.15), 2.1);
  close(dragLength(bed, "width", -1, -0.15), 2.1); // the opposite handle moved outwards the other way
  close(dragLength(bed, "height", 1, 0.1), 1.2); // height grows up from the floor only
});

test("independent resize changes one axis; proportional keeps the shape", () => {
  const wide = resized(bed, "width", 2.1, false);
  assert.deepEqual(wide, { width: 2.1, height: 1.1, depth: 2.1 });
  assert.ok(stretch(wide, bed) > 1.1);
  const big = resized(bed, "width", 2.1, true);
  close(big.width, 2.1);
  close(big.height, 1.1 * (2.1 / 1.8));
  close(stretch(big, bed), 1);
});

test("no negative, inverted or tiny sizes, and the limit keeps proportions", () => {
  assert.equal(resized(bed, "depth", -3, false).depth, 0.05);
  const tiny = resized(bed, "width", -1, true);
  close(tiny.height, 0.05); // the smallest axis stops at the minimum
  close(stretch(tiny, bed), 1);
  assert.equal(resized(bed, "height", 0.02, false, 0.3).height, 0.3); // configurable minimum
  close(resized(bed, "width", 500, true).depth, 50);
});

test("labels in m or cm", () => {
  assert.equal(formatLength(2.1, "m"), "2.10 m");
  assert.equal(formatLength(2.1, "cm"), "210 cm");
});
