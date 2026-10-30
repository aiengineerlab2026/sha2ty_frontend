import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, Object3D, Vector3 } from "three";
import { measure, normalizeModel, worldBox, type Dimensions } from "../modelNormalization";
import { clearSpan, footprintCorners, localWarnings } from "../placementValidation";
import type { PlacedItem, PlanGeometry } from "../types";

const SOFA: Dimensions = { width: 3, height: 1, depth: 1.5 };
const EPS = 1e-6;

function box(w: number, h: number, d: number): Mesh {
  return new Mesh(new BoxGeometry(w, h, d));
}

function close(actual: Dimensions, expected: Dimensions, eps = EPS) {
  for (const k of ["width", "height", "depth"] as const) {
    assert.ok(Math.abs(actual[k] - expected[k]) < eps, `${k}: ${actual[k]} ≠ ${expected[k]}`);
  }
}

function sofaItem(patch: Partial<PlacedItem> = {}): PlacedItem {
  return {
    instanceId: "sofa",
    modelId: "m1",
    title: "Sofa",
    company: "",
    glbUrl: "",
    width_m: 3,
    height_m: 1,
    depth_m: 1.5,
    x: 2,
    y: 0,
    z: 2.5,
    rotation_y: 0,
    warnings: [],
    ...patch,
  };
}

function roomGeometry(width: number, depth: number): PlanGeometry {
  return {
    rooms: [{ id: "r1", name: "Living", polygon: [[0, 0], [width, 0], [width, depth], [0, depth]], width, depth, height: 2.8 }],
    walls: [],
    openings: [],
    warnings: [],
    scale_confidence: 1,
    source: "dimensions",
    wall_thickness: 0.15,
    height: 2.8,
  };
}

const PROPORTIONAL = () => box(1, 1 / 3, 0.5); // same 3 : 1 : 1.5 proportions as the catalogue

test("a model with catalogue proportions becomes exactly 3 × 1 × 1.5 m with one uniform scale", () => {
  const { object, report } = normalizeModel(PROPORTIONAL(), SOFA);
  close(measure(object), SOFA);
  close(report.finalSize, SOFA);
  assert.ok(report.scale.every((f) => Math.abs(f - 3) < 1e-6), String(report.scale)); // Float32 vertex buffers
  assert.equal(report.warnings.length, 0);
});

test("width drives one uniform scale: a 1 m cube becomes a 3 m cube, warned on height and depth", () => {
  const { object, report } = normalizeModel(box(1, 1, 1), SOFA);
  close(measure(object), { width: 3, height: 3, depth: 3 }); // exactly 3 m wide, still a cube
  assert.ok(report.scale.every((f) => f === report.scale[0]));
  assert.ok(report.warnings.some((w) => w.includes("3.00 m high")));
  assert.ok(report.warnings.some((w) => w.includes("3.00 m deep")));
});

test("height/depth within 10% of the database give no warning; beyond 10% they do", () => {
  const within = normalizeModel(box(1, 0.36, 0.52), SOFA).report; // → 3 × 1.08 × 1.56: 8% / 4% off
  assert.equal(within.warnings.length, 0);
  close(within.finalSize, { width: 3, height: 1.08, depth: 1.56 }, 1e-6);
  const beyond = normalizeModel(box(1, 0.4, 0.5), SOFA).report; // → 3 × 1.2 × 1.5: 20% off in height
  assert.equal(beyond.warnings.length, 1);
  assert.ok(Math.abs(beyond.heightError - 0.2) < 1e-6 && beyond.depthError < 1e-6);
});

test("nested GLB-style transforms are included (cm root, rotated and offset children)", () => {
  // Typical export: root scaled 0.01 (centimetres), a child turned 90° about Y, a mesh offset.
  const root = new Group();
  root.scale.setScalar(0.01);
  root.position.set(5, 3, -2);
  const child = new Group();
  child.rotation.y = Math.PI / 2;
  const mesh = box(105, 70, 210); // after the 90° turn: 210 cm along X, 105 cm along Z
  mesh.position.set(10, 45, 0);
  child.add(mesh);
  root.add(child);

  const { object, report } = normalizeModel(root, SOFA);
  close(report.originalSize, { width: 2.1, height: 0.7, depth: 1.05 }, 1e-6);
  close(measure(object), SOFA);
  assert.ok(report.nestedTransforms >= 2);
  const b = worldBox(object);
  assert.ok(Math.abs(b.min.y) < EPS, "bottom on the floor");
  assert.ok(Math.abs(b.getCenter(new Vector3()).x) < EPS && Math.abs(b.getCenter(new Vector3()).z) < EPS, "centred on X/Z");
});

