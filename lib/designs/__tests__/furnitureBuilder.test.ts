import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, Vector3, type Mesh } from "three";
import { buildFurniture, furnitureParts, PARTS, partOf, partOptions, type FurnitureKind, type FurnitureSpec } from "../../vendor/furnitureBuilder";

const spec = (kind: FurnitureKind, w: number, d: number, h: number): FurnitureSpec => ({
  kind, title: "", description: "", style: "", width_m: w, depth_m: d, height_m: h, leg_shape: "splayed", leg_height_m: 0.15, leg_thickness_m: 0.05,
  back_shape: "rounded", back_height_m: 0.5, seat_height_m: 0.45, top_shape: "oval", top_thickness_m: 0.04, arms: "rounded", cushions: 3, tufted: true,
  looks: {},
});

test("each type is built as its named modules, in the part list's order, at its overall size", () => {
  for (const [kind, w, d, h] of [["bed", 1.8, 2.2, 1.2], ["sofa", 2.2, 0.95, 0.85], ["chair", 0.5, 0.55, 0.9], ["dining_table", 1.8, 0.95, 0.75]] as const) {
    const group = buildFurniture(spec(kind, w, d, h));
    assert.deepEqual(group.children.map((m) => (m as Mesh).material && m.name), furnitureParts(kind).components.map((c) => c.id), kind);
    assert.equal(group.children.length, PARTS[kind].length);
    const size = new Box3().setFromObject(group).getSize(new Vector3());
    for (const [got, want] of [[size.x, w], [size.y, h], [size.z, d]]) assert.ok(Math.abs(got - want) < 0.12, `${kind}: ${got} vs ${want}`);
  }
});

test("every part of every type has variants, each one a single mesh of that part", () => {
  for (const kind of ["bed", "sofa", "chair", "dining_table"] as const) {
    const s = spec(kind, 1, 1, 1);
    const options = partOptions(s);
    assert.deepEqual(Object.keys(options).sort(), [...PARTS[kind]].sort(), kind);
    for (const [part, list] of Object.entries(options)) {
      assert.ok(list.length >= 1 && list.length <= 3, `${kind} ${part}`);
      for (const option of list) assert.equal(partOf(option.spec, part).children.length, 1);
    }
  }
});

test("a modern upholstered bed: channel headboard, box base, still its five parts at its size", () => {
  const group = buildFurniture({ ...spec("bed", 1.8, 2.2, 1.3), channels: true, bed_base: "box", back_shape: "straight" });
  assert.equal(group.children.length, 5);
  const size = new Box3().setFromObject(group).getSize(new Vector3());
  assert.ok(Math.abs(size.y - 1.3) < 0.05 && Math.abs(size.z - 2.2) < 0.05 && size.x - 1.8 < 0.16, `${size.x} ${size.y} ${size.z}`);
});

test("part sizes: four legs in one mesh read as one leg × 4, a panel with buttons as the panel", async () => {
  const { pieces, sizeText } = await import("../../vendor/partSizes");
  const chair = buildFurniture({ ...spec("chair", 0.5, 0.55, 0.9), leg_shape: "square", tufted: true, back_shape: "straight" });
  const legs = chair.children.find((m) => m.name === "legs") as import("three").Mesh;
  assert.equal(sizeText(pieces(legs)).text, "5 × 39 × 5 cm (×4)"); // one leg (5 cm square, 39 cm long), four of them
  const back = chair.children.find((m) => m.name === "chair_back") as import("three").Mesh;
  assert.doesNotMatch(sizeText(pieces(back)).text, /\(×\d+\)/); // the buttons are not counted as pieces
});
