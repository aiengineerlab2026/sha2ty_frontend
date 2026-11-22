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