test("the real sofa GLB proportions (1.9 × 0.45 × 1.0) render 3 m wide without distortion", () => {
  const { object, report } = normalizeModel(box(1.903, 0.452, 0.999), SOFA);
  const size = measure(object);
  const k = 3 / 1.903;
  close(size, { width: 3, height: 0.452 * k, depth: 0.999 * k }, 1e-6);
  assert.ok(Math.abs(size.height / size.width - 0.452 / 1.903) < 1e-6, "shape preserved");
  assert.ok(report.warnings.some((w) => w.includes("high"))); // 0.71 m vs 1.00 m
  assert.ok(!report.warnings.some((w) => w.includes("deep"))); // 1.57 m vs 1.50 m is within 10%
});

test("Z-up CAD export is turned Y-up before measuring", () => {
  // Height authored along Z, depth along Y.
  const { object, report } = normalizeModel(box(3, 1.5, 1), SOFA);
  assert.equal(report.orientation, "z-up→y-up");
  close(measure(object), SOFA);
  assert.ok(report.distortion < 1.0001, "re-oriented, the proportions match exactly");
});

test("longest horizontal side becomes the 3 m width", () => {
  const { report } = normalizeModel(box(0.75, 0.5, 1.5), SOFA); // authored with its length on Z
  assert.equal(report.orientation, "yaw-90");
  close(report.finalSize, SOFA);
});

test("repeated loading never applies the database scale twice and never mutates the source", () => {
  const source = new Group();
  source.add(box(1.2, 0.4, 0.6));
  source.scale.set(2, 2, 2);
  const before = source.matrix.clone();
  const a = normalizeModel(source, SOFA);
  const b = normalizeModel(source, SOFA);
  close(measure(a.object), SOFA);
  close(measure(b.object), SOFA);
  assert.deepEqual(a.report.scale, b.report.scale);
  assert.ok(source.matrix.equals(before) && source.scale.x === 2, "cached scene untouched");
  assert.equal(source.parent, null);
  // Normalising an already-normalised model is a no-op on size.
  close(normalizeModel(a.object, SOFA).report.finalSize, SOFA);
});

test("rotating the placed sofa keeps its physical size", () => {
  const { object } = normalizeModel(PROPORTIONAL(), SOFA);
  const placed = new Group();
  placed.add(object);
  for (const deg of [0, 37, 90, 180, 271]) {
    placed.rotation.set(0, (deg * Math.PI) / 180, 0);
    const r = (deg * Math.PI) / 180;
    const world = measure(placed);
    // World AABB of a rotated 3 × 1.5 rectangle, height unchanged.
    assert.ok(Math.abs(world.width - (3 * Math.abs(Math.cos(r)) + 1.5 * Math.abs(Math.sin(r)))) < 1e-6);
    assert.ok(Math.abs(world.depth - (3 * Math.abs(Math.sin(r)) + 1.5 * Math.abs(Math.cos(r)))) < 1e-6);
    assert.ok(Math.abs(world.height - 1) < 1e-6);
  }
  // Back to 0°: exactly the catalogue size again — rotation never altered the model.
  placed.rotation.set(0, 0, 0);
  close(measure(placed), SOFA);
});

test("the collision footprint rotates the same way three.js renders", () => {
  const item = sofaItem({ x: 0, z: 0, rotation_y: 30, depth_m: 0 });
  const rendered = new Object3D();
  rendered.rotation.y = (30 * Math.PI) / 180;
  rendered.updateMatrixWorld(true);
  const corner = new Vector3(1.5, 0, 0).applyMatrix4(rendered.matrixWorld);
  const footprint = footprintCorners(item);
  assert.ok(footprint.some((c) => Math.abs(c.x - corner.x) < 1e-9 && Math.abs(c.z - corner.z) < 1e-9));
});

test("dragging changes position only, never scale", () => {
  const { object } = normalizeModel(PROPORTIONAL(), SOFA);
  const fitScale = object.children[0].scale.clone();
  const placed = new Group();
  placed.add(object);
  for (const [x, z] of [[0, 0], [1.2, 3.4], [-7, 2]]) {
    placed.position.set(x, 0, z);
    close(measure(placed), SOFA);
    assert.ok(object.children[0].scale.equals(fitScale));
    assert.ok(object.scale.equals(new Vector3(1, 1, 1)));
  }
});

