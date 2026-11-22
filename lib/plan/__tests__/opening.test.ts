import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3, type Material } from "three";
import { applyAnimations, boxInModel, refine, type AnimationConfig, type PartAnimation } from "../../vendor/animation";
import { checkMovers, drawerBox, openCavities } from "../../vendor/reconstruct";

type Part = { id: string; name: string; mesh: Mesh };

function model(parts: [string, string, BoxGeometry, Material?][]) {
  const root = new Group();
  const slots: Part[] = parts.map(([id, name, g, m]) => {
    const mesh = new Mesh(g, m ?? new MeshStandardMaterial({ color: "#efe8dc" }));
    mesh.name = id;
    root.add(mesh);
    return { id, name, mesh };
  });
  root.updateMatrixWorld(true);
  return { root, slots };
}

/** Panel-built chest (as GPT Astra writes it), hollow behind its two drawer fronts. */
const panels = (extra: [string, string, BoxGeometry, Material?][] = []) => model([
  ["left", "Left side panel", new BoxGeometry(0.02, 0.8, 0.5).translate(-0.49, 0.4, 0)],
  ["right", "Right side panel", new BoxGeometry(0.02, 0.8, 0.5).translate(0.49, 0.4, 0)],
  ["bottom", "Bottom panel", new BoxGeometry(0.96, 0.02, 0.5).translate(0, 0.01, 0)],
  ["top", "Top panel", new BoxGeometry(0.96, 0.02, 0.5).translate(0, 0.79, 0)],
  ["back", "Back panel", new BoxGeometry(0.96, 0.8, 0.01).translate(0, 0.4, -0.245)],
  ["drawer_1", "Drawer 1", new BoxGeometry(0.94, 0.3, 0.02).translate(0, 0.2, 0.26), new MeshStandardMaterial({ color: "#8b5a2b", roughness: 0.4 })],
  ...extra,
]);

const open = (config: AnimationConfig, slots: Part[], root: Group, ids: string[]) =>
  applyAnimations(slots, root, config, Object.fromEntries(config.animations.map((a) => [a.id, ids.includes(a.component) ? 1 : 0])));

test("a drawer front with no box gets a solid one (bottom, two sides, back) that slides out with it, in its material", () => {
  const { root, slots } = panels();
  const config = checkMovers(refine(null, slots, root), slots, root)!;
  const drawer = config.animations.find((a) => a.component === "drawer_1")!;
  const added = openCavities(config, slots, root);
  assert.deepEqual(added.map((a) => [a.id, a.follows]), [["drawer_box_drawer_1", drawer.id]]);
  const boxMesh = added[0].mesh;
  // Solid panels with thickness: four closed boxes (bottom, sides, back), 36 vertices each.
  assert.equal(boxMesh.geometry.getAttribute("position").count, 4 * 36);
  const mat = boxMesh.material as MeshStandardMaterial;
  assert.equal(mat.color.getHexString(), "8b5a2b"); // the front's own material
  assert.equal(mat.roughness, 0.4);
  // Sliding: the box travels exactly with the front, and stays inside the chest's depth.
  drawer.follow.push(added[0].id);
  const all = [...slots, { id: added[0].id, name: added[0].name, mesh: boxMesh }];
  const rest = all.map((p) => [p.mesh.position.clone(), p.mesh.quaternion.clone()] as const);
  const restore = () => all.forEach((p, i) => { p.mesh.position.copy(rest[i][0]); p.mesh.quaternion.copy(rest[i][1]); });
  const frontBefore = boxInModel(slots[5].mesh, root), boxBefore = boxInModel(boxMesh, root);
  open(config, all, root, ["drawer_1"]);
  const frontAfter = boxInModel(slots[5].mesh, root), boxAfter = boxInModel(boxMesh, root);
  const moved = frontAfter.min.z - frontBefore.min.z;
  assert.ok(moved > 0.1, "the drawer slid out");
  assert.ok(Math.abs(boxAfter.min.z - boxBefore.min.z - moved) < 1e-6, "the box moved with it, not detached");
  assert.ok(boxAfter.min.y === boxBefore.min.y && boxAfter.min.x === boxBefore.min.x, "straight out: no drop, no sideways shift");
  assert.ok(boxAfter.min.z < 0.25, "its back is still inside the chest when open");
  assert.ok(Math.abs(moved) <= 0.85 * size(boxBefore).z + 1e-6, "it never slides further than it is deep");
  // Closed (the viewer restores the rest pose, as applyPoses does) and opened again: the same, every time.
  for (let i = 0; i < 3; i++) {
    restore();
    assert.ok(boxInModel(boxMesh, root).min.distanceTo(boxBefore.min) < 1e-9, "closed: exactly where it was");
    open(config, all, root, ["drawer_1"]);
    assert.ok(boxInModel(boxMesh, root).min.distanceTo(boxAfter.min) < 1e-9, "open: exactly as before");
  }
});

