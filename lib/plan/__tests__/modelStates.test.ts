import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { alignLike, normalizeModel } from "../modelNormalization";

/** A 1.2 × 1.8 × 0.5 m carcass; open, its door stands out 0.6 m in front (a wider, deeper box). */
function wardrobe(open: boolean) {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(1.2, 1.8, 0.5).translate(0, 0.9, 0), new MeshStandardMaterial());
  body.name = "wardrobe_body";
  const door = new Mesh(open ? new BoxGeometry(0.018, 1.6, 0.6).translate(-0.6, 0.9, 0.55) : new BoxGeometry(0.6, 1.6, 0.018).translate(-0.3, 0.9, 0.26), new MeshStandardMaterial());
  door.name = "door_left";
  group.add(body, door);
  return group;
}

const boxOf = (root: Group, name: string) => {
  root.updateMatrixWorld(true);
  return new Box3().setFromObject(root.getObjectByName(name)!, true);
};

test("the open state takes the closed state's scale and origin, not a fit of its own bigger box", () => {
  const target = { width: 1.5, height: 2.25, depth: 0.6 }; // the catalogue size: scaled up from the file
  const closed = normalizeModel(wardrobe(false), target).object;
  const open = alignLike(wardrobe(true), closed);
  const a = boxOf(closed, "wardrobe_body");
  const b = boxOf(open, "wardrobe_body");
  assert.ok(a.min.distanceTo(b.min) < 1e-9 && a.max.distanceTo(b.max) < 1e-9, "the carcass is exactly where it is when closed");
  // Fitted on its own, the open file would shrink to squeeze its door into the catalogue box.
  const fitted = boxOf(normalizeModel(wardrobe(true), target).object, "wardrobe_body");
  assert.ok(fitted.getSize(new Vector3()).z < a.getSize(new Vector3()).z - 0.1); // squeezed in depth
  // The door really stands out in front of the closed footprint.
  assert.ok(boxOf(open, "door_left").max.z > a.max.z + 0.3);
});
