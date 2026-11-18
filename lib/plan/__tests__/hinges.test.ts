import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { applyAnimations, faceOf, refine, withHinge, type PartAnimation } from "../../vendor/animation";

/** A cabinet (in `model`) with parts given as [id, name, size, centre]. */
function cabinet(parts: [string, string, [number, number, number], [number, number, number]][], model = new Group()) {
  const slots = parts.map(([id, name, s, c]) => {
    const mesh = new Mesh(new BoxGeometry(...s).translate(...c), new MeshStandardMaterial());
    mesh.name = id;
    model.add(mesh);
    return { id, name, mesh };
  });
  model.updateMatrixWorld(true);
  return { model, slots };
}
const BODY: [string, string, [number, number, number], [number, number, number]] = ["body", "Cabinet body", [1.2, 2, 0.6], [0, 1, 0]];

/** Where the door's free edge goes when it opens (world coordinates), and the door's animation. */
function swing(parts: Parameters<typeof cabinet>[0], doorId = "door", wrap?: (g: Group) => Group) {
  const model = new Group();
  const root = wrap ? wrap(model) : model;
  const { slots } = cabinet(parts, model);
  root.updateMatrixWorld(true);
  const config = refine(null, slots, model)!;
  const anim = config.animations.find((a) => a.component === doorId)!;
  const door = slots.find((s) => s.id === doorId)!.mesh;
  const before = new Box3().setFromObject(door).getCenter(new Vector3());
  applyAnimations(slots, model, config, { [anim.id]: 1 });
  root.updateMatrixWorld(true);
  return { anim, moved: new Box3().setFromObject(door).getCenter(new Vector3()).sub(before), slots, config };
}

test("a handle on the right hinges the door on the left, and it swings out in front, not into the body", () => {
  const { anim, moved } = swing([BODY, ["door", "Door", [0.58, 1.8, 0.02], [-0.3, 1, 0.31]], ["h", "Door handle", [0.02, 0.2, 0.03], [-0.06, 1, 0.335]]]);
  assert.equal(anim.hinge, "left");
  assert.equal(anim.face, "front");
  assert.ok(moved.z > 0.2, `out in front: ${moved.z}`);
});

test("a centred moulding does not outvote the handle, and hinge hardware wins over everything", () => {
  const door: [string, string, [number, number, number], [number, number, number]] = ["door", "Door", [0.58, 1.8, 0.02], [-0.3, 1, 0.31]];
  const moulding: typeof door = ["m1", "Part 7", [0.15, 0.15, 0.01], [-0.3, 1.6, 0.325]];
  const moulding2: typeof door = ["m2", "Part 8", [0.15, 0.15, 0.01], [-0.3, 0.4, 0.325]];
  const knob: typeof door = ["k", "Part 9", [0.03, 0.03, 0.03], [-0.55, 1, 0.335]]; // on the left
  assert.equal(swing([BODY, door, moulding, moulding2, knob]).anim.hinge, "right");
  const hinges: typeof door[] = [["g1", "Upper hinge", [0.02, 0.06, 0.02], [-0.05, 1.7, 0.33]], ["g2", "Lower hinge", [0.02, 0.06, 0.02], [-0.05, 0.3, 0.33]]];
  assert.equal(swing([BODY, door, knob, ...hinges]).anim.hinge, "right"); // hinges on the right: it turns there
});

test("a door on the back of a cabinet opens backwards, and one on its side opens sideways", () => {
  const back = swing([BODY, ["door", "Door", [0.58, 1.8, 0.02], [0.3, 1, -0.31]], ["h", "Door handle", [0.02, 0.2, 0.03], [0.06, 1, -0.335]]]);
  assert.equal(back.anim.face, "back");
  assert.ok(back.moved.z < -0.2, `out behind: ${back.moved.z}`);
  const side = swing([BODY, ["door", "Door", [0.02, 1.8, 0.56], [0.61, 1, 0]], ["h", "Door handle", [0.03, 0.2, 0.02], [0.635, 1, 0.22]]]);
  assert.equal(side.anim.face, "right");
  assert.ok(side.moved.x > 0.2, `out to the side: ${side.moved.x}`);
});