const size = (b: Box3) => b.getSize(new Vector3());

test("a drawer that already has its own box slides with it and gets no second one", () => {
  const { root, slots } = panels([
    ["db_bottom", "Drawer 1 bottom", new BoxGeometry(0.9, 0.01, 0.4).translate(0, 0.06, 0.04)],
    ["db_left", "Drawer 1 left side", new BoxGeometry(0.01, 0.25, 0.4).translate(-0.445, 0.185, 0.04)],
    ["db_right", "Drawer 1 right side", new BoxGeometry(0.01, 0.25, 0.4).translate(0.445, 0.185, 0.04)],
    ["db_back", "Drawer 1 back", new BoxGeometry(0.9, 0.25, 0.01).translate(0, 0.185, -0.16)],
  ]);
  const config = checkMovers(refine(null, slots, root), slots, root)!;
  const movers = config.animations.filter((a) => a.enabled).map((a) => a.component);
  assert.deepEqual(movers, ["drawer_1"]); // its pieces are not drawers of their own
  assert.deepEqual([...config.animations[0].follow].sort(), ["db_back", "db_bottom", "db_left", "db_right"]);
  assert.deepEqual(openCavities(config, slots, root), []);
});

/** A wide wardrobe's centre bay: two glazed doors, each a dark frame (a ring) holding a glass panel, with a long
 * handle near the middle; the carcass behind. */
function glazedBay(glassNamedDoor = false) {
  const glass = () => new MeshStandardMaterial({ color: "#dde8ea", transparent: true, opacity: 0.35 });
  return model([
    ["body", "Main carcass", new BoxGeometry(2.9, 2.7, 0.6).translate(0, 1.35, 0)],
    ["frame_l", "Left glazed door frame", new BoxGeometry(0.4, 1.9, 0.03).translate(-0.2, 1.1, 0.315)],
    ["glass_l", glassNamedDoor ? "Left glazed door" : "Left door glass panel", new BoxGeometry(0.32, 1.82, 0.01).translate(-0.2, 1.1, 0.32), glass()],
    ["handle_l", "Left handle", new BoxGeometry(0.02, 0.6, 0.03).translate(-0.04, 1.1, 0.345)],
    ["frame_r", "Right glazed door frame", new BoxGeometry(0.4, 1.9, 0.03).translate(0.2, 1.1, 0.315)],
    ["glass_r", "Right door glass panel", new BoxGeometry(0.32, 1.82, 0.01).translate(0.2, 1.1, 0.32), glass()],
    ["handle_r", "Right handle", new BoxGeometry(0.02, 0.6, 0.03).translate(0.04, 1.1, 0.345)],
  ]);
}

test("double glass doors: each frame opens with its glass and handle, hinged at its outer edge, outwards, without meeting", () => {
  const { root, slots } = glazedBay();
  const config = checkMovers(refine(null, slots, root), slots, root)!;
  const doors = Object.fromEntries(config.animations.map((a) => [a.component, a]));
  assert.deepEqual(Object.keys(doors).sort(), ["frame_l", "frame_r"]);
  assert.ok(doors.frame_l.enabled && doors.frame_r.enabled, JSON.stringify(config.animations.map((a) => a.issues)));
  assert.deepEqual([...doors.frame_l.follow].sort(), ["glass_l", "handle_l"]);
  assert.deepEqual([...doors.frame_r.follow].sort(), ["glass_r", "handle_r"]);
  assert.equal(doors.frame_l.hinge, "left");
  assert.equal(doors.frame_r.hinge, "right");
  const glassBefore = boxInModel(slots[2].mesh, root);
  open(config, slots, root, ["frame_l", "frame_r"]);
  const l = boxInModel(slots[1].mesh, root), r = boxInModel(slots[4].mesh, root);
  assert.ok(l.min.z > 0.3 && r.min.z > 0.3, "both swing out in front of the body");
  assert.ok(!l.intersectsBox(r), "the open leaves do not collide");
  const glassAfter = boxInModel(slots[2].mesh, root);
  assert.ok(glassAfter.max.z > glassBefore.max.z + 0.2, "the glass went with its frame");
  assert.equal((slots[2].mesh.material as MeshStandardMaterial).opacity, 0.35); // glass stays glass
});

