import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { buildGeometry, componentDef, fit, suggested, type Probe, type Surroundings } from "../../vendor/parts3d";
import { movedBox } from "../../vendor/reconstruct";
import { withDirection, withHinge, type PartAnimation } from "../../vendor/animation";

/** No doors: the compartment is open at the structure's front. */
const open = (whole: Box3): Surroundings => ({ front: () => ({ z: whole.max.z, part: null }), sweeps: [] });

/** An open cabinet built from real boards (no front): 1.0 wide, 2.0 high, 0.6 deep, a fixed shelf at 1.0 m. */
function cabinet() {
  const model = new Group();
  const board = (id: string, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d).translate(x, y, z), new MeshStandardMaterial());
    mesh.name = id;
    model.add(mesh);
  };
  board("left", 0.02, 2, 0.6, -0.49, 1, 0);
  board("right", 0.02, 2, 0.6, 0.49, 1, 0);
  board("bottom", 0.96, 0.02, 0.6, 0, 0.01, 0);
  board("top", 0.96, 0.02, 0.6, 0, 1.99, 0);
  board("back", 0.96, 1.96, 0.01, 0, 1, -0.295);
  board("shelf", 0.96, 0.02, 0.58, 0, 1.0, 0.01);
  model.updateMatrixWorld(true);
  const ray = new Raycaster();
  // Like the editor's picker: the model's own coordinates in, world rays out (the model may be turned).
  const probe: Probe = (origin, direction) => {
    model.updateMatrixWorld(true);
    const from = origin.clone().applyMatrix4(model.matrixWorld);
    ray.set(from, origin.clone().add(direction).applyMatrix4(model.matrixWorld).sub(from).normalize());
    const hit = ray.intersectObjects(model.children, false)[0];
    return hit ? { distance: hit.distance, partId: hit.object.name } : null;
  };
  return { model, probe, whole: new Box3().setFromObject(model) };
}
const mpu = new Vector3(1, 1, 1); // the model is in metres
const onBack = (y: number) => ({ point: new Vector3(0.1, y, -0.29), normal: new Vector3(0, 0, 1), partId: "back" });
const close = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

test("a shelf dropped in a compartment fits its inside width and depth, at the drop height, between the side panels", () => {
  const { probe, whole } = cabinet();
  const f = fit(componentDef("shelf")!, onBack(1.5), probe, open(whole), mpu);
  assert.equal(f.valid, true, f.reason);
  assert.ok(close(f.size[0], 0.96 - 0.004) && close(f.size[1], 0.018) && close(f.size[2], 0.59 - 0.01), JSON.stringify(f.size));
  assert.ok(close(f.center[0], 0) && close(f.center[1], 1.5));
  assert.ok(close(f.center[2] - f.size[2] / 2, -0.29)); // against the back panel
});

test("a divider spans its own compartment's height (up to the fixed shelf), a drawer sits on the floor flush at the front", () => {
  const { probe, whole } = cabinet();
  const divider = fit(componentDef("divider")!, onBack(0.5), probe, open(whole), mpu);
  assert.ok(divider.valid && close(divider.size[1], 1.0 - 0.02 - 0.01 - 0.01 + 0.01, 0.02), JSON.stringify(divider));
  assert.ok(divider.center[1] + divider.size[1] / 2 <= 0.99 + 1e-6); // stops under the shelf
  const drawer = fit(componentDef("drawer")!, onBack(0.5), probe, open(whole), mpu);
  assert.ok(drawer.valid, drawer.reason);
  assert.ok(close(drawer.center[1] - drawer.size[1] / 2, 0.02)); // on the bottom board
  assert.ok(close(drawer.center[2] + drawer.size[2] / 2, whole.max.z)); // flush with the open front
  assert.ok(close(drawer.size[1], 0.18));
});

