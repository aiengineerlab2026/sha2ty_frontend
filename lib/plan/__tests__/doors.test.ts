import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { boxInModel, poseAt, refine, shownOpen, targetFor, toParentOf, type AnimationConfig, type PartAnimation } from "../../vendor/animation";
import { blocksPartIcon, checkMovers } from "../../vendor/reconstruct";
import { catalogModelView } from "../catalogView";

type Slot = { id: string; name: string; mesh: Mesh };

function panel(id: string, name: string, size: [number, number, number], at: [number, number, number], swing = 0, hinge: "left" | "right" = "left"): Slot {
  const [w, h, d] = size;
  const geo = new BoxGeometry(w, h, d);
  geo.translate(hinge === "left" ? w / 2 : -w / 2, 0, 0);
  const mesh = new Mesh(geo, new MeshStandardMaterial({ color: "#c8a27a" }));
  mesh.name = name;
  mesh.position.set(at[0] + (hinge === "left" ? -w / 2 : w / 2), at[1], at[2]);
  mesh.rotation.y = swing;
  return { id, name, mesh };
}

function wardrobe(extra: Slot[] = [], open: string[] = []) {
  const model = new Group();
  const bodyMesh = new Mesh(new BoxGeometry(2, 2.2, 0.6), new MeshStandardMaterial());
  bodyMesh.name = "Carcass";
  bodyMesh.position.set(0, 1.1, 0);
  const body: Slot = { id: "body", name: "Carcass", mesh: bodyMesh };
  const doors: [string, string, number][] = [
    ["far_left", "Far left door", -0.75],
    ["inner_left", "Left inner door", -0.25],
    ["inner_right", "Right inner door", 0.25],
    ["far_right", "Far right door", 0.75],
  ];
  const doorSlots = doors.map(([id, name, x]) => panel(id, name, [0.46, 1.9, 0.02], [x, 1.1, 0.32], open.includes(id) ? -25 * Math.PI / 180 : 0, x < 0 ? "left" : "right"));
  const slots = [body, ...doorSlots, ...extra];
  for (const s of slots) model.add(s.mesh);
  model.updateMatrixWorld(true);
  return { model, slots };
}

function ready(slots: Slot[], model: Group, saved?: AnimationConfig | null) {
  return checkMovers(refine(saved ?? null, slots, model), slots, model)!;
}

function depthAt(slot: Slot, model: Group, anim: PartAnimation, t: number) {
  const rest = { position: slot.mesh.position.clone(), quaternion: slot.mesh.quaternion.clone(), scale: slot.mesh.scale.clone() };
  const pivot = new Vector3(...(anim.pivot ?? [0, 0, 0]));
  const toModel = () => model.matrixWorld.clone().invert().multiply(slot.mesh.matrixWorld);
  const onHinge = pivot.clone().applyMatrix4(toModel().invert());
  const posed = poseAt(rest, anim, t, toParentOf(slot.mesh, model));
  slot.mesh.position.copy(posed.position);
  slot.mesh.quaternion.copy(posed.quaternion);
  slot.mesh.updateMatrixWorld(true);
  const depth = boxInModel(slot.mesh, model).getSize(new Vector3()).z;
  const hingeMoved = onHinge.clone().applyMatrix4(toModel()).distanceTo(pivot);
  slot.mesh.position.copy(rest.position);
  slot.mesh.quaternion.copy(rest.quaternion);
  slot.mesh.updateMatrixWorld(true);
  return { depth, hingeMoved };
}

test("a closed wardrobe with four doors gives each door its own control", () => {
  const { model, slots } = wardrobe();
  const config = ready(slots, model);
  const doors = config.animations.filter((a) => a.component !== "body");
  assert.equal(doors.length, 4);
  assert.ok(doors.every((a) => a.enabled && a.type === "rotation" && a.face === "front"), JSON.stringify(doors.map((a) => [a.component, a.enabled, a.face, a.issues])));
  assert.ok(doors.every((a) => a.rest !== "open"));
});

