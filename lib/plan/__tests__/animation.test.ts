import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { animationClips, applyAnimations, boxInModel, problems, step, withDirection, withHinge, type AnimationConfig, type PartAnimation } from "../../vendor/animation";

/** A 1 × 2 × 0.6 cabinet with a left door on its front, placed in a room: scaled, turned and moved. */
function cabinet() {
  const room = new Group();
  room.position.set(3, 0, -2);
  room.rotation.y = 0.7;
  room.scale.setScalar(1.5);
  const model = new Group();
  room.add(model);
  const body = new Mesh(new BoxGeometry(1, 2, 0.6).translate(0, 1, 0), new MeshStandardMaterial());
  const door = new Mesh(new BoxGeometry(0.5, 1.6, 0.02).translate(-0.25, 1.1, 0.31), new MeshStandardMaterial());
  model.add(body, door);
  room.updateMatrixWorld(true);
  const slots = [{ id: "body", mesh: body }, { id: "door_left", mesh: door }];
  return { room, model, body, door, slots };
}

const door = (box: Box3): PartAnimation =>
  withHinge({ id: "a1", component: "door_left", follow: [], label: "Left door", type: "rotation", axis: "y", unit: "degrees", duration: 0.8, enabled: true, source: "vision", issues: [], to: 90 }, "left", box);

test("a left door turns 90° outwards about its own left edge, rigidly, wherever the model stands", () => {
  const { model, door: mesh, slots } = cabinet();
  const anim = door(boxInModel(mesh, model));
  assert.deepEqual(anim.pivot, [-0.5, 1.1, 0.32]);
  assert.equal(anim.to, -90); // outwards: towards +z
  const before = boxInModel(mesh, model);
  applyAnimations(slots, model, { version: 1, movable: true, animations: [anim], flagged: [] }, { a1: 1 });
  model.updateMatrixWorld(true);
  const after = boxInModel(mesh, model);
  // Turned about the hinge: now as deep as the door was wide, standing out in front, the hinge edge where it was.
  assert.ok(Math.abs(after.max.z - (0.32 + 0.5)) < 1e-6 && Math.abs(after.min.x - -0.5) < 0.03, JSON.stringify(after));
  const size = (b: Box3) => b.getSize(new Vector3());
  assert.ok(Math.abs(size(after).y - size(before).y) < 1e-9); // rigid: same height
  assert.ok(Math.abs(mesh.scale.x - 1) < 1e-12); // scale never changes
});

test("a drawer slides by its distance; zero open leaves the model untouched; the whole model never moves", () => {
  const { model, door: mesh, body, slots } = cabinet();
  const slide = withDirection(door(boxInModel(mesh, model)), "front", 0.3);
  const config: AnimationConfig = { version: 1, movable: true, animations: [slide], flagged: [] };
  const z0 = boxInModel(mesh, model).max.z;
  applyAnimations(slots, model, config, { a1: 0 });
  assert.equal(boxInModel(mesh, model).max.z, z0);
  applyAnimations(slots, model, config, { a1: 0.5 });
  assert.ok(Math.abs(boxInModel(mesh, model).max.z - (z0 + 0.15)) < 1e-6);
  assert.deepEqual(problems({ ...slide, component: "body" }, [{ id: "body", mesh: body }]), ["The model is one mesh: moving it would move the whole object."]);
  assert.deepEqual(problems({ ...slide, component: "door_left" }, [...slots, { id: "handle", mesh }]), ["This part shares one mesh with other parts: they would move with it."]);
  assert.deepEqual(problems({ ...slide, component: "ghost" }, slots), ["This part is not in the model."]);
  applyAnimations(slots, model, { ...config, answer: "no" }, { a1: 1 }); // "no movable parts": nothing moves
  assert.ok(Math.abs(boxInModel(mesh, model).max.z - (z0 + 0.15)) < 1e-6);
});