test("the sofa's bottom rests on the floor wherever it is placed", () => {
  const raised = PROPORTIONAL();
  raised.position.y = 4.2; // authored floating above its origin
  const { object } = normalizeModel(raised, SOFA);
  const placed = new Group();
  placed.position.set(3, 0, 1);
  placed.rotation.y = 1.1;
  placed.add(object);
  assert.ok(Math.abs(new Box3().setFromObject(placed, true).min.y) < EPS);
});

test("both viewers produce the same world-space size for the same model", () => {
  // Floor-plan editor and the standalone viewer both call normalizeModel(scene, catalogue size).
  const scene = new Group();
  const child = box(140, 50, 70);
  child.rotation.x = -Math.PI / 2;
  scene.add(child);
  const editor = normalizeModel(scene, SOFA).object;
  const standalone = normalizeModel(scene, SOFA).object;
  close(measure(editor), measure(standalone));
  assert.ok(Math.abs(measure(editor).width - SOFA.width) < EPS, "width is the database width");
});

test("a 3 m sofa along a 4 m wall uses 75% of it, with no warning", () => {
  const geometry = roomGeometry(4, 5);
  const item = sofaItem({ x: 2, z: 2.5 });
  const span = clearSpan({ x: item.x, z: item.z }, { x: 1, z: 0 }, geometry.rooms[0].polygon);
  assert.ok(Math.abs(span - 4) < 1e-9);
  assert.ok(Math.abs(item.width_m / span - 0.75) < 1e-9);
  assert.deepEqual(localWarnings(item, geometry, [item]), []);
});

test("furniture larger than the room warns instead of shrinking", () => {
  const geometry = roomGeometry(2.5, 5);
  const item = sofaItem({ x: 1.25, z: 2.5 });
  const warnings = localWarnings(item, geometry, [item]);
  assert.ok(warnings.some((w) => w.includes("3.00 m wide") && w.includes("2.50 m")), warnings.join("; "));
  assert.equal(item.width_m, 3);
  // Turned 90°, its 1.5 m depth now runs across the 2.5 m room and its width along the 5 m side: fits.
  assert.deepEqual(localWarnings({ ...item, rotation_y: 90 }, geometry, []), []);
});

test("rotated footprints collide only when they really overlap", () => {
  const a = sofaItem({ instanceId: "a", x: 2, z: 2, rotation_y: 45 });
  const b = sofaItem({ instanceId: "b", x: 4.3, z: 2, rotation_y: 45, title: "Chair", width_m: 0.6, depth_m: 0.6 });
  // Their axis-aligned boxes overlap, the rotated rectangles do not.
  const warnings = localWarnings(a, roomGeometry(8, 8), [a, b]);
  assert.ok(!warnings.some((w) => w.includes("intersects Chair")), warnings.join("; "));
});

test("carpet must fit the room at its catalogue size and rotation", async () => {
  const { rugWarnings } = await import("../placementValidation");
  const room = { rooms: [{ id: "r", name: "Bedroom", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }], walls: [], height: 2.8 } as unknown as PlanGeometry;
  const rug = { name: "Rug", width: 3.5, length: 2, x: 2, z: 1.5, rotation: 0 };
  assert.deepEqual(rugWarnings(rug, room), []); // 3.5 × 2 in a 4 × 3 room
  const turned = rugWarnings({ ...rug, rotation: 90 }, room); // now 3.5 m across a 3 m span
  assert.equal(turned.length, 1);
  assert.match(turned[0], /3\.50 m wide but Bedroom has 3\.00 m/);
  assert.match(rugWarnings({ ...rug, x: 9 }, room)[0], /outside the rooms/);
});

test("tilting about X changes the floor footprint and lifts the item onto the floor", async () => {
  const { tilted, footprintCorners } = await import("../placementValidation");
  const flat = tilted({ width: 2, height: 1, depth: 0.5 }, 0);
  assert.deepEqual([flat.depth, flat.height, flat.lift], [0.5, 1, 0]);
  const lying = tilted({ width: 2, height: 1, depth: 0.5 }, 90); // tipped onto its back
  assert.ok(Math.abs(lying.depth - 1) < EPS && Math.abs(lying.height - 0.5) < EPS && Math.abs(lying.lift - 0.25) < EPS);
  // tipped back about its base: the footprint spans z ∈ [0, 1] (shift 0.5, depth 1)
  const corners = footprintCorners({ x: 0, z: 0, width_m: 2, height_m: 1, depth_m: 0.5, rotation_y: 0, rotation_x: 90 });
  const zs = corners.map((c) => c.z);
  assert.ok(Math.abs(Math.min(...zs) - 0) < EPS && Math.abs(Math.max(...zs) - 1) < EPS, `${zs}`);
});

