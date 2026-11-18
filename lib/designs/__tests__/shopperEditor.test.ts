import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from "three";
import { draftName, hasUnsavedChanges } from "../unsaved";
import { guideWithOptions } from "../priceGuide";
import { deltaE, STUDIO_LIGHT } from "../../vendor/studioLight";
import { sameShape, variantProblems } from "../../vendor/variantCheck";

const chair = { width: 0.52, height: 0.86, depth: 0.56 };

test("a resize alone is an unsaved change; nothing changed, or saved, is not", () => {
  const base = { editorDirty: false, newFile: false, sourceDims: chair };
  // A new design: the catalogue size is the baseline.
  assert.equal(hasUnsavedChanges({ ...base, dims: chair, savedDims: undefined }), false);
  assert.equal(hasUnsavedChanges({ ...base, dims: { ...chair, width: 0.48 }, savedDims: undefined }), true);
  // A saved design: its saved size is the baseline (after saving 48 cm, nothing is pending).
  assert.equal(hasUnsavedChanges({ ...base, dims: { ...chair, width: 0.48 }, savedDims: { ...chair, width: 0.48 } }), false);
  assert.equal(hasUnsavedChanges({ ...base, dims: chair, savedDims: { ...chair, width: 0.48 } }), true);
  // Materials, variants, added or removed parts (the viewer's flag) and a new 3D file count too.
  assert.equal(hasUnsavedChanges({ ...base, editorDirty: true, dims: chair, savedDims: chair }), true);
  assert.equal(hasUnsavedChanges({ ...base, newFile: true, dims: chair, savedDims: chair }), true);
});

test("a draft saves without a name: a temporary one from the listing and the date", () => {
  const t = (s: string, v: Record<string, string> = {}) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");
  const name = draftName("كرسي طعام رمال الجوز", t, new Date(2026, 10, 18));
  assert.match(name, /^Draft · كرسي طعام رمال الجوز · /);
  assert.ok(name.length <= 200);
  assert.match(draftName("  ", t), /^Draft · Model · /);
});

test("materials match their swatch under the studio light (walnut measured on screen)", () => {
  // The neutral room, no warm preset, no ambient wash-out (lib/vendor/studioLight).
  assert.equal(STUDIO_LIGHT.ambient, 0);
  const swatch: [number, number, number] = [110, 74, 52]; // public/woods/walnut.jpg, median
  const before: [number, number, number] = [125, 78, 41]; // warehouse preset: orange, lighter
  const after: [number, number, number] = [110, 67, 37]; // studio light, front leg
  assert.ok(deltaE(before, swatch) > 10, String(deltaE(before, swatch)));
  assert.ok(deltaE(after, swatch) < 8, String(deltaE(after, swatch)));
  assert.equal(Math.round(deltaE(swatch, swatch)), 0);
});

test("duplicate or visually identical variants are refused before publishing", () => {
  const parts = [{ id: "back", name: "Chair Back", variants: [
    { id: "a", name: "Straight back", glb_url: "s.glb" },
    { id: "b", name: "Curved back", glb_url: "s.glb" },
    { id: "c", name: "straight back ", glb_url: "t.glb" },
    { id: "d", name: "No file", glb_url: "" },
  ] }];
  assert.deepEqual(variantProblems(parts).map((p) => p.problem), ["same-file", "same-name", "no-file"]);
  // The same shape moved 1.8 cm (the "Curved back" that is the straight one) once fitted into the same box.
  const flat = new BoxGeometry(0.5, 0.35, 0.08, 8, 6, 2);
  const moved = flat.clone().translate(0, 0, 0.018);
  moved.translate(0, 0, -0.018); // fitInto puts both in the part's box
  assert.ok(sameShape(flat, moved));
  // A really curved back: the middle bulges 6 cm.
  const curved = flat.clone();
  const pos = curved.getAttribute("position");
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + 0.06 * Math.cos((pos.getX(i) / 0.5) * Math.PI));
  assert.ok(!sameShape(flat, curved));
  const empty = new BufferGeometry();
  empty.setAttribute("position", new Float32BufferAttribute([], 3));
  assert.ok(!sameShape(flat, empty));
});

test("the price guide adds the vendor's price for the options picked, and says nothing without enough bids", () => {
  const guide = { count: 4, requests: 2, low: 2200, high: 2750, median: 2480 };
  assert.deepEqual(guideWithOptions(guide, [150, null, -50]), { low: 2300, high: 2850, extra: 100 });
  assert.equal(guideWithOptions({ ...guide, low: null, high: null }, [150]), null);
  assert.equal(guideWithOptions(null, []), null);
});