test("two doors modelled open can close back onto the cabinet and open again", () => {
  const { model, slots } = wardrobe([], ["inner_left", "inner_right"]);
  const config = ready(slots, model);
  for (const id of ["inner_left", "inner_right"]) {
    const anim = config.animations.find((a) => a.component === id)!;
    const slot = slots.find((s) => s.id === id)!;
    assert.equal(anim.enabled, true, JSON.stringify(anim.issues));
    assert.equal(anim.rest, "open");
    const open = depthAt(slot, model, anim, 0);
    const shut = depthAt(slot, model, anim, 1);
    assert.ok(open.depth > 0.12, `open depth ${open.depth}`);
    assert.ok(shut.depth < 0.08, `shut depth ${shut.depth} to=${anim.to}`);
    assert.ok(shut.hingeMoved < 0.02, `hinge moved ${shut.hingeMoved}`);
    assert.equal(shownOpen(anim, 0), true);
    assert.equal(shownOpen(anim, targetFor(anim, false)), false);
    assert.equal(targetFor(anim, true), 0);
  }
  const closed = config.animations.filter((a) => a.component === "far_left" || a.component === "far_right");
  assert.ok(closed.every((a) => a.enabled && a.rest !== "open"));
});

test("an open mirrored door with no handle still has one control and keeps its mirror", () => {
  const door = panel("mirror_door", "Open mirrored door", [0.46, 1.9, 0.02], [-0.4, 1.1, 0.32], -28 * Math.PI / 180, "left");
  const mirror = panel("mirror_door_mirror", "Door mirror", [0.4, 1.7, 0.004], [-0.4, 1.1, 0.336], -28 * Math.PI / 180, "left");
  const { model, slots } = wardrobe([door, mirror]);
  const config = ready(slots, model);
  const anim = config.animations.find((a) => a.component === "mirror_door" || a.follow.includes("mirror_door"));
  assert.ok(anim?.enabled, JSON.stringify(config.animations.map((a) => [a.component, a.enabled, a.follow, a.issues])));
  const host = config.animations.find((a) => a.component === "mirror_door" || a.follow.includes("mirror_door_mirror"))!;
  assert.ok(host.follow.includes("mirror_door_mirror") || host.component === "mirror_door_mirror");
  assert.equal(config.animations.filter((a) => a.component === "mirror_door" || a.component === "mirror_door_mirror").length, 1);
});

test("double glass doors keep independent hinges and carry their glass", () => {
  const left = panel("left_glass_frame", "Left glass door frame", [0.46, 1.9, 0.02], [-0.3, 1.1, 0.32], 0, "left");
  const leftGlass = panel("left_glass", "Left door smoked glass", [0.4, 1.7, 0.004], [-0.3, 1.1, 0.334], 0, "left");
  const right = panel("right_glass_frame", "Right glass door frame", [0.46, 1.9, 0.02], [0.3, 1.1, 0.32], 0, "right");
  const rightGlass = panel("right_glass", "Right door smoked glass", [0.4, 1.7, 0.004], [0.3, 1.1, 0.334], 0, "right");
  const { model, slots } = wardrobe([left, leftGlass, right, rightGlass]);
  const config = ready(slots, model);
  const a = config.animations.find((x) => x.component === "left_glass_frame" || x.follow.includes("left_glass"))!;
  const b = config.animations.find((x) => x.component === "right_glass_frame" || x.follow.includes("right_glass"))!;
  assert.notEqual(a.id, b.id);
  assert.ok(a.enabled && b.enabled);
  assert.ok(a.follow.includes("left_glass") || a.component === "left_glass");
  assert.ok(b.follow.includes("right_glass") || b.component === "right_glass");
  assert.notEqual(a.hinge, b.hinge);
});

