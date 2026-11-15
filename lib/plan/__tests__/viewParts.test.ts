import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { partsTable } from "../../designs/viewParts";

test("the report's parts table measures real sizes (rotation and scale included), quantities and added parts' offsets", () => {
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
  assert.deepEqual([row("door").width, row("door").height, row("door").depth, row("door").thickness], [40, 160, 2, 2]);
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

test("a part's label carries its real size (a board: face sizes and thickness) and an added part's offsets", async () => {
  const { labelLines } = await import("../../designs/viewParts");
  const shelf = { n: 1, id: "s", name: "Shelf 1", added: true, quantity: 1, material: null, color: null, width: 60, height: 1.8, depth: 45, thickness: 1.8, offsets: { top: 30, bottom: 50.5, left: 0, right: 0, front: 0.5, back: 0.5 }, shown: true, name_ar: "رف 1", main_name: "Shelf", main_name_ar: "رف", main: true, kind: null, finish: null, board: null, board_mm: null, surface: null, surface_type: null, paint: null, texture: null, group: "shelves" as const, pic: 0 };
  assert.deepEqual(labelLines(shelf, "en"), ["Shelf 1", "W: 60 × D: 45 · T: 1.8 cm", "Top offset: 30 · Bottom offset: 50.5 cm"]);
  const drawer = { ...shelf, name: "Drawer", added: false, width: 55.6, height: 24.2, depth: 51.6, thickness: 0, offsets: null };
  assert.deepEqual(labelLines({ ...drawer, name_ar: "درج" }, "ar"), ["درج", "عرض: 55.6 × ارتفاع: 24.2 × عمق: 51.6 سم"]);
});

test("labels sit in the side columns, never overlap, keep their parts' order, and none is ever dropped", async () => {
  const { placeLabels, PICTURE } = await import("../../designs/viewParts");
  // 30 parts (original shelves, a partition, animated doors and drawers, two added shelves) spread over the model.
  const items = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, anchor: { x: 700 + (i % 2) * 1000, y: 100 + i * 45 }, width: 480, height: 96, added: i >= 28, size: 30 - i }));
  const order = [...items.filter((i) => i.added), ...items.filter((i) => !i.added)];
  const { placed, left } = placeLabels(order, 12);
  assert.equal(placed.length + left.length, 30); // every part placed or left for a close-up
  assert.ok(placed.some((p) => p.id === "p28") && placed.some((p) => p.id === "p29")); // added parts first
  for (const a of placed) {
    assert.ok(a.y >= PICTURE.TOP && a.y + a.height <= PICTURE.BOTTOM && (a.x + a.width <= PICTURE.W / 4 || a.x >= (3 * PICTURE.W) / 4), "in a side column");
    for (const b of placed) if (a !== b && a.side === b.side) assert.ok(a.y + a.height <= b.y || b.y + b.height <= a.y, "no overlap");
  }
  for (const side of [0, 1]) {
    const column = placed.filter((p) => p.side === side);
    assert.deepEqual(column.map((p) => p.id), [...column].sort((a, b) => a.anchor.y - b.anchor.y).map((p) => p.id)); // leaders do not cross
  }
  // Everything on one side: the other column takes the rest before anything is left out.
  const oneSide = Array.from({ length: 24 }, (_, i) => ({ id: `q${i}`, anchor: { x: 300, y: 60 * i }, width: 400, height: 110, added: false, size: 1 }));
  const r = placeLabels(oneSide, 24);
  assert.ok(r.placed.some((p) => p.side === 1) && r.placed.length > 13);
  assert.equal(r.placed.length + r.left.length, 24);
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
});

test("labels go beside their parts, inside the picture, never on each other, their leaders never crossing", async () => {
  const { placeNear } = await import("../../designs/viewParts");
  const size = { w: 2400, h: 2400 };
  // A grid of 12 shelves: each label wants to sit right next to its own shelf.
  const items = Array.from({ length: 12 }, (_, i) => {
    const x0 = 500 + (i % 3) * 480, y0 = 500 + Math.floor(i / 3) * 360;
    return { id: `s${i}`, part: { x0, y0, x1: x0 + 400, y1: y0 + 40 }, anchor: { x: x0 + 200, y: y0 + 20 }, width: 420, height: 70 };
  });
  const { placed, left } = placeNear(items, size);
  assert.equal(placed.length + left.length, 12); // every label placed or sent to another view
  assert.ok(placed.length >= 6);
  for (const a of placed) {
    assert.ok(a.x >= 24 && a.y >= 24 && a.x + a.width <= 2376 && a.y + a.height <= 2376, "inside the picture");
    for (const b of placed) if (a !== b) assert.ok(a.x + a.width + 14 <= b.x || b.x + b.width + 14 <= a.x || a.y + a.height + 14 <= b.y || b.y + b.height + 14 <= a.y, "no overlap");
    // Beside its own part: no further than a part's width away.
    assert.ok(Math.hypot(a.x + a.width / 2 - a.anchor.x, a.y + a.height / 2 - a.anchor.y) < 600);
  }
  // A crowded spot: labels that cannot be placed cleanly are left for another view, never squeezed in.
  const crowded = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, part: { x0: 1100, y0: 1100, x1: 1300, y1: 1300 }, anchor: { x: 1200, y: 1200 }, width: 600, height: 80 }));
  const r = placeNear(crowded, size);
  assert.ok(r.left.length > 0 && r.placed.length + r.left.length === 30);
});