test("an item dropped through a wall is moved to the nearest spot where it fits", async () => {
  const { nearestValidSpot, localWarnings } = await import("../placementValidation");
  const room = { rooms: [{ id: "r", name: "Living", polygon: [[0, 0], [5, 0], [5, 4], [0, 4]] }], walls: [], height: 2.8 } as unknown as PlanGeometry;
  const sofa = sofaItem({ x: 0.5, z: 2 }); // 3 m wide sofa poking out of the left wall
  assert.ok(localWarnings(sofa, room, [sofa]).length > 0);
  const spot = nearestValidSpot(sofa, room, [sofa]);
  assert.ok(spot && localWarnings({ ...sofa, ...spot }, room, [sofa]).length === 0);
  assert.ok(spot!.x >= 1.5 && spot!.x < 1.65, `${spot!.x}`); // just far enough in: half its width from the wall
  assert.equal(nearestValidSpot(sofaItem({ width_m: 6, size: undefined }), room, []), null); // wider than the room
});

test("a ceiling light hangs from the ceiling and never collides with floor furniture", async () => {
  const { baseHeight, mountFor } = await import("../categories");
  assert.equal(mountFor("ceiling_light"), "ceiling");
  assert.equal(mountFor("tv"), "floor");
  assert.equal(mountFor(undefined), "floor");
  assert.ok(Math.abs(baseHeight("ceiling", 2.8, 0.6) - 2.2) < EPS); // top touches the 2.8 m ceiling
  assert.equal(baseHeight("floor", 2.8, 0.6), 0);
  const room = roomGeometry(5, 4);
  const sofa = sofaItem({ x: 2.5, z: 2 });
  const lamp = sofaItem({ instanceId: "lamp", title: "Pendant", width_m: 0.5, depth_m: 0.5, height_m: 0.6, x: 2.5, z: 2, mount: "ceiling" });
  assert.deepEqual(localWarnings(lamp, room, [sofa, lamp]), []); // right above the sofa: fine
  const floorLamp = { ...lamp, mount: "floor" as const };
  assert.ok(localWarnings(floorLamp, room, [sofa, floorLamp]).some((w) => /intersects Sofa/.test(w)));
});

test("tables are their own category and stand on the floor", async () => {
  const { categoryOf, categoryLabel, mountFor } = await import("../categories");
  assert.equal(categoryOf("table"), "table");
  assert.equal(categoryLabel("table"), "Tables");
  assert.equal(mountFor("table"), "floor");
  assert.equal(categoryOf("unknown"), "furniture");
});

test("a TV can stand on a table: no collision, and it rests on the tabletop", async () => {
  const { restOnSurfaces } = await import("../placementValidation");
  const room = roomGeometry(5, 4);
  const table = sofaItem({ instanceId: "t", title: "Console", category: "table", width_m: 1.8, height_m: 0.5, depth_m: 0.45, x: 2.5, z: 1 });
  const tv = sofaItem({ instanceId: "tv", title: "TV", category: "tv", width_m: 1.2, height_m: 0.7, depth_m: 0.2, x: 2.5, z: 1 });
  assert.deepEqual(localWarnings(tv, room, [table, tv]), []);
  const [, rested] = restOnSurfaces([table, tv]);
  assert.ok(Math.abs(rested.y - 0.5) < EPS, `${rested.y}`); // on the 0.5 m tabletop
  const [, floor] = restOnSurfaces([table, { ...tv, x: 4.3 }]); // moved off the table
  assert.equal(floor.y, 0);
  const sofa = sofaItem({ x: 2.5, z: 1 }); // other furniture still collides with the TV
  assert.ok(localWarnings(tv, room, [sofa, tv]).some((w) => /intersects Sofa/.test(w)));
});

test("a window fits on a wall face: shifted in from the ends, refused when too big", async () => {
  const { fitWindowOnWall } = await import("../placementValidation");
  const wall = { start: [0, 0] as [number, number], end: [3, 0] as [number, number], length: 3, height: 2.8 };
  const win = { name: "Casement", width: 1.2, height: 1.4 };
  assert.deepEqual(fitWindowOnWall(win, wall, 1.5, 1.5), { along: 1.5, y: 1.5 });
  const pulled = fitWindowOnWall(win, wall, 0.1, 2.7) as { along: number; y: number }; // pulled inside the wall
  assert.ok(Math.abs(pulled.along - 0.6) < EPS && Math.abs(pulled.y - 2.1) < EPS, JSON.stringify(pulled));
  const big = fitWindowOnWall({ ...win, width: 3.5 }, wall, 1.5, 1.5);
  assert.ok("problem" in big && /3\.50 m wide but this wall is 3\.00 m/.test(big.problem));
});