test("open all and close all, then one door, keep the others", () => {
  const { model, slots } = wardrobe([], ["inner_left"]);
  const config = ready(slots, model);
  const doors = config.animations.filter((a) => a.enabled && a.type === "rotation");
  const openAll = Object.fromEntries(doors.map((a) => [a.id, targetFor(a, true)]));
  assert.ok(doors.every((a) => shownOpen(a, openAll[a.id])));
  const shut = Object.fromEntries(doors.map((a) => [a.id, targetFor(a, false)]));
  assert.ok(doors.every((a) => !shownOpen(a, shut[a.id])));
  const one = doors.find((a) => a.component === "far_left")!;
  const mixed = { ...shut, [one.id]: targetFor(one, true) };
  assert.equal(shownOpen(one, mixed[one.id]), true);
  assert.ok(doors.filter((a) => a !== one).every((a) => !shownOpen(a, mixed[a.id] ?? 0)));
});

test("reloading the model while a door is open keeps it closable on the same file", () => {
  const { model, slots } = wardrobe([], ["inner_left"]);
  const first = ready(slots, model);
  const door = first.animations.find((a) => a.component === "inner_left")!;
  const again = ready(slots, model, { ...first, state: { [door.id]: targetFor(door, false) } });
  const reloaded = again.animations.find((a) => a.component === "inner_left")!;
  assert.equal(reloaded.enabled, true);
  assert.equal(reloaded.rest, "open");
  const slot = slots.find((s) => s.id === "inner_left")!;
  assert.ok(depthAt(slot, model, reloaded, targetFor(reloaded, false)).depth < 0.08);
});

test("a legacy open file is a fixed preview, and a movable model never swaps files", () => {
  const legacy = catalogModelView({ glb_url: "closed.glb", open_glb_url: "open.glb", animation: null }, "open");
  assert.equal(legacy.legacy, true);
  assert.equal(legacy.interactive, false);
  assert.equal(legacy.url, "open.glb");
  assert.equal(catalogModelView({ glb_url: "closed.glb", open_glb_url: "open.glb" }, "closed").url, "closed.glb");
  const live = catalogModelView({ glb_url: "closed.glb", open_glb_url: "open.glb", animation: { version: 1, movable: true, animations: [], flagged: [], answer: null } }, "open");
  assert.equal(live.interactive, true);
  assert.equal(live.legacy, false);
  assert.equal(live.url, "closed.glb");
});

test("incomplete animation metadata is repaired, and a runner is not its own control", () => {
  const { model, slots } = wardrobe();
  const left = slots.find((s) => s.id === "inner_left")!;
  const runner = panel("runner", "Drawer 1 left runner", [0.02, 0.04, 0.4], [0, 0.4, 0.1]);
  const front = panel("drawer", "Drawer 1", [0.9, 0.22, 0.02], [0, 0.4, 0.32]);
  model.add(runner.mesh, front.mesh);
  model.updateMatrixWorld(true);
  const saved: AnimationConfig = {
    version: 1,
    movable: true,
    animations: [{
      id: "anim_inner_left",
      component: "inner_left",
      follow: ["far_left"],
      label: left.name,
      type: "rotation",
      axis: "y",
      unit: "degrees",
      duration: 0.8,
      enabled: false,
      source: "vision",
      issues: ["Not a flat panel: it would swing a piece of the body."],
      face: "up",
      hinge: "left",
      to: -95,
    }],
    flagged: [],
    answer: null,
  };
  const config = ready([...slots, runner, front], model, saved);
  const door = config.animations.find((a) => a.component === "inner_left")!;
  assert.equal(door.enabled, true, JSON.stringify(door.issues));
  assert.equal(door.face, "front");
  assert.equal(door.follow.includes("far_left"), false);
  assert.equal(config.animations.some((a) => a.component === "runner"), false);
  const drawer = config.animations.find((a) => a.component === "drawer" || a.follow.includes("runner"));
  assert.equal(drawer?.follow.includes("runner"), true);
});

