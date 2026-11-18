import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { axisTexts, checkMeasurements, orientedSize, partSize, tableRows, type RestBox } from "../measure";
import type { ViewPart } from "../viewParts";

const box = (w: number, h: number, d: number) => new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial());
const cm = (v: number) => Math.round(v * 1000) / 10;
const sizeOf = (m: Mesh) => orientedSize(m).size.toArray().map(cm);

test("sizes come from the geometry and its world transforms, each side on the furniture's own axis", () => {
  // A side panel modelled lying along x (58 × 200 × 1.8) and turned to stand at the side: 1.8 wide, 58 deep.
  const side = box(0.58, 2, 0.018);
  side.rotation.y = Math.PI / 2;
  assert.deepEqual(sizeOf(side), [1.8, 200, 58]);
  assert.deepEqual(orientedSize(side).axes, [2, 1, 0]); // its own x is the depth, its own z the width

  // A shelf modelled standing up (60 × 45 × 1.8) and laid flat: 60 wide, 1.8 high, 45 deep.
  const shelf = box(0.6, 0.45, 0.018);
  shelf.rotation.x = -Math.PI / 2;
  assert.deepEqual(sizeOf(shelf), [60, 1.8, 45]);

  // Scaled, not uniformly: a 1 × 1 × 1 cube scaled to a door 45 × 190 × 1.8.
  const door = box(1, 1, 1);
  door.scale.set(0.45, 1.9, 0.018);
  assert.deepEqual(sizeOf(door), [45, 190, 1.8]);

  // Nested groups: a file in centimetres (×0.01) inside a group turned upside down and twice as large: lengths
  // scale, the turn changes no axis.
  const outer = new Group();
  outer.rotation.z = Math.PI;
  outer.scale.setScalar(2);
  const file = new Group();
  file.scale.setScalar(0.01);
  const panel = box(40, 80, 2);
  outer.add(file.add(panel));
  outer.updateMatrixWorld(true);
  assert.deepEqual(sizeOf(panel), [80, 160, 4]);

  // Mirrored (negative scale): still a positive size.
  const mirrored = box(0.5, 0.7, 0.02);
  mirrored.scale.x = -1;
  assert.deepEqual(sizeOf(mirrored), [50, 70, 2]);

  // Alike pieces: one size × n; different ones: the box around them.
  const legs = [box(0.04, 0.1, 0.04), box(0.04, 0.1, 0.04)];
  legs[1].position.x = 1;
  assert.equal(partSize(legs).quantity, 2);
  const mixed = [box(0.1, 0.1, 0.1), box(0.1, 0.1, 0.1)];
  mixed[1].position.set(0.5, 0, 0);
  mixed[1].scale.set(2, 1, 1);
  mixed.forEach((m) => m.updateMatrixWorld(true));
  const together = partSize(mixed);
  assert.equal(together.quantity, 1);
  assert.deepEqual(together.size.toArray().map(cm), [65, 10, 10]);
});

const part = (id: string, over: Partial<ViewPart>): ViewPart => ({
  n: 1, id, name: id, added: false, quantity: 1, material: null, color: null, width: 50, height: 50, depth: 50, thickness: 0, offsets: null, shown: true,
  name_ar: id, main_name: id, main_name_ar: id, main: true, kind: null, finish: null, board: null, board_mm: null, surface: null, surface_type: null,
  paint: null, texture: null, group: "structure", pic: null, ...over,
});

test("a close-up shows its table row's own numbers: identical parts once, different sizes their own rows, thickness named, each line labelled by its world axis", () => {
  const rows = tableRows([
    part("door-l", { main_name: "Door", group: "doors", width: 59, height: 192, depth: 1.8, thickness: 1.8 }),
    part("side", { main_name: "Side", width: 1.8, height: 200, depth: 58, thickness: 1.8 }),
    part("door-r", { main_name: "Door", group: "doors", width: 59.6, height: 192, depth: 1.8, thickness: 1.8 }),
    part("door-big", { main_name: "Door", group: "doors", width: 90, height: 192, depth: 1.8, thickness: 1.8 }),
  ], "en");
  // 59 and 59.6 cm doors are cut differently: two rows, never one with a range.
  assert.deepEqual(rows.map((r) => [r.parts.map((p) => p.id), r.quantity]), [[["side"], 1], [["door-l"], 1], [["door-r"], 1], [["door-big"], 1]]);
  const twins = tableRows([part("a", { main_name: "Door", group: "doors", width: 59 }), part("b", { main_name: "Door", group: "doors", width: 59.04 })], "en");
  assert.deepEqual(twins.map((r) => r.quantity), [2]); // the same to the millimetre: one row × 2
  // The side panel turned: its own x is the depth, its own z the width, here its thickness.
  // A flat panel is named the way the cutting list cuts it: longest edge Length, the other face Width, thinnest Thickness.
  assert.deepEqual(axisTexts(rows[0], [2, 1, 0], "en"), ["Width 58 cm", "Length 200 cm", "Thickness 1.8 cm"]);
  assert.deepEqual(axisTexts(rows[2], [0, 1, 2], "en"), ["Width 59.6 cm", "Length 192 cm", "Thickness 1.8 cm"]);
  assert.deepEqual(axisTexts(rows[3], [0, 1, 2], "ar"), ["العرض 90 سم", "الطول 192 سم", "السُمك 1.8 سم"]);
});