test("a glass panel taken for a door of its own joins its frame instead of blocking it", () => {
  const { root, slots } = glazedBay(true);
  const vision: PartAnimation = { id: "anim_glass_l", component: "glass_l", follow: [], label: "Left glazed door", type: "rotation", axis: "y", unit: "degrees", duration: 0.8, enabled: true, source: "vision", confidence: 0.8, issues: [], hinge: "left", to: -95 };
  const config = checkMovers(refine({ version: 1, movable: true, animations: [vision], flagged: [], source: "vision" } as AnimationConfig, slots, root), slots, root)!;
  const left = config.animations.filter((a) => [a.component, ...a.follow].includes("glass_l"));
  assert.equal(left.length, 1, "one assembly for the left door");
  assert.ok(left[0].enabled, JSON.stringify(left[0].issues));
  assert.ok([left[0].component, ...left[0].follow].includes("frame_l"));
});

test("a model facing sideways (+x): the drawer's box is behind its front along x, and it slides out along x", () => {
  const { root, slots } = model([
    ["front_panel", "Left side panel", new BoxGeometry(0.5, 0.8, 0.02).translate(0, 0.4, -0.49)],
    ["back_panel", "Right side panel", new BoxGeometry(0.5, 0.8, 0.02).translate(0, 0.4, 0.49)],
    ["bottom", "Bottom panel", new BoxGeometry(0.5, 0.02, 0.96).translate(0, 0.01, 0)],
    ["top", "Top panel", new BoxGeometry(0.5, 0.02, 0.96).translate(0, 0.79, 0)],
    ["back", "Back panel", new BoxGeometry(0.01, 0.8, 0.96).translate(-0.245, 0.4, 0)],
    ["drawer_1", "Drawer 1", new BoxGeometry(0.02, 0.3, 0.94).translate(0.26, 0.2, 0)],
  ]);
  const config = checkMovers(refine(null, slots, root), slots, root)!;
  const drawer = config.animations.find((a) => a.component === "drawer_1")!;
  assert.ok(drawer.enabled && drawer.axis === "x" && (drawer.distance ?? 0) > 0, JSON.stringify(drawer));
  const [added] = openCavities(config, slots, root);
  const b = boxInModel(added.mesh, root);
  assert.ok(b.max.x <= 0.25 + 1e-6 && b.min.x > -0.245, "behind the front, inside the chest, along x");
  assert.ok(b.max.z <= 0.47 && b.min.z >= -0.47, "within the front's outline");
});

test("after a save and reload, the added drawer box is recognised and slides again: nothing is added twice", () => {
  const { root, slots } = panels();
  const config = checkMovers(refine(null, slots, root), slots, root)!;
  const [added] = openCavities(config, slots, root);
  // What the exported GLB carries back: the box as its own mesh, its name, and its extras (userData).
  const saved = added.mesh.clone();
  saved.userData = JSON.parse(JSON.stringify(added.mesh.userData));
  const reloaded = panels();
  reloaded.root.add(saved);
  reloaded.root.updateMatrixWorld(true);
  const slots2 = [...reloaded.slots, { id: "drawer_box_drawer_1", name: saved.name, mesh: saved }];
  const again = checkMovers(refine(null, slots2, reloaded.root), slots2, reloaded.root)!;
  const drawer = again.animations.find((a) => a.component === "drawer_1")!;
  assert.ok(drawer.enabled, JSON.stringify(drawer.issues));
  assert.ok(drawer.follow.includes("drawer_box_drawer_1"), JSON.stringify(drawer.follow));
  assert.deepEqual(openCavities(again, slots2, reloaded.root), []);
});

test("the drawer box geometry: a bottom between two sides and a back, every panel as thick as asked", () => {
  const g = drawerBox(0.9, 0.24, 0.4, 0.015);
  g.computeBoundingBox();
  const b = g.boundingBox!;
  assert.ok(Math.abs(b.max.x - b.min.x - 0.9) < 1e-6 && Math.abs(b.max.y - b.min.y - 0.24) < 1e-6 && Math.abs(b.max.z - b.min.z - 0.4) < 1e-6);
  // Nothing above the sides' top: open at the top; and a bottom panel spanning the floor.
  const pos = g.getAttribute("position");
  let floor = 0;
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - b.min.y) < 1e-6) floor++;
  assert.ok(floor >= 3 * 6, "the bottom and both sides reach the floor");
});