test("clear glass and a door's own mesh do not hide its icon; the carcass does", () => {
  const door = new Mesh(new BoxGeometry(0.4, 1, 0.02), new MeshStandardMaterial());
  const glass = new Mesh(new BoxGeometry(0.3, 0.8, 0.004), new MeshStandardMaterial({ transparent: true, opacity: 0.2 }));
  const smokedMat = new MeshStandardMaterial({ transparent: true, opacity: 1 });
  (smokedMat as MeshStandardMaterial & { transmission: number }).transmission = 0.9;
  const smoked = new Mesh(new BoxGeometry(0.3, 0.8, 0.004), smokedMat);
  const body = new Mesh(new BoxGeometry(1, 1, 0.5), new MeshStandardMaterial());
  const own = new Set([door]);
  assert.equal(blocksPartIcon(door, own), false);
  assert.equal(blocksPartIcon(glass, own), false);
  assert.equal(blocksPartIcon(smoked, own), false);
  assert.equal(blocksPartIcon(body, own), true);
});

// ---- Hinges and swing directions (reproduction: model b5efef35, a mirrored wardrobe with an open glazed centre) ----

import { Quaternion } from "three";
import { applyAnimations, sheetEdges } from "../../vendor/animation";

/** A door modelled OPEN the way GPT Astra writes it: a group whose origin is on the hinge line, turned `deg` about y,
 * holding the door's frame, glass and hinge hardware in its own frame. */
function openDoorGroup(prefix: string, hingeX: number, side: "left" | "right", deg: number, hardware = true) {
  const g = new Group();
  g.position.set(hingeX, 0, 0.311);
  g.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180);
  const w = 0.38, sign = side === "left" ? 1 : -1; // the leaf runs from the hinge towards the bay's centre
  const add = (id: string, name: string, geo: BoxGeometry) => { const m = new Mesh(geo, new MeshStandardMaterial()); m.name = name; g.add(m); return { id, name, mesh: m }; };
  const parts = [
    add(`${prefix}_frame`, `${prefix} central door wood frame`, new BoxGeometry(w, 2.2, 0.025).translate(sign * w / 2, 1.19, 0.013)),
    add(`${prefix}_glass`, `${prefix} central door smoked glass`, new BoxGeometry(w - 0.06, 2.1, 0.006).translate(sign * w / 2, 1.19, 0.02)),
  ];
  if (hardware) for (const k of [1, 2, 3]) parts.push(add(`${prefix}_hinge_${k}`, `${prefix} door hinge ${k}`, new BoxGeometry(0.03, 0.05, 0.03).translate(sign * 0.01, 0.25 + (k - 1) * 0.95, 0.005)));
  return { g, parts };
}

function mirroredWardrobe(opts: { hardware?: boolean } = {}) {
  const model = new Group();
  const body = new Mesh(new BoxGeometry(2.4, 2.3, 0.6).translate(0, 1.15, 0), new MeshStandardMaterial());
  body.name = "Carcass";
  model.add(body);
  const flat = (id: string, name: string, x0: number, x1: number) => {
    const m = new Mesh(new BoxGeometry(x1 - x0, 2.2, 0.026).translate((x0 + x1) / 2, 1.19, 0.309), new MeshStandardMaterial());
    m.name = name;
    model.add(m);
    return { id, name, mesh: m };
  };
  const mirrored = [
    flat("far_left", "Far-left door frame", -1.195, -0.802),
    flat("left_inner", "Left inner door frame", -0.798, -0.407),
    flat("right_inner", "Right inner mirrored door wood frame", 0.407, 0.798),
    flat("right_outer", "Right outer mirrored door wood frame", 0.802, 1.195),
  ];
  const left = openDoorGroup("Left", -0.399, "left", -72, opts.hardware ?? true);
  const right = openDoorGroup("Right", 0.399, "right", 68, opts.hardware ?? true);
  model.add(left.g, right.g);
  model.updateMatrixWorld(true);
  return { model, slots: [{ id: "body", name: "Carcass", mesh: body }, ...mirrored, ...left.parts, ...right.parts] };
}

const byComponent = (c: AnimationConfig, id: string) => c.animations.find((a) => a.component === id)!;

