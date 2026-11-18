import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { partsTable } from "../../designs/viewParts";

test("the report's parts table measures real sizes on the furniture's axes (rotation and scale included), quantities and added parts' offsets", () => {
  const root = new Group();
  root.scale.set(0.01, 0.01, 0.01); // the file in centimetres: 1 unit = 1 cm
  const add = (name: string, w: number, h: number, d: number, at: [number, number, number], color = "#d9c3a5") => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color }));
    mesh.name = name;
    mesh.position.set(...at);
    root.add(mesh);
    return mesh;
  };
  const side = add("side", 2, 180, 48, [-59, 90, 0]);
  const door = add("door", 40, 160, 2, [0, 90, 25]);
  door.rotation.y = Math.PI / 2; // turned: still 40 × 160 × 2 along its own axes
  const leg = add("leg", 4, 10, 4, [-50, 5, 20], "#222222");
  const leg2 = add("leg", 4, 10, 4, [50, 5, 20], "#222222");
  const handle = add("handle", 2, 20, 3, [15, 100, 27]);
  const shelf = add("Shelf 1", 40, 1.8, 45, [0, 80, 0]);
  root.updateMatrixWorld(true);
  const rows = partsTable({
    slots: [{ id: "side", mesh: side }, { id: "door", mesh: door }, { id: "legs", mesh: leg }, { id: "legs", mesh: leg2 }, { id: "handle", mesh: handle }, { id: "shelf_1", mesh: shelf }],
    names: new Map([["side", "Left side"], ["door", "Door"], ["legs", "Leg"], ["handle", "Handle"], ["shelf_1", "Shelf 1"]]),
    added: [{ id: "shelf_1", type: "shelf", size: [40, 1.8, 45], center: [0, 80, 0], space: [[-20, 10, -23], [20, 170, 23]] }],
    mpu: new Vector3(0.01, 0.01, 0.01),
    edits: { door: { color: "#ffffff", roughness: 0.8, material: { kind: "wood", name: "Oak veneer", wood_type: "mdf", thickness_mm: 18, finish: { name: "Walnut", wood_type: "veneer" } } as never } },
    accessories: new Set(["handle"]),
    whole: new Vector3(1.2, 1.8, 0.5),
  });
  const row = (id: string) => rows.find((r) => r.id === id)!;
  // Turned a quarter: its 40 cm side now runs front to back (the furniture's axes, not the piece's own).
  assert.deepEqual([row("door").width, row("door").height, row("door").depth, row("door").thickness], [2, 160, 40, 2]);
  assert.equal(row("door").material, "Oak veneer");
  assert.equal(row("door").color, "#ffffff");
  // The wood chosen in the editor, as saved: board, thickness, surface, finish; nothing where nothing was chosen.
  assert.deepEqual([row("door").kind, row("door").board, row("door").board_mm, row("door").surface, row("door").surface_type, row("door").finish], ["wood", "mdf", 18, "Walnut", "veneer", "matte"]);
  assert.deepEqual([row("side").kind, row("side").board, row("side").finish], [null, null, null]);
  // Pictures for the main parts only, numbered in order.
  assert.deepEqual(rows.filter((r) => r.pic !== null).map((r) => r.pic), rows.filter((r) => r.main).map((_, i) => i));
  assert.equal(row("handle").pic, null);
  assert.equal(row("legs").quantity, 2); // two alike pieces: one row, ×2
  assert.equal(row("side").color, "#d9c3a5");
  assert.equal(row("handle").shown, false); // on the door: listed, not numbered
  assert.equal(row("legs").shown, false); // too small to point at
  const s = row("shelf_1");
  assert.ok(s.added && s.shown);
  assert.equal(s.n, rows.length); // added parts last
  assert.deepEqual(s.offsets, { top: 89.1, bottom: 69.1, right: 0, left: 0, front: 0.5, back: 0.5 });
  assert.deepEqual(rows.map((r) => r.n), rows.map((_, i) => i + 1));
});