const at = (min: [number, number, number], max: [number, number, number]): RestBox => ({ min, max });

test("the checks say what does not add up, and never change a size", () => {
  const model = { width: 120, height: 200, depth: 60 };
  const parts = [
    part("left", { width: 1.8, height: 200, depth: 58, thickness: 1.8 }),
    part("shelf", { group: "shelves", width: 118, height: 1.8, depth: 55, thickness: 1.8 }), // 2 cm into each side
    part("door-a", { group: "doors", width: 60, height: 192, depth: 1.8, thickness: 1.8 }),
    part("door-b", { group: "doors", width: 60, height: 192, depth: 1.8, thickness: 1.8 }), // touching door-a: no gap
    part("tall", { width: 50, height: 210, depth: 2, thickness: 2 }), // taller than the model
    part("flat-door", { group: "doors", width: 40, height: 1.8, depth: 30, thickness: 1.8 }), // thinnest top to bottom
    part("empty", { width: 0 }),
  ];
  const boxes = new Map([
    ["left", at([0, 0, 0], [1.8, 200, 58])],
    ["shelf", at([0, 80, 0], [118, 81.8, 55])],
    ["door-a", at([0, 4, 58], [60, 196, 59.8])],
    ["door-b", at([60, 4, 58], [120, 196, 59.8])],
  ]);
  const original = JSON.stringify(parts);
  const checks = checkMeasurements({ parts, model, requested: { width: 120, height: 210, depth: 60 }, scaleKnown: false, boxes });
  assert.equal(JSON.stringify(parts), original);
  const codes = checks.map((c) => `${c.code}:${c.parts.join("+")}${c.params.axis ? `:${c.params.axis}` : ""}`);
  assert.deepEqual(codes.sort(), [
    "approx:", "axis:flat-door", "clearance:door-a+door-b", "exceeds:tall:height", "mismatch::height", "missing:empty", "overlap:left+shelf",
  ].sort());
  assert.deepEqual(checks.find((c) => c.code === "mismatch")!.params, { axis: "height", requested: 210, model: 200, diff: -10 });
  // Estimates, a size the customer did not ask for, a part larger than the model, a missing size: critical.
  assert.deepEqual(checks.filter((c) => c.level === "critical").map((c) => c.code).sort(), ["approx", "exceeds", "mismatch", "missing"]);
  assert.equal(checks.find((c) => c.code === "overlap")!.params.depth, 1.8);
  // A model in metres read as centimetres.
  assert.ok(checkMeasurements({ parts: [], model: { width: 1.2, height: 2, depth: 0.6 }, requested: null, scaleKnown: true, boxes: new Map() }).some((c) => c.code === "units"));
  // Nothing wrong: nothing said.
  assert.deepEqual(checkMeasurements({ parts: [parts[0]], model, requested: model, scaleKnown: true, boxes }), []);
  // Inside the 3D model, but taller than the customer asked for: critical, and the part is not cut down.
  const fitted = part("panel", { width: 50, height: 205, depth: 40, thickness: 1.8 });
  const before = fitted.height;
  const over = checkMeasurements({ parts: [fitted], model: { width: 120, height: 210, depth: 60 }, requested: { width: 120, height: 200, depth: 60 }, scaleKnown: true, boxes: new Map() });
  assert.equal(fitted.height, before);
  assert.deepEqual(over.find((c) => c.code === "over_request")!.params, { axis: "height", value: 205, overall: 200 });
  assert.equal(over.some((c) => c.code === "exceeds"), false);
});