test("opening and closing step at the animation's speed, forwards and in reverse", () => {
  const anim = { id: "a", enabled: true, duration: 0.5 } as PartAnimation;
  const config = { version: 1, movable: true, animations: [anim], flagged: [] } as AnimationConfig;
  const now = { a: 0 };
  assert.equal(step(now, { a: 1 }, config, 0.25), true);
  assert.equal(now.a, 0.5);
  step(now, { a: 1 }, config, 1);
  assert.equal(now.a, 1);
  assert.equal(step(now, { a: 1 }, config, 0.1), false); // settled
  step(now, { a: 0 }, config, 0.25);
  assert.equal(now.a, 0.5);
});

test("the exported clip starts at rest and ends open, on the door's own node", () => {
  const { model, door: mesh, slots } = cabinet();
  const anim = door(boxInModel(mesh, model));
  const [clip] = animationClips(slots, model, { version: 1, movable: true, animations: [anim], flagged: [] });
  assert.equal(clip.name, "open_door_left");
  assert.deepEqual(clip.tracks.map((t) => t.name), [`${mesh.uuid}.position`, `${mesh.uuid}.quaternion`]);
  const q = clip.tracks[1].values;
  assert.deepEqual([...q.slice(0, 4)], [0, 0, 0, 1]); // rest
  assert.ok(Math.abs(Math.abs(q[q.length - 3]) - Math.sin(Math.PI / 4)) < 1e-6); // 90° about y at the end
  assert.equal(animationClips(slots, model, { version: 1, movable: true, animations: [{ ...anim, enabled: false }], flagged: [] }).length, 0);
});

import { animationOf, moverKind, refine } from "../../vendor/animation";

/** Built from parts named only by number (as the built wardrobe and Meshy name them): body, a pair of doors with a
 * knob each on the meeting side, a single door with its knob on the left, two drawers with handles, a shelf inside. */
function wardrobe() {
  const model = new Group();
  const part = (id: string, w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(new BoxGeometry(w, h, d).translate(x, y, z), new MeshStandardMaterial());
    mesh.name = id;
    model.add(mesh);
    return { id, name: id, mesh };
  };
  const slots = [
    part("wardrobe_body", 2.0, 2.2, 0.6, 0, 1.1, 0),
    part("door_1", 0.6, 1.5, 0.02, -0.7, 1.4, 0.31), part("door_2", 0.6, 1.5, 0.02, -0.1, 1.4, 0.31), part("door_3", 0.6, 1.5, 0.02, 0.6, 1.4, 0.31),
    part("handle_1", 0.03, 0.03, 0.03, -0.45, 1.3, 0.335), part("handle_2", 0.03, 0.03, 0.03, -0.35, 1.3, 0.335), part("handle_3", 0.03, 0.03, 0.03, 0.4, 1.3, 0.335),
    part("drawer_1", 0.9, 0.25, 0.02, -0.5, 0.3, 0.31), part("drawer_2", 0.9, 0.25, 0.02, 0.5, 0.3, 0.31),
    part("handle_4", 0.2, 0.02, 0.03, -0.5, 0.35, 0.335), part("handle_5", 0.2, 0.02, 0.03, 0.5, 0.35, 0.335),
    part("shelf_1", 1.9, 0.02, 0.5, 0, 1.2, 0),
  ];
  model.updateMatrixWorld(true);
  return { model, slots };
}

test("every door and drawer is found, hinged from its geometry, with its handle moving along", () => {
  const { model, slots } = wardrobe();
  // What the backend saved for the built wardrobe: doors without a side, switched off as uncertain.
  const saved: AnimationConfig = { version: 1, movable: true, flagged: [{ label: "door_1", component: "door_1", reason: "Uncertain" }], animations: [
    { id: "anim_door_1", component: "door_1", follow: [], label: "Door 1", type: "rotation", axis: "y", hinge: "left", pivot: [0, 0, 0], from: 0, to: -95, unit: "degrees", duration: 0.8, enabled: false, confidence: 0.4, source: "names", issues: ["Uncertain"] },
  ] };
  const config = refine(saved, slots, model)!;
  const by = Object.fromEntries(config.animations.map((a) => [a.component, a]));
  assert.deepEqual(Object.keys(by).sort(), ["door_1", "door_2", "door_3", "drawer_1", "drawer_2"]); // no limit of two, nothing else
  assert.equal(by.door_1.hinge, "left"); // knob on its right: hinged on the left
  assert.equal(by.door_2.hinge, "right"); // the other leaf of the pair
  assert.equal(by.door_3.hinge, "right"); // knob on its left
  assert.ok(config.animations.every((a) => a.enabled && !a.issues.length), JSON.stringify(config.animations.map((a) => [a.component, a.issues])));
  assert.deepEqual(by.door_1.pivot, [-1, 1.4, 0.32]);
  assert.deepEqual(by.door_1.follow, ["handle_1"]);
  assert.deepEqual(by.drawer_1.follow, ["handle_4"]);
  assert.equal(by.drawer_1.type, "translation");
  assert.ok(!by.door_1.follow.includes("shelf_1")); // inside, behind the door: stays
  assert.deepEqual(config.flagged, []); // resolved
  assert.equal(animationOf(config, "handle_3")?.component, "door_3"); // a click on a handle opens its door
  assert.equal(animationOf(config, "shelf_1"), null);
});