test("wall art hangs at eye level and wardrobes stand on the floor", async () => {
  const { baseHeight, mountFor, categoryLabel } = await import("../categories");
  assert.equal(mountFor("wall_art"), "wall");
  assert.equal(mountFor("wardrobe"), "floor");
  assert.equal(categoryLabel("wardrobe"), "Wardrobes");
  assert.ok(Math.abs(baseHeight("wall", 2.8, 0.8) - 1.1) < EPS); // centre at 1.5 m
  assert.ok(Math.abs(baseHeight("wall", 2.8, 2.6) - 0.2) < EPS); // tall mirror: kept under the ceiling
  const room = roomGeometry(5, 4);
  const sofa = sofaItem({ x: 2.5, z: 2 });
  const art = sofaItem({ instanceId: "art", title: "Print", width_m: 1, height_m: 0.8, depth_m: 0.05, x: 2.5, z: 2, mount: "wall" });
  assert.deepEqual(localWarnings(art, room, [sofa, art]), []); // hangs above the sofa
});

test("an L-shaped cupboard has an L footprint and snaps into a room corner along both walls", async () => {
  const { footprintsOverlap, cornerSnap, footprintCorners } = await import("../placementValidation");
  const room = roomGeometry(5, 4);
  // 3 m along wall A (x), 2 m along wall B (z), 0.6 m deep arms, corner at the back-left.
  const L = sofaItem({ instanceId: "L", title: "Corner wardrobe", width_m: 3, depth_m: 2, height_m: 2.2, arm_m: 0.6, shape: "l_left", x: 1.5, z: 1 });
  assert.equal(footprintCorners(L).length, 6);
  // A small table in the empty inside of the L does not collide; one on an arm does.
  const table = sofaItem({ instanceId: "t", title: "Table", width_m: 0.6, depth_m: 0.6, height_m: 0.7, x: 2.0, z: 1.4 });
  assert.equal(footprintsOverlap(L, table), false);
  assert.equal(footprintsOverlap(L, { ...table, x: 1.5, z: 0.2 }), true);
  assert.deepEqual(localWarnings(L, room, [L, table]), []);
  // Cursor near the (0, 0) corner: corner on the corner, back arm along z = 0, side arm along x = 0.
  const snap = cornerSnap({ shape: "l_left", width: 3, depth: 2, arm: 0.6 }, { ...room, source: "image", wall_thickness: 0.2 }, { x: 0.6, z: 0.5 });
  assert.ok(snap);
  const placed = { ...L, ...snap!, rotation_y: snap!.rotation };
  const xs = footprintCorners(placed).map((c) => c.x);
  const zs = footprintCorners(placed).map((c) => c.z);
  assert.ok(Math.min(...xs) > -1e-6 && Math.min(...xs) < 0.01 && Math.min(...zs) > -1e-6 && Math.min(...zs) < 0.01, `${xs} ${zs}`);
  assert.deepEqual(localWarnings(placed, room, [placed]), []);
  assert.equal(cornerSnap({ shape: "l_left", width: 3, depth: 2, arm: 0.6 }, { ...room, source: "image", wall_thickness: 0.2 }, { x: 2.5, z: 2 }), null); // mid-room: no snap
});

test("measuring two models: clear gap between footprints and centre distance", async () => {
  const { measureBetween } = await import("../placementValidation");
  const a = sofaItem({ instanceId: "a", width_m: 2, depth_m: 1, x: 1, z: 1 }); // x ∈ [0, 2]
  const b = sofaItem({ instanceId: "b", width_m: 1, depth_m: 1, x: 3.5, z: 1 }); // x ∈ [3, 4]
  const m = measureBetween(a, b);
  assert.ok(Math.abs(m.gap - 1) < EPS, `${m.gap}`);
  assert.ok(Math.abs(m.centres - 2.5) < EPS);
  assert.ok(Math.abs(m.from.x - 2) < EPS && Math.abs(m.to.x - 3) < EPS);
  assert.equal(measureBetween(a, { ...b, x: 2.2 }).gap, 0); // overlapping
  const diag = measureBetween(a, { ...b, x: 3.5, z: 3.5 }); // corner to corner: (2,1.5) → (3,3)
  assert.ok(Math.abs(diag.gap - Math.hypot(1, 1.5)) < EPS, `${diag.gap}`);
});