test("a z-up file the viewer stands up: its door still opens out to the front", () => {
  const zUp = (model: Group) => {
    const orient = new Group();
    orient.rotation.x = -Math.PI / 2; // the file's +z is up, its −y the front
    orient.add(model);
    const fit = new Group();
    fit.name = "fit";
    fit.add(orient);
    return new Group().add(fit);
  };
  // In the file: body 1.2 wide (x), 0.6 deep (y, front at −y), 2 tall (z); the door on the front face (y = −0.31).
  const { anim, moved } = swing([["body", "Cabinet body", [1.2, 0.6, 2], [0, 0, 1]], ["door", "Door", [0.58, 0.02, 1.8], [-0.3, -0.31, 1]], ["h", "Door handle", [0.02, 0.03, 0.2], [-0.06, -0.335, 1]]], "door", zUp);
  assert.equal(anim.up, "front"); // the world's up is the file's +z (named "front" in y-up terms)
  assert.equal(anim.face, "down"); // and the door faces the file's −y
  assert.equal(anim.hinge, "left");
  assert.ok(moved.z > 0.2, `out in front in the world: ${moved.z}`);
  assert.ok(Math.abs(moved.y) < 0.05, "it turns about the vertical, not over");
});

test("a whole drawer box faces the front it is flush with, and a lid on top lifts up", () => {
  const whole = new Box3(new Vector3(-0.6, 0, -0.3), new Vector3(0.6, 2, 0.3));
  const frame = { up: "up" as const, front: "front" as const };
  assert.equal(faceOf(new Box3(new Vector3(-0.3, 0.1, -0.25), new Vector3(0.25, 0.34, 0.3)), whole, frame), "front"); // 55 × 24 × 55
  assert.equal(faceOf(new Box3(new Vector3(-0.6, 1.98, -0.3), new Vector3(0.6, 2, 0.3)), whole, frame), "up");
  const lid = withHinge({ id: "l", component: "lid", follow: [], label: "Lid", type: "rotation", axis: "x", unit: "degrees", duration: 0.8, enabled: true, source: "names", issues: [], to: 80, face: "up" }, "back", new Box3(new Vector3(-0.6, 1.98, -0.3), new Vector3(0.6, 2, 0.3)));
  assert.deepEqual([lid.axis, lid.pivot, lid.to], ["x", [0, 2, -0.3], -80]); // the back top edge; the front lifts
});

test("with nothing to go by, the hinge side is a flagged guess the vendor can change, and the change keeps the frame", () => {
  const { anim } = swing([BODY, ["door", "Door", [0.58, 1.8, 0.02], [0.3, 1, -0.31]]]);
  assert.match(anim.reason ?? "", /guess/);
  assert.ok((anim.confidence ?? 1) <= 0.5 && anim.enabled);
  const other = withHinge(anim as PartAnimation, anim.hinge === "left" ? "right" : "left", new Box3(new Vector3(0.01, 0.1, -0.32), new Vector3(0.59, 1.9, -0.3)));
  assert.equal(other.face, "back");
  assert.equal(Math.sign(other.to!), -Math.sign(anim.to!)); // the other edge turns the other way, still outwards
});