test("names in any language and object type; handles, frames and static objects are not movable", () => {
  assert.equal(moverKind("Left Door")?.motion, "rotate");
  assert.equal(moverKind("باب 3")?.motion, "rotate");
  assert.equal(moverKind("درج 1")?.motion, "slide");
  assert.equal(moverKind("Desk drawer")?.motion, "slide");
  assert.equal(moverKind("Chest lid")?.motion, "lift");
  assert.equal(moverKind("fall_front_flap")?.motion, "fold");
  assert.equal(moverKind("Door handle"), null);
  assert.equal(moverKind("مقبض 2"), null);
  assert.equal(moverKind("Tabletop"), null);
  const table = new Group();
  const legs = [0, 1].map((i) => { const m = new Mesh(new BoxGeometry(0.05, 0.7, 0.05).translate(i, 0.35, 0), new MeshStandardMaterial()); table.add(m); return { id: `leg_${i}`, name: "Leg", mesh: m }; });
  const top = new Mesh(new BoxGeometry(1.2, 0.04, 0.6).translate(0.5, 0.72, 0), new MeshStandardMaterial());
  table.add(top);
  table.updateMatrixWorld(true);
  const config = refine(null, [...legs, { id: "top", name: "Tabletop", mesh: top }], table)!;
  assert.equal(config.movable, false);
  assert.deepEqual(config.animations, []);
});

import { Matrix4 } from "three";
import { attachedTo, attachmentsFrom } from "../../vendor/animation";

/** A door with what is fixed on it: an arch panel almost as big as the door, a knob, a trim strip; a shelf behind it,
 * and a small "door" that is really a moulding on the big one (a mis-split). */
function doorAssembly() {
  const model = new Group();
  const add = (id: string, name: string, g: BoxGeometry) => {
    const mesh = new Mesh(g, new MeshStandardMaterial());
    mesh.name = id;
    model.add(mesh);
    return { id, name, mesh };
  };
  const slots = [
    add("body", "Body", new BoxGeometry(1.2, 2, 0.6).translate(0, 1, 0)),
    add("door", "Door", new BoxGeometry(0.58, 1.8, 0.02).translate(-0.3, 1, 0.31)),
    add("decor_1", "Decor 1", new BoxGeometry(0.5, 1.6, 0.01).translate(-0.3, 1, 0.325)), // the arch panel: 77% of the door
    add("knob", "Part 7", new BoxGeometry(0.03, 0.03, 0.03).translate(-0.05, 1, 0.335)),
    add("trim", "Part 8", new BoxGeometry(0.58, 0.02, 0.012).translate(-0.3, 1.89, 0.326)),
    add("small_door", "Door ornament door", new BoxGeometry(0.2, 0.2, 0.01).translate(-0.3, 1.5, 0.335)), // named "door", rides on it
    add("shelf", "Part 9", new BoxGeometry(1.1, 0.02, 0.5).translate(0, 1, 0)), // behind the door: not on it
    add("rail", "Part 10", new BoxGeometry(0.5, 0.02, 0.02).translate(-0.3, 1.7, 0.2)), // inside: not on it
  ];
  model.updateMatrixWorld(true);
  return { model, slots };
}