test("a door closes the opening it is dropped in; handles go on fronts, legs underneath; outside the object is refused", () => {
  const { probe, whole } = cabinet();
  const door = fit(componentDef("door")!, onBack(1.5), probe, open(whole), mpu);
  assert.ok(door.valid && close(door.size[0], 0.96) && close(door.size[1], 0.97) && close(door.center[2], whole.max.z + 0.009), JSON.stringify(door));
  const outside = fit(componentDef("shelf")!, { point: new Vector3(3, 1, 0), normal: new Vector3(0, 0, 1), partId: null }, probe, open(whole), mpu);
  assert.equal(outside.valid, false);
  assert.match(outside.reason!, /compartment/);
  const handle = fit(componentDef("handle")!, { point: new Vector3(0.3, 1.2, 0.31), normal: new Vector3(0, 0, 1), partId: "door_1" }, probe, open(whole), mpu);
  assert.ok(handle.valid && handle.parent === "door_1" && handle.center[2] > 0.31);
  const leg = fit(componentDef("leg")!, { point: new Vector3(0.4, 0, 0.2), normal: new Vector3(0, -1, 0), partId: "bottom" }, probe, open(whole), mpu);
  assert.ok(leg.valid && leg.center[1] < 0);
  assert.equal(fit(componentDef("leg")!, onBack(1), probe, open(whole), mpu).valid, false);
});

test("too little space is refused; boards stay 18 mm thick at any model scale; the gallery suits the object", () => {
  const { probe, whole } = cabinet();
  const tiny = fit(componentDef("drawer")!, { point: new Vector3(0.1, 1.5, -0.29), normal: new Vector3(0, 0, 1), partId: "back" }, probe, open(whole), new Vector3(0.05, 0.05, 0.05));
  assert.equal(tiny.valid, false); // the model shown 20× smaller: the compartment is 5 cm wide
  const g = buildGeometry({ type: "drawer", size: [0.6, 0.2, 0.45] }, new Vector3(0.5, 0.5, 0.5));
  g.computeBoundingBox();
  assert.ok(close(g.boundingBox!.max.x - g.boundingBox!.min.x, 0.6)); // its outer width is the size given
  assert.ok(suggested("Wardrobe (kids)").fits.some((d) => d.type === "rod"));
  assert.ok(suggested("dining table").fits.some((d) => d.type === "leg") && !suggested("dining table").fits.some((d) => d.type === "drawer" && false));
});

/** The bug: a shelf ran out to an OPENED door. Doors are not structure: the rays never see them, and the opening ends
 * at the back of the closed door (its rest position), whatever the door shows now. */
test("a shelf behind a door (open or closed) ends at the closed door's back face, never at the open door; a turned model measures the same", () => {
  for (const turn of [0, 0.9]) {
    const { model, probe } = cabinet();
    model.rotation.y = turn; // the model turned in the room: placement is in its own coordinates
    model.updateMatrixWorld(true);
    // The closed door's place (rest): in front of the compartment, 1.8 cm thick, its back at z = 0.30.
    const doorRest = new Box3(new Vector3(-0.48, 1.01, 0.3), new Vector3(0.48, 1.98, 0.318));
    const door: PartAnimation = withHinge({ id: "a", component: "door", follow: [], label: "Door", type: "rotation", axis: "y", unit: "degrees", duration: 0.8, enabled: true, source: "vision", issues: [], to: 95 }, "left", doorRest);
    const around: Surroundings = {
      front: (x0, x1, y0, y1) => (doorRest.min.x <= x1 && doorRest.max.x >= x0 && doorRest.min.y <= y1 && doorRest.max.y >= y0 ? { z: doorRest.min.z, part: "door" } : { z: 0.3, part: null }),
      sweeps: [{ label: "Door", boxes: [0.25, 0.5, 0.75, 1].map((t) => movedBox({ ...door, to: door.to! * t }, doorRest)) }],
    };
    const shelf = fit(componentDef("shelf")!, onBack(1.5), probe, around, mpu);
    assert.ok(shelf.valid, shelf.reason);
    assert.ok(close(shelf.center[2] + shelf.size[2] / 2, 0.29, 0.002), `ends 1 cm behind the door's back: ${JSON.stringify(shelf)}`);
    assert.ok(close(shelf.size[0], 0.956) && close(shelf.center[0], 0)); // between the side panels
    assert.equal(fit(componentDef("door")!, onBack(1.5), probe, around, mpu).valid, false); // already has a door
  }
});