test("part names in Arabic, in Arabic word order; the vendor's own Arabic name first; hardware is not a main part", async () => {
  const { arabicName, isFitting, mainName } = await import("../../designs/partNames");
  assert.equal(arabicName("Left cabinet side"), "جانب خزانة أيسر");
  assert.equal(arabicName("Center wood grain door"), "باب خشبي أوسط");
  assert.equal(arabicName("Upper drawer front"), "واجهة درج علوي");
  assert.equal(arabicName("Internal vertical partition_1"), "فاصل رأسي داخلي 1");
  assert.equal(arabicName("Plain back panel"), "لوح خلفي سادة");
  assert.equal(arabicName("Door", "ضلفة"), "ضلفة");
  assert.equal(arabicName("رف 2"), "رف 2");
  assert.equal(mainName(arabicName("Left wood grain door")), "باب خشبي");
  for (const hw of ["Center door lock key ring", "Left door handle mounting foot", "Drawer slide", "مقبض 1", "مفصلة الباب"]) assert.ok(isFitting(hw), hw);
  for (const part of ["Left wood grain door", "Mirror surround top", "رف 2", "زخرفة 1"]) assert.ok(!isFitting(part), part);
  const { isSoft } = await import("../../designs/partNames");
  for (const soft of ["Mattress", "Bed_blanket_1", "Left pillow", "مرتبة", "مخدة 2", "البطانية"]) assert.ok(isSoft(soft), soft);
  for (const part of ["Headboard", "Bed frame", "Seat cushion", "مقعد"]) assert.ok(!isSoft(part), part);
});

test("dimension lines sit outside the model, one per axis, never on each other or on the geometry", async () => {
  const { DimLayout, blocked } = await import("../../designs/viewParts");
  // The model: a 600 × 900 px block in the middle of a 2400 px picture, drawn as a box seen from the front right.
  const cell = 8, cols = 300, rows = 300;
  const data = new Uint8Array(cols * rows);
  const model = { x: 900, y: 700, width: 640, height: 940 };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (x * cell >= model.x && x * cell < model.x + model.width && y * cell >= model.y && y * cell < model.y + model.height) data[y * cols + x] = 1;
  const mask = { cell, cols, rows, data };
  // Corner i: bit 0 → right (x), bit 1 → top (y), bit 2 → front (z: down-left on the picture).
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ x: 940 + (i & 1 ? 560 : 0) - (i & 4 ? 40 : 0), y: 1600 - (i & 2 ? 860 : 0) + (i & 4 ? 30 : 0) }));
  const layout = new DimLayout({ w: 2400, h: 2400 }, mask);
  const legend = { x: 30, y: 30, width: 500, height: 200 };
  layout.block(legend);
  const dims = ([0, 1, 2] as const).map((axis) => layout.place(corners, axis, `axis ${axis}`, 360, 84, "#172033"));
  assert.ok(dims.every(Boolean), "every axis placed");
  for (const d of dims) {
    assert.ok(!blocked(mask, d!.label), "label off the model");
    assert.ok(!(d!.label.x < legend.x + legend.width && legend.x < d!.label.x + d!.label.width && d!.label.y < legend.y + legend.height && legend.y < d!.label.y + d!.label.height), "not on the legend");
    // The dimension line runs parallel to the measured edge.
    const e = { x: d!.to.x - d!.from.x, y: d!.to.y - d!.from.y }, l = { x: d!.b.x - d!.a.x, y: d!.b.y - d!.a.y };
    assert.ok(Math.abs(e.x * l.y - e.y * l.x) < 1e-6 * Math.hypot(e.x, e.y) * Math.hypot(l.x, l.y) + 1e-6);
    for (const o of dims) if (o !== d) assert.ok(d!.label.x + d!.label.width <= o!.label.x || o!.label.x + o!.label.width <= d!.label.x || d!.label.y + d!.label.height <= o!.label.y || o!.label.y + o!.label.height <= d!.label.y, "labels apart");
  }
  // The thin depth edge (50 px): arrows outside it.
  assert.ok(dims[2]!.short && !dims[0]!.short);
  // No room at all: null, never squeezed in.
  const full = { cell, cols, rows, data: new Uint8Array(cols * rows).fill(1) };
  assert.equal(new DimLayout({ w: 2400, h: 2400 }, full).place(corners, 0, "x", 360, 84, "#000"), null);
});