test("decorations, handles and trim are one assembly with their door; structure and misclassified doors are sorted out", () => {
  const { model, slots } = doorAssembly();
  const config = refine(null, slots, model)!;
  assert.deepEqual(config.animations.map((a) => a.component), ["door"]); // the ornament is not a door of its own
  const door = config.animations[0];
  assert.deepEqual([...door.follow].sort(), ["decor_1", "knob", "small_door", "trim"]);
  assert.equal(door.hinge, "left"); // the knob is on its right
});

test("every part of an assembly keeps its exact place on the door, forwards and back, with no drift or scale change", () => {
  const { model, slots } = doorAssembly();
  const config = refine(null, slots, model)!;
  const mesh = (id: string) => slots.find((s) => s.id === id)!.mesh;
  const relative = (id: string) => new Matrix4().copy(mesh("door").matrixWorld).invert().multiply(mesh(id).matrixWorld);
  const before = ["decor_1", "knob", "trim", "small_door"].map(relative);
  const rest = slots.map((s) => [s.mesh.position.clone(), s.mesh.quaternion.clone()] as const);
  for (const t of [0.3, 1, 0.6, 0]) {
    slots.forEach((s, i) => { s.mesh.position.copy(rest[i][0]); s.mesh.quaternion.copy(rest[i][1]); }); // the rest pose (applyPoses)
    applyAnimations(slots, model, config, { [config.animations[0].id]: t });
    model.updateMatrixWorld(true);
    ["decor_1", "knob", "trim", "small_door"].map(relative).forEach((m, i) => assert.ok(m.equals(before[i]) || m.toArray().every((v, k) => Math.abs(v - before[i].elements[k]) < 1e-9), `part ${i} moved on the door at t=${t}`));
    assert.ok(mesh("shelf").position.equals(rest[6][0])); // structure never moves
    assert.ok(slots.every((s) => Math.abs(s.mesh.scale.x - 1) < 1e-12));
  }
  // Closed again: exactly where it started.
  assert.ok(mesh("door").position.distanceTo(rest[1][0]) < 1e-12 && mesh("door").quaternion.angleTo(rest[1][1]) < 1e-9);
});

test("overlap alone is not attachment; the vision analysis' 'attached to' joins a part to its moving parent", () => {
  const door = new Box3(new Vector3(-0.6, 0.1, 0.3), new Vector3(0, 1.9, 0.32));
  assert.equal(attachedTo(door, new Box3(new Vector3(-0.5, 0.9, 0), new Vector3(-0.1, 0.92, 0.5)), 0.6), false); // a shelf through it
  assert.equal(attachedTo(door, new Box3(new Vector3(-0.5, 0.2, 0.32), new Vector3(-0.1, 1.8, 0.33)), 0.6), true); // a panel on it
  assert.equal(attachedTo(door, new Box3(new Vector3(-0.5, 0.2, 0.45), new Vector3(-0.1, 1.8, 0.46)), 0.6), false); // floating in front
  const rel = attachmentsFrom({
    components: [{ id: "p1", analysisId: "door_left" }, { id: "p2", analysisId: "glass" }],
    analysis: { components: [{ id: "glass", relations: [{ type: "attached_to", target: "door_left" }] }, { id: "door_left", relations: [] }] },
  });
  assert.deepEqual(rel, { p2: "p1" });
  const { model, slots } = doorAssembly();
  const config = refine(null, slots, model, { rail: "door", shelf: "door" })!; // the shelf is structural: never
  assert.ok(config.animations[0].follow.includes("rail") === false); // "rail" is structural by name too (a hanging rail)
  assert.ok(!config.animations[0].follow.includes("shelf"));
});