test("existing parts bound the space or block it; a drawer's slide path and an unknown front refuse the drop", () => {
  const { model, probe, whole } = cabinet();
  // A divider in the upper compartment: a shelf dropped left of it spans only to it.
  const divider = new Mesh(new BoxGeometry(0.018, 0.97, 0.58).translate(0.1, 1.495, -0.0), new MeshStandardMaterial());
  divider.name = "divider";
  model.add(divider);
  model.updateMatrixWorld(true);
  const left = fit(componentDef("shelf")!, { point: new Vector3(-0.2, 1.5, -0.29), normal: new Vector3(0, 0, 1), partId: "back" }, probe, open(whole), mpu);
  assert.ok(left.valid && left.center[0] + left.size[0] / 2 <= 0.091 && left.center[0] - left.size[0] / 2 >= -0.481, JSON.stringify(left));
  // A drawer below would slide through a shelf put in its way.
  const drawerRest = new Box3(new Vector3(-0.47, 0.02, -0.25), new Vector3(0.47, 0.3, 0.3));
  const slide = withDirection({ id: "d", component: "drawer", follow: [], label: "Drawer", type: "translation", axis: "z", unit: "meters", duration: 0.6, enabled: true, source: "vision", issues: [] } as PartAnimation, "front", 0.4);
  const around: Surroundings = { ...open(whole), sweeps: [{ label: "Drawer", boxes: [drawerRest, movedBox(slide, drawerRest)] }] };
  const inWay = fit(componentDef("shelf")!, onBack(0.2), probe, around, mpu);
  assert.equal(inWay.valid, false);
  assert.match(inWay.reason!, /in the way of Drawer/);
  // Nothing known about the front (no door, no structure there, the front ray meets nothing): not placed.
  const unknown = fit(componentDef("shelf")!, onBack(1.5), probe, { front: () => null, sweeps: [] }, mpu);
  assert.equal(unknown.valid, false);
  assert.match(unknown.reason!, /could not be measured/);
});

import { blocker, carryChildren, resizeTo, specBox, type AddedSpec } from "../../vendor/parts3d";

test("dragging a shelf's right edge widens it from its left edge and stops at the inside wall", () => {
  const { probe } = cabinet();
  const shelf: AddedSpec = { id: "s", type: "shelf", size: [0.5, 0.018, 0.5], center: [-0.23, 1.5, -0.04] };
  const room = new Box3(new Vector3(-0.48, 1.01, -0.29), new Vector3(0.48, 1.98, 0.3));
  const def = componentDef("shelf")!;
  const wider = resizeTo(shelf, 0, 1, 0.2, def, mpu, room, (b) => blocker(b, probe));
  assert.ok(close(specBox(wider.spec).min.x, -0.48) && close(specBox(wider.spec).max.x, 0.2) && wider.blocked === null, JSON.stringify(wider));
  const past = resizeTo(shelf, 0, 1, 0.9, def, mpu, room, (b) => blocker(b, probe));
  assert.ok(close(specBox(past.spec).max.x, 0.48) && close(specBox(past.spec).min.x, -0.48)); // stops at the wall
  assert.match(past.blocked!, /wall/);
  assert.ok(close(past.spec.size[1], 0.018) && close(past.spec.center[1], 1.5)); // height and the other faces unchanged
});

test("a drag into a neighbouring part stops just before it; limits hold; handles ride along on a resized door", () => {
  const { model, probe } = cabinet();
  const post = new Mesh(new BoxGeometry(0.02, 0.97, 0.58).translate(0.1, 1.495, 0), new MeshStandardMaterial());
  post.name = "divider";
  model.add(post);
  model.updateMatrixWorld(true);
  const shelf: AddedSpec = { id: "s", type: "shelf", size: [0.4, 0.018, 0.5], center: [-0.25, 1.5, -0.04] };
  const r = resizeTo(shelf, 0, 1, 0.45, componentDef("shelf")!, mpu, null, (b) => blocker(b, probe));
  assert.ok(specBox(r.spec).max.x <= 0.09 + 1e-3 && specBox(r.spec).max.x > 0.085, JSON.stringify(specBox(r.spec)));
  assert.ok(r.blocked);
  const tiny = resizeTo(shelf, 0, -1, -0.05, componentDef("shelf")!, mpu, null, () => null);
  assert.ok(close(tiny.spec.size[0], 0.1)); // never below the shelf's minimum width
  const door: AddedSpec = { id: "d", type: "door", size: [0.5, 1.2, 0.018], center: [0, 1, 0.31] };
  const handle: AddedSpec = { id: "h", type: "handle", size: [0.12, 0.014, 0.03], center: [0.2, 1.2, 0.334], parent: "d" };
  const bigger: AddedSpec = { ...door, size: [0.6, 1.2, 0.018], center: [0.05, 1, 0.31] };
  const [, moved] = carryChildren([door, handle], door, bigger);
  assert.ok(close(moved.center[0], 0.29) && close(moved.center[1], 1.2) && close(moved.center[2], 0.334));
});