test("a door modelled open turns about its real hinge (the hardware's edge), not about its free edge", () => {
  const { model, slots } = mirroredWardrobe();
  const c = ready(slots, model);
  for (const [id, x, hinge] of [["Left_frame", -0.399, "left"], ["Right_frame", 0.399, "right"]] as const) {
    const a = byComponent(c, id);
    assert.ok(a.enabled && a.rest === "open", JSON.stringify(a.issues));
    assert.equal(a.hinge, hinge);
    assert.ok(Math.hypot(a.pivot![0] - x, a.pivot![2] - 0.311) < 0.02, `pivot ${a.pivot} is on the hinge line`);
    assert.ok(a.follow.includes(id.replace("frame", "glass")) && a.follow.includes(id.replace("frame", "hinge_1")));
    assert.ok(!a.hingeUnsure);
  }
});

test("closing a modelled-open door lays it flat on the cabinet front, the hinge never moving, never inside", () => {
  const { model, slots } = mirroredWardrobe();
  const c = ready(slots, model);
  for (const id of ["Left_frame", "Right_frame"]) {
    const a = byComponent(c, id);
    const slot = slots.find((s) => s.id === id)!;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const { hingeMoved } = depthAt(slot, model, a, t);
      assert.ok(hingeMoved < 1e-6, `${id} hinge stays at ${t}`);
    }
    const rest = slot.mesh.parent!.quaternion.clone();
    applyAnimations(slots, model, c, { [a.id]: 1 });
    model.updateMatrixWorld(true);
    const [e1, e2] = sheetEdges(slot.mesh, model, new Vector3(0, 1, 0));
    assert.ok(Math.abs(e1.z - e2.z) < 0.01 && Math.min(e1.z, e2.z) > 0.29, `${id} closed flush on the front: z ${e1.z.toFixed(3)} / ${e2.z.toFixed(3)}`);
    for (const s of slots) { s.mesh.position.set(s.mesh.position.x, s.mesh.position.y, s.mesh.position.z); }
    slot.mesh.parent!.quaternion.copy(rest);
    // reset every mesh to its file pose for the next door
    model.traverse((o) => { if ((o as Mesh).isMesh) { o.position.set(0, 0, 0); o.quaternion.copy(new Quaternion()); } });
    model.updateMatrixWorld(true);
  }
});

test("without hardware, an open door's hinge is the edge that stayed at the cabinet", () => {
  const { model, slots } = mirroredWardrobe({ hardware: false });
  const c = ready(slots, model);
  const a = byComponent(c, "Left_frame");
  assert.equal(a.hinge, "left");
  assert.ok(Math.hypot(a.pivot![0] + 0.399, a.pivot![2] - 0.311) < 0.02, `${a.pivot}`);
});

test("a mirrored pair beside an open door: the open door's swung box is no neighbour, so each pair hinges outside", () => {
  const { model, slots } = mirroredWardrobe();
  const c = ready(slots, model);
  assert.deepEqual(["far_left", "left_inner", "right_inner", "right_outer"].map((id) => byComponent(c, id).hinge), ["left", "right", "left", "right"]);
  assert.ok(["far_left", "left_inner", "right_inner", "right_outer"].every((id) => !byComponent(c, id).hingeUnsure));
  // Every closed door swings out in front of the cabinet, never into it.
  for (const id of ["far_left", "right_inner"]) {
    const slot = slots.find((s) => s.id === id)!;
    const a = byComponent(c, id);
    applyAnimations(slots, model, c, { [a.id]: 1 });
    model.updateMatrixWorld(true);
    assert.ok(boxInModel(slot.mesh, model).min.z > 0.28, `${id} opens outward`);
    slot.mesh.position.set(0, 0, 0);
    slot.mesh.quaternion.identity();
    model.updateMatrixWorld(true);
  }
});