test("Arabic part words match whole words only: a decoration (زخرفة) is not a shelf (رف), a step (درجة) is not a drawer (درج)", () => {
  assert.equal(moverKind("زخرفة 1"), null);
  assert.equal(moverKind("درجة 2"), null);
  assert.equal(moverKind("الدرج العلوي")?.motion, "slide");
  assert.equal(moverKind("الباب الأيسر")?.motion, "rotate");
  // The real built wardrobe: its arch panels (زخرفة) ride on their doors.
  const model = new Group();
  const add = (id: string, name: string, min: number[], max: number[]) => {
    const g = new BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]).translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const mesh = new Mesh(g, new MeshStandardMaterial());
    model.add(mesh);
    return { id, name, mesh };
  };
  const slots = [
    add("wardrobe_body", "هيكل الدولاب", [-1.1, 0, -0.28], [1.1, 2.55, 0.28]),
    add("door_1", "باب 1", [-0.702, 0.081, 0.262], [-0.297, 2.073, 0.28]),
    add("decor_1", "زخرفة 1", [-0.654, 0.13, 0.28], [-0.346, 2.024, 0.282]),
    add("handle_1", "مقبض 1", [-0.361, 1.063, 0.28], [-0.333, 1.091, 0.305]),
    add("shelf_1", "رف 1", [-1.081, 0.478, -0.269], [-0.724, 0.496, 0.257]),
  ];
  model.updateMatrixWorld(true);
  const door = refine(null, slots, model)!.animations.find((a) => a.component === "door_1")!;
  assert.deepEqual([...door.follow].sort(), ["decor_1", "handle_1"]);
});

import { Quaternion } from "three";
import { carried } from "../../vendor/animation";

test("a moved, turned and resized part carries its handle: same place on it, same turn, own size — also in a non-uniformly scaled model", () => {
  for (const outerScale of [new Vector3(1, 1, 1), new Vector3(1.4, 0.8, 2.1)]) {
    const root = new Group();
    root.scale.copy(outerScale); // the model stretched (resized by the customer, not proportionally)
    const door = new Mesh(new BoxGeometry(0.6, 1.8, 0.02), new MeshStandardMaterial());
    const handle = new Mesh(new BoxGeometry(0.03, 0.03, 0.03), new MeshStandardMaterial());
    door.position.set(-0.3, 1, 0.31);
    handle.position.set(-0.05, 1, 0.335);
    root.add(door, handle);
    root.updateMatrixWorld(true);
    const rest = (m: Mesh) => ({ position: m.position.clone(), quaternion: m.quaternion.clone(), scale: m.scale.clone() });
    const doorRest = rest(door), handleRest = rest(handle);
    // The handle in the door's own frame, at rest.
    const local = (h: { position: Vector3 }, d: { position: Vector3; quaternion: Quaternion; scale: Vector3 }) =>
      h.position.clone().applyMatrix4(new Matrix4().compose(d.position, d.quaternion, d.scale).invert());
    const before = local(handleRest, doorRest);
    // Moved 10 cm, turned 30° about y, made 20% wider.
    const now = { position: new Vector3(-0.2, 1, 0.31), quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 6), scale: new Vector3(1.2, 1, 1) };
    const to = carried(doorRest, now, root.matrixWorld, handleRest, root.matrixWorld);
    assert.ok(local(to, now).distanceTo(before) < 1e-9, "the handle keeps its place on the door");
    assert.ok(to.quaternion.angleTo(now.quaternion) < 1e-9, "turned with the door");
    assert.ok(to.scale.equals(handleRest.scale), "its own size, not stretched");
    // No drift: back to rest puts it exactly where it was.
    const back = carried(doorRest, doorRest, root.matrixWorld, handleRest, root.matrixWorld);
    assert.ok(back.position.distanceTo(handleRest.position) < 1e-12 && back.quaternion.angleTo(handleRest.quaternion) < 1e-12);
  }
});

test("lock, key and trim parts named after their door are accessories, not doors", () => {
  for (const name of ["Right door lock key ring", "door lock dangling key blade", "Left door lock key tooth", "Mirror door backing", "Mirror surround bottom", "Drawer box (Drawer 1)", "Interior (Door 1)", "قفل الباب", "مفتاح الدرج"]) assert.equal(moverKind(name), null, name);
  for (const name of ["Left light wood grain door", "Mirror door", "Glass door", "Lower drawer"]) assert.ok(moverKind(name), name);
});





