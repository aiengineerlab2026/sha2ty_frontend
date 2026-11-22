import assert from "node:assert/strict";
import { test } from "node:test";
import { paintOf, quote, visibleSurface, withBoard, withPaint, type PartMaterial, type PaintLayer } from "../materials";
import { boardOnly, woodBlocked } from "../woodTargets";
import type { MaterialEdit } from "../../vendor/parts";

const board = (id: string, wood_type: string, price: number, unit: PartMaterial["unit"] = "sheet", finish?: PartMaterial["finish"]): PartMaterial =>
  ({ id, kind: "wood", name: id.toUpperCase(), wood_type, price, unit, thickness_mm: 18, sheet: [1.22, 2.44], ...(finish ? { finish } : {}) });
const MDF = board("mdf", "mdf", 900);
const PLY = board("plywood", "plywood", 1400);
const OAK = board("oak", "oak", 60000, "m3");
const WALNUT = board("walnut", "walnut", 90000, "m3");
const WHITE: PaintLayer = { id: "p1", name: "Satin white", price: 300, unit: "l", color: "#ffffff", color_name: "White", coverage_m2: 10 };
const BLACK: PaintLayer = { ...WHITE, id: "p2", name: "Satin black", color: "#111111", color_name: "Black" };
const plain = { name: "", metalness: 0, opacity: 1, transparent: false };

/** What the whole-model wood picker does to one part (ModelViewer changeWood): a bare part takes the wood's look; a
 * painted or coloured one gets only the new board. */
function chooseWood(edit: MaterialEdit | undefined, next: PartMaterial, look: MaterialEdit): MaterialEdit {
  const reason = woodBlocked(plain, edit, []);
  if (boardOnly(reason)) return { ...edit, material: withBoard(edit?.material, next) };
  return { ...edit, ...look, material: next };
}

test("1. white painted MDF → plywood: still white, now plywood underneath, priced as plywood + paint", () => {
  const door: MaterialEdit = { color: "#ffffff", roughness: 0.45, material: withPaint(MDF, WHITE) };
  const after = chooseWood(door, PLY, { mapUrl: "/woods/plywood.jpg", material: PLY });
  assert.equal(after.color, "#ffffff");
  assert.equal(after.mapUrl, undefined); // no plywood texture, grain or colour laid on
  assert.equal(after.material!.wood_type, "plywood");
  assert.equal(visibleSurface(after.material), "paint");
  assert.equal(paintOf(after.material)?.color, "#ffffff");
  const priced = quote(after.material!, 2);
  assert.equal(priced.price, 1400);
  assert.ok(priced.paint && priced.paint.total! > 0, "the paint cost stays");
  assert.equal(priced.total, Math.round((priced.quantity! * 1400 + priced.paint!.total!) * 100) / 100);
});

test("2. black painted plywood → MDF: stays black", () => {
  const door: MaterialEdit = { color: "#111111", material: withPaint(PLY, BLACK) };
  const after = chooseWood(door, MDF, { mapUrl: "/woods/mdf.jpg", material: MDF });
  assert.equal(after.color, "#111111");
  assert.equal(after.material!.wood_type, "mdf");
  assert.equal(paintOf(after.material)?.color_name, "Black");
});

test("3. natural oak → walnut with no finish: the visible grain changes", () => {
  const door: MaterialEdit = { mapUrl: "/woods/oak.jpg", material: OAK };
  const after = chooseWood(door, WALNUT, { mapUrl: "/woods/walnut.jpg", material: WALNUT });
  assert.equal(after.mapUrl, "/woods/walnut.jpg");
  assert.equal(visibleSurface(after.material), "board");
});

test("4. MDF with melamine → another board: the melamine stays what is seen", () => {
  const melamine = { id: "mel", name: "White melamine", wood_type: "melamine", price: 120, unit: "m2" as const };
  const door: MaterialEdit = { mapUrl: "/woods/melamine.jpg", material: { ...MDF, finish: melamine } };
  // The picker keeps the part's finish on the new board (MaterialPicker.pickWood); the look is the finish's.
  const after = chooseWood(door, { ...PLY, finish: melamine }, { mapUrl: "/woods/melamine.jpg", material: { ...PLY, finish: melamine } });
  assert.equal(visibleSurface(after.material), "finish");
  assert.equal(after.material!.finish!.id, "mel");
  assert.equal(after.mapUrl, "/woods/melamine.jpg");
  assert.equal(after.material!.wood_type, "plywood");
});

test("5. oak with clear lacquer → walnut: the wood shows through, so the visible wood changes", () => {
  const lacquer = { id: "lac", name: "Clear lacquer", wood_type: "lacquer", price: 80, unit: "m2" as const };
  const door: MaterialEdit = { mapUrl: "/woods/oak.jpg", material: { ...OAK, finish: lacquer } };
  const after = chooseWood(door, { ...WALNUT, finish: lacquer }, { mapUrl: "/woods/walnut.jpg", roughness: 0.22, material: { ...WALNUT, finish: lacquer } });
  assert.equal(visibleSurface(after.material), "lacquer");
  assert.equal(after.mapUrl, "/woods/walnut.jpg");
});

test("6. save, reload and export keep the board and the paint apart", () => {
  const door: MaterialEdit = { color: "#ffffff", material: withPaint(MDF, WHITE) };
  const saved: MaterialEdit = JSON.parse(JSON.stringify({ ...door, material: quote(door.material!, 1.5) }));
  assert.equal(saved.material!.wood_type, "mdf");
  assert.equal(saved.material!.paint!.color, "#ffffff");
  assert.ok(saved.material!.paint!.quantity! > 0 && saved.material!.quantity! > 0);
  assert.equal(visibleSurface(saved.material), "paint");
  // Reloaded and the wood changed again: still painted.
  assert.equal(chooseWood(saved, PLY, { mapUrl: "/woods/plywood.jpg", material: PLY }).color, "#ffffff");
});

test("older saved edits: a painted-only part keeps its look and gains the board; paint over a board keeps the board", () => {
  const legacy: MaterialEdit = { color: "#ffffff", material: { ...WHITE, kind: "paint" } };
  const after = chooseWood(legacy, MDF, { mapUrl: "/woods/mdf.jpg", material: MDF });
  assert.equal(after.material!.kind, "wood");
  assert.equal(paintOf(after.material)?.id, "p1");
  assert.equal(after.color, "#ffffff");
  // Painting a wooden part puts the paint over its board; a part with no board is painted on its own.
  assert.equal(withPaint(OAK, WHITE).wood_type, "oak");
  assert.equal(withPaint(undefined, WHITE).kind, "paint");
  // A colour picked by hand is kept too.
  assert.equal(chooseWood({ color: "#336699" }, PLY, { mapUrl: "/woods/plywood.jpg", material: PLY }).mapUrl, undefined);
});