test("a whole wardrobe from a nested file: doors, drawers, shelves, a divider and panels measured on the furniture's axes, joints told from errors", async () => {
  const { partsTable } = await import("../viewParts");
  // The file in centimetres inside a group (×0.01), as exported; the sides modelled lying along x and turned.
  const root = new Group();
  const file = new Group();
  file.scale.setScalar(0.01);
  root.add(file);
  const parts: [string, [number, number, number], [number, number, number], number][] = [
    ["Left side", [58, 200, 1.8], [-59.1, 100, 0], Math.PI / 2], ["Right side", [58, 200, 1.8], [59.1, 100, 0], Math.PI / 2],
    ["Top", [120, 1.8, 58], [0, 199.1, 0], 0], // sits on the sides' full height: they fill the same space
    ["Bottom", [116.4, 1.8, 58], [0, 6, 0], 0],
    ["Back panel", [116.4, 196, 0.6], [0, 100, -28.7], 0], // in a groove in the bottom (0.6 cm into it)
    ["Divider", [1.8, 120, 55], [0, 70, 0.5], 0], // standing, between the drawers
    ["Shelf 1", [117.4, 1.8, 55], [0, 140, 0.5], 0], // let 0.5 cm into each side: a housing joint
    ["Left door", [59.2, 192, 1.8], [-29.6, 101, 30], 0], ["Right door", [59.2, 192, 1.8], [29.6, 101, 30], 0],
    ["Drawer 1", [56, 20, 50], [-29, 20, 2], 0], ["Drawer 2", [56, 20, 50], [29, 20, 2], 0],
  ];
  const slots = parts.map(([name, size, at, turn]) => {
    const mesh = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial());
    mesh.name = name;
    mesh.position.set(...at);
    mesh.rotation.y = turn;
    file.add(mesh);
    return { id: name, mesh };
  });
  root.updateMatrixWorld(true);
  const rows = partsTable({
    slots, names: new Map(parts.map(([n]) => [n, n])), added: [], mpu: new Vector3(0.01, 0.01, 0.01), edits: {}, accessories: new Set(),
    whole: new Vector3(1.2, 2, 0.6), bounds: new Box3().setFromObject(root), moving: new Map([["Left door", "rotation"], ["Right door", "rotation"], ["Drawer 1", "translation"], ["Drawer 2", "translation"]]),
  });
  const row = (id: string) => rows.find((r) => r.id === id)!;
  assert.deepEqual([row("Left side").width, row("Left side").height, row("Left side").depth, row("Left side").thickness], [1.8, 200, 58, 1.8]);
  assert.deepEqual([row("Divider").width, row("Divider").height, row("Divider").depth], [1.8, 120, 55]);
  assert.deepEqual([row("Left door").group, row("Drawer 1").group, row("Shelf 1").group], ["doors", "drawers", "shelves"]);
  assert.deepEqual(tableRows(rows.filter((r) => r.main), "en").map((r) => [r.parts[0].main_name, r.quantity]), [
    ["Side", 2], ["Top", 1], ["Bottom", 1], ["Back panel", 1], ["Divider", 1], ["Door", 2], ["Drawer", 2], ["Shelf", 1],
  ]);
  const boxes = new Map(slots.map(({ id, mesh }) => {
    const b = new Box3().setFromObject(mesh);
    return [id, { min: b.min.toArray().map((v) => v * 100) as RestBox["min"], max: b.max.toArray().map((v) => v * 100) as RestBox["max"] }];
  }));
  const checks = checkMeasurements({ parts: rows, model: { width: 120, height: 200, depth: 60 }, requested: { width: 120, height: 200, depth: 60 }, scaleKnown: true, boxes });
  const found = (code: string) => checks.filter((c) => c.code === code).map((c) => [...c.parts].sort().join("+")).sort();
  assert.deepEqual(found("overlap"), ["Left side+Top", "Right side+Top"]); // the top fills the sides' space: an error
  assert.ok(checks.filter((c) => c.code === "overlap").every((c) => c.level === "warning"));
  assert.deepEqual(found("joint"), ["Back panel+Bottom", "Left side+Shelf 1", "Right side+Shelf 1"]); // grooves and housings: to confirm
  assert.ok(checks.filter((c) => c.code === "joint").every((c) => c.level === "info"));
  assert.deepEqual(found("clearance"), ["Left door+Right door"]);
  assert.deepEqual(found("drawer"), ["Divider+Drawer 1", "Divider+Drawer 2"]); // 0.1 cm beside the divider: tight for a slide
  assert.deepEqual(found("shelf"), []); // the shelf is housed (a joint), not short of the side
  assert.equal(checks.filter((c) => c.level === "critical").length, 0); // nothing that stops manufacturing
});

test("a drawer almost against a side, and a shelf that stops short of it, are gaps rather than joints", () => {
  const model = { width: 120, height: 200, depth: 60 };
  const parts = [
    part("side", { width: 1.8, height: 200, depth: 58, thickness: 1.8 }),
    part("drawer", { group: "drawers", width: 50, height: 16, depth: 45, thickness: 1.6 }),
    part("shelf", { group: "shelves", width: 50, height: 1.8, depth: 40, thickness: 1.8 }),
  ];
  const boxes = new Map<string, RestBox>([
    ["side", at([0, 0, 0], [1.8, 200, 58])],
    ["drawer", at([2.2, 20, 2], [52.2, 36, 47])], // 0.4 cm from the side
    ["shelf", at([2.0, 100, 2], [52, 101.8, 42])], // 0.2 cm short of the side
  ]);
  const checks = checkMeasurements({ parts, model, requested: model, scaleKnown: true, boxes });
  assert.deepEqual(checks.map((c) => c.code).sort(), ["drawer", "shelf"]);
  assert.equal(checks.find((c) => c.code === "drawer")!.params.gap, 0.4);
  assert.equal(checks.find((c) => c.code === "shelf")!.params.gap, 0.2);
  assert.ok(checks.every((c) => c.level === "warning"));
});
