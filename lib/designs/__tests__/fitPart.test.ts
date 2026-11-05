import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, BoxGeometry, Vector3 } from "three";
import { fitInto } from "../../vendor/fitPart";

test("a part variant takes exactly the replaced part's place and size", () => {
  const variant = new BoxGeometry(2, 4, 1).translate(5, 5, 5); // authored elsewhere, at another size
  const part = new Box3(new Vector3(-0.3, 0, -0.2), new Vector3(0.3, 0.45, 0.2)); // a leg's box in its mesh
  const fitted = fitInto(variant, part);
  const box = fitted.boundingBox!;
  for (const axis of ["x", "y", "z"] as const) {
    assert.ok(Math.abs(box.min[axis] - part.min[axis]) < 1e-6 && Math.abs(box.max[axis] - part.max[axis]) < 1e-6, axis);
  }
  variant.computeBoundingBox();
  assert.equal(variant.boundingBox!.min.x, 4); // the loaded variant is not changed (it is shared by every part using it)
});