test("a handle on mounting feet and a key hanging from its lock ride with their door, not the door beside it", () => {
  const model = new Group();
  const add = (id: string, g: BoxGeometry) => {
    const mesh = new Mesh(g, new MeshStandardMaterial());
    mesh.name = id;
    model.add(mesh);
    return { id, name: id.replace(/_/g, " "), mesh };
  };
  const slots = [
    add("body", new BoxGeometry(1.2, 2, 0.5).translate(0, 1, 0)),
    add("left_door", new BoxGeometry(0.58, 1.8, 0.02).translate(-0.3, 1, 0.26)),
    add("right_door", new BoxGeometry(0.58, 1.8, 0.02).translate(0.3, 1, 0.26)),
    // Left door: feet glued on, the pull 3 cm out held only by the feet; a lock with a key and a ring hanging below.
    add("left_door_handle_mounting_foot", new BoxGeometry(0.015, 0.015, 0.03).translate(-0.05, 1.1, 0.285)),
    add("left_door_handle_mounting_foot_2", new BoxGeometry(0.015, 0.015, 0.03).translate(-0.05, 0.9, 0.285)),
    add("left_door_handle_pull", new BoxGeometry(0.02, 0.25, 0.015).translate(-0.05, 1, 0.307)),
    add("left_door_lock_escutcheon", new BoxGeometry(0.03, 0.04, 0.005).translate(-0.05, 0.8, 0.2725)),
    add("left_door_lock_inserted_key", new BoxGeometry(0.006, 0.03, 0.02).translate(-0.05, 0.8, 0.285)),
    add("left_door_lock_key_ring", new BoxGeometry(0.02, 0.02, 0.004).translate(-0.05, 0.775, 0.296)),
    // Right door: its own pull on feet.
    add("right_door_handle_mounting_foot", new BoxGeometry(0.015, 0.015, 0.03).translate(0.05, 1.1, 0.285)),
    add("right_door_handle_pull", new BoxGeometry(0.02, 0.25, 0.015).translate(0.05, 1, 0.307)),
  ];
  model.updateMatrixWorld(true);
  const config = refine(null, slots, model)!;
  const follow = (id: string) => [...config.animations.find((a) => a.component === id)!.follow].sort();
  assert.deepEqual(follow("left_door"), ["left_door_handle_mounting_foot", "left_door_handle_mounting_foot_2", "left_door_handle_pull", "left_door_lock_escutcheon", "left_door_lock_inserted_key", "left_door_lock_key_ring"]);
  assert.deepEqual(follow("right_door"), ["right_door_handle_mounting_foot", "right_door_handle_pull"]);
});

test("a narrow glazed door of a wide wardrobe opens with its glass; a doorway's frame around a leaf stays put", () => {
  const model = new Group();
  const add = (id: string, name: string, g: BoxGeometry) => {
    const mesh = new Mesh(g, new MeshStandardMaterial());
    mesh.name = id;
    model.add(mesh);
    return { id, name, mesh };
  };
  const slots = [
    add("body", "Main carcass", new BoxGeometry(2.9, 2.7, 0.6).translate(0, 1.35, 0)),
    // 0.38 m of a 2.9 m front: ~6 % of the front, a door by its shape
    add("glazed_frame", "Left glazed door frame", new BoxGeometry(0.38, 1.8, 0.03).translate(0.2, 1.1, 0.315)),
    add("glass", "Left door glass panel", new BoxGeometry(0.3, 1.7, 0.01).translate(0.2, 1.1, 0.32)),
  ];
  model.updateMatrixWorld(true);
  const config = refine(null, slots, model)!;
  assert.deepEqual(config.animations.map((a) => a.component), ["glazed_frame"]);
  assert.ok(config.animations[0].follow.includes("glass") && config.animations[0].enabled);

  const doorway = new Group();
  const frame = new Mesh(new BoxGeometry(1, 2.2, 0.1).translate(0, 1.1, 0), new MeshStandardMaterial());
  const leaf = new Mesh(new BoxGeometry(0.9, 2.1, 0.04).translate(0, 1.05, 0.02), new MeshStandardMaterial());
  doorway.add(frame, leaf);
  doorway.updateMatrixWorld(true);
  const d = refine(null, [{ id: "frame", name: "Door frame", mesh: frame }, { id: "leaf", name: "Door leaf", mesh: leaf }], doorway)!;
  assert.deepEqual(d.animations.map((a) => a.component), ["leaf"]);
});