test("a quarter-turned component keeps its sizes along the model's axes", () => {
  const g = buildGeometry({ type: "door", size: [0.018, 1.2, 0.5], rotation: 90 }, mpu);
  g.computeBoundingBox();
  const s = g.boundingBox!.getSize(new Vector3());
  assert.ok(close(s.x, 0.018 + 0.025, 0.03) && close(s.y, 1.2) && close(s.z, 0.5, 0.03), JSON.stringify(s));
});

import { moveTo, offsetsOf, withOffset } from "../../vendor/parts3d";

test("a shelf's Top Offset: 30 cm, dragged 10 cm down becomes 40 cm, typed 50 cm puts it exactly there, never past the floor", () => {
  const room = new Box3(new Vector3(-0.18, 1.0, -0.22), new Vector3(0.18, 1.65, 0.22)); // the compartment, inside faces
  const shelf: AddedSpec = { id: "s", type: "shelf", size: [0.36, 0.02, 0.44], center: [0, 1.65 - 0.3 - 0.01, 0] };
  assert.ok(close(offsetsOf(shelf, room).top, 0.3));
  const down = moveTo(shelf, 1, shelf.center[1] - 0.1, room, () => null);
  assert.ok(close(offsetsOf(down.spec, room).top, 0.4) && down.blocked === null);
  const typed = withOffset(down.spec, "top", 0.5, room, () => null);
  assert.ok(close(offsetsOf(typed.spec, room).top, 0.5));
  assert.ok(close(offsetsOf(typed.spec, room).bottom, 0.65 - 0.5 - 0.02)); // the bottom offset follows
  const tooFar = withOffset(shelf, "top", 0.9, room, () => null);
  assert.ok(close(offsetsOf(tooFar.spec, room).bottom, 0) && /wall/.test(tooFar.blocked!)); // stops on the floor
});

test("a move into another part stops just before it; a divider is measured from the sides", () => {
  const { probe } = cabinet();
  const room = new Box3(new Vector3(-0.48, 1.01, -0.29), new Vector3(0.48, 1.98, 0.3));
  const shelf: AddedSpec = { id: "s", type: "shelf", size: [0.95, 0.018, 0.5], center: [0, 1.5, -0.04] };
  const toTop = moveTo(shelf, 1, 2.5, room, (b) => blocker(b, probe));
  assert.ok(close(specBox(toTop.spec).max.y, 1.98)); // under the top board, not through it
  const divider: AddedSpec = { id: "d", type: "divider", size: [0.018, 0.97, 0.5], center: [0.1, 1.495, -0.04] };
  const o = offsetsOf(divider, room);
  assert.ok(close(o.left, 0.571) && close(o.right, 0.371));
});

import { choosePart } from "../../vendor/parts3d";

test("a click selects the right part: a shelf behind an open door, an added part flush on a wall, never a hidden one", () => {
  const h = (id: string, distance: number, extra: Partial<{ added: boolean; open: boolean; visible: boolean }> = {}) => ({ id, distance, added: false, open: false, visible: true, ...extra });
  // Open door in front, the added shelf in the compartment behind it, then the back wall.
  assert.equal(choosePart([h("door", 1, { open: true }), h("shelf", 1.4, { added: true }), h("back", 1.7)], 0.002), "shelf");
  // A closed door still covers what is behind it.
  assert.equal(choosePart([h("door", 1), h("shelf", 1.4, { added: true })], 0.002), "door");
  // Flush against the wall (same depth): the added shelf, not the wall.
  assert.equal(choosePart([h("side", 1.2), h("shelf", 1.2005, { added: true })], 0.002), "shelf");
  // An open door with only structure behind: the door itself (to paint it, close it…).
  assert.equal(choosePart([h("door", 1, { open: true }), h("back", 1.7)], 0.002), "door");
  // Hidden parts never take the click.
  assert.equal(choosePart([h("ghost", 0.5, { visible: false, added: true }), h("side", 1.2)], 0.002), "side");
  assert.equal(choosePart([], 0.002), null);
});