test("drawer runners and the shelf over a drawer stack stay in the carcass; only the fronts slide", () => {
  const model = new Group();
  const add = (id: string, name: string, geo: BoxGeometry) => { const m = new Mesh(geo, new MeshStandardMaterial()); m.name = name; model.add(m); return { id, name, mesh: m }; };
  const slots = [
    add("body", "Carcass", new BoxGeometry(0.8, 0.8, 0.5).translate(0, 0.4, 0)),
    add("front", "Drawer 1 smoked glass front", new BoxGeometry(0.7, 0.12, 0.004).translate(0, 0.23, 0.265)),
    add("runner", "Drawer 1 Left runner", new BoxGeometry(0.01, 0.02, 0.43).translate(-0.39, 0.18, 0)),
    add("shelf", "Central drawer stack top shelf", new BoxGeometry(0.78, 0.022, 0.53).translate(0, 0.76, 0)),
  ];
  model.updateMatrixWorld(true);
  const c = ready(slots, model);
  assert.deepEqual(c.animations.map((a) => a.component), ["front"]);
});

test("a lone door with nothing to tell its side is flagged for the vendor, not silently left-hinged", () => {
  const model = new Group();
  const body = new Mesh(new BoxGeometry(0.6, 2, 0.5).translate(0, 1, 0), new MeshStandardMaterial());
  const door = new Mesh(new BoxGeometry(0.56, 1.9, 0.02).translate(0, 1, 0.26), new MeshStandardMaterial());
  model.add(body, door);
  model.updateMatrixWorld(true);
  const c = ready([{ id: "body", name: "Carcass", mesh: body }, { id: "door", name: "Door", mesh: door }], model);
  assert.ok(c.animations[0].hingeUnsure && /check it/.test(c.animations[0].reason ?? ""));
});

test("a vendor's hinge correction is kept exactly through reloads", () => {
  const { model, slots } = mirroredWardrobe();
  const first = ready(slots, model);
  const fixed = first.animations.map((a) => (a.component === "right_inner" ? { ...withHingeFor(a, slots, model, "right"), source: "manual" as const } : a));
  const saved = JSON.parse(JSON.stringify({ ...first, animations: fixed })) as AnimationConfig;
  const again = ready(slots, model, saved);
  const a = byComponent(again, "right_inner");
  assert.equal(a.hinge, "right");
  assert.equal(a.source, "manual");
  assert.deepEqual(a.pivot, byComponent(saved, "right_inner").pivot);
  assert.equal(a.to, byComponent(saved, "right_inner").to);
});

import { withHinge } from "../../vendor/animation";
function withHingeFor(a: PartAnimation, slots: Slot[], model: Group, hinge: "left" | "right") {
  return withHinge(a, hinge, boxInModel(slots.find((s) => s.id === a.component)!.mesh, model));
}

test("a model whose file faces +x: doors are hinged and swing out along +x, judged from its own front", () => {
  const model = new Group(); // the file as it is: its doors face +x
  const body = new Mesh(new BoxGeometry(0.6, 2, 1.2).translate(0, 1, 0), new MeshStandardMaterial());
  // Seen from its own front (+x), "right" is -z: a handle near z = -0.5 means a hinge on the left (z > 0 side).
  const door = new Mesh(new BoxGeometry(0.02, 1.9, 0.56).translate(0.31, 1, -0.29), new MeshStandardMaterial());
  const handle = new Mesh(new BoxGeometry(0.02, 0.3, 0.02).translate(0.33, 1, -0.52), new MeshStandardMaterial());
  model.add(body, door, handle);
  model.updateMatrixWorld(true);
  const slots = [{ id: "body", name: "Carcass", mesh: body }, { id: "door", name: "Door", mesh: door }, { id: "handle", name: "Handle", mesh: handle }];
  const c = ready(slots, model);
  const a = byComponent(c, "door");
  assert.ok(a.enabled && a.face === "right" && a.follow.includes("handle"), JSON.stringify(a));
  assert.equal(a.hinge, "left");
  applyAnimations(slots, model, c, { [a.id]: 1 });
  model.updateMatrixWorld(true);
  assert.ok(boxInModel(door, model).min.x > 0.28, "it swings out of its own front (+x), not into the body");
});