test("under a mirrored, unevenly scaled, turned parent the door stays upright on a fixed hinge and swings out", () => {
  const odd = (model: Group) => {
    const orient = new Group();
    orient.scale.set(-1, 1.5, 0.8); // mirrored on x, stretched
    orient.add(model);
    const fit = new Group();
    fit.name = "fit";
    fit.add(orient);
    const room = new Group(); // placed in a room, turned 30°
    room.rotation.y = Math.PI / 6;
    return room.add(fit);
  };
  const model = new Group();
  const root = odd(model);
  const { slots } = cabinet([BODY, ["door", "Door", [0.58, 1.8, 0.02], [-0.3, 1, 0.31]], ["h", "Door handle", [0.02, 0.2, 0.03], [-0.06, 1, 0.335]]], model);
  root.updateMatrixWorld(true);
  const config = refine(null, slots, model)!;
  const anim = config.animations[0];
  const door = slots.find((s) => s.id === "door")!.mesh;
  const corner = (y: number) => door.localToWorld(new Vector3(-0.59, y, 0.32)); // on the hinge edge (handle at −0.06)
  const free = () => door.localToWorld(new Vector3(-0.01, 1, 0.31));
  const [hingeLow, hingeHigh, freeBefore] = [corner(0.1), corner(1.9), free()];
  const up = hingeHigh.clone().sub(hingeLow).normalize();
  const out = new Vector3(0, 0, 1).applyQuaternion(root.quaternion); // the model's front in the room
  const rest = { p: door.position.clone(), q: door.quaternion.clone() };
  for (const t of [0.3, 0.7, 1]) {
    door.position.copy(rest.p);
    door.quaternion.copy(rest.q);
    applyAnimations(slots, model, config, { [anim.id]: t });
    root.updateMatrixWorld(true);
    assert.ok(corner(0.1).distanceTo(hingeLow) < 1e-4 && corner(1.9).distanceTo(hingeHigh) < 1e-4, `the hinge edge stays put at ${t}`);
    const vertical = door.localToWorld(new Vector3(-0.3, 1.9, 0.31)).sub(door.localToWorld(new Vector3(-0.3, 0.1, 0.31))).normalize();
    assert.ok(vertical.dot(up) > 0.9999, `upright at ${t}`);
  }
  assert.ok(free().sub(freeBefore).dot(out) > 0.2, "the free edge came out to the front");
  assert.ok(Math.abs(anim.to!) <= 110);
});

test("the handle is found from the geometry: the part standing out furthest and longest, open or closed; none on a flat door", async () => {
  const { handleOf } = await import("../../vendor/animation");
  const make = (w: number, h: number, d: number, at: [number, number, number], parent?: Group) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d).translate(...at), new MeshStandardMaterial());
    (parent ?? new Group()).add(mesh);
    return mesh;
  };
  const room = new Group();
  const door = make(0.39, 1.26, 0.014, [0.4, 1.15, 0.224]);
  room.add(door.parent!);
  const parts = [
    { id: "pull", mesh: make(0.014, 0.13, 0.01, [0.24, 1.14, 0.261]), name: "Part 7" }, // no name to go by
    { id: "foot", mesh: make(0.012, 0.012, 0.018, [0.24, 1.09, 0.248]), name: "Part 8" },
    { id: "lock", mesh: make(0.024, 0.024, 0.004, [0.24, 1.02, 0.243]), name: "Part 9" },
    { id: "key", mesh: make(0.016, 0.016, 0.002, [0.24, 1.0, 0.26]), name: "Part 10" },
    { id: "surround", mesh: make(0.28, 0.087, 0.01, [0.4, 1.73, 0.235]), name: "Part 11" },
  ];
  for (const p of parts) door.parent!.attach(p.mesh); // on the door: they turn with it
  room.updateMatrixWorld(true);
  assert.equal(handleOf(door, parts)?.id, "pull");
  // Swung open (the door and what is on it turned together): still the pull.
  door.parent!.rotation.y = 1.4;
  room.updateMatrixWorld(true);
  assert.equal(handleOf(door, parts)?.id, "pull");
  // Only flush trim on it: no handle (its icon goes on the door, never on a wrong mesh).
  assert.equal(handleOf(door, [{ id: "trim", mesh: make(0.3, 0.02, 0.004, [0.4, 1.7, 0.229], door.parent as Group) }]), null);
  // A name saying handle adds weight, never instead of the geometry.
  assert.equal(handleOf(door, [...parts, { id: "knob", mesh: make(0.02, 0.02, 0.025, [0.5, 1.14, 0.243], door.parent as Group), name: "Door knob" }])?.id, "pull");
});
