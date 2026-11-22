import assert from "node:assert/strict";
import { test } from "node:test";
import { specClasses, woodBlocked } from "../woodTargets";
import type { PartDocument } from "../../vendor/parts";

const plain = { name: "", metalness: 0, opacity: 1, transparent: false };
const wood = { material: { id: "oak", kind: "wood" as const, name: "Oak" } } as never;

test("wood goes on a plain wooden part, and again on one already given a wood", () => {
  assert.equal(woodBlocked(plain, undefined, []), null);
  assert.equal(woodBlocked(plain, { ...(wood as object), color: "#ffffff" } as never, ["solid_wood"]), null);
});

test("a chosen paint, fabric or colour is never covered by wood", () => {
  assert.equal(woodBlocked(plain, { material: { kind: "paint" } } as never, []), "paint");
  assert.equal(woodBlocked(plain, { material: { kind: "fabric" } } as never, []), "fabric");
  assert.equal(woodBlocked(plain, { color: "#d7d1c4" }, []), "colour");
});

test("a part whose own material is paint, glass, mirror or metal keeps it", () => {
  assert.equal(woodBlocked({ ...plain, materialClass: "painted_wood" }, undefined, []), "painted_wood");
  assert.equal(woodBlocked({ ...plain, transmission: 0.9 }, undefined, []), "glass");
  assert.equal(woodBlocked({ ...plain, transparent: true, opacity: 0.4 }, undefined, []), "glass");
  assert.equal(woodBlocked({ ...plain, metalness: 1 }, undefined, []), "metal");
  assert.equal(woodBlocked({ ...plain, name: "Lacquer white" }, undefined, []), "painted_wood"); // its board may still change
  assert.equal(woodBlocked(plain, undefined, ["mirror"]), "mirror");
});

const doc: PartDocument = {
  components: [],
  analysis: { objectType: "wardrobe", components: [
    { id: "body", name: "Carcass", role: "structural", box: [0, 0, 1, 1] },
    { id: "door_l", name: "Left door", role: "functional", box: [0, 0.1, 0.5, 0.9] },
    { id: "handle", name: "Handle", role: "functional", box: [0.48, 0.4, 0.5, 0.45] },
    { id: "vase", name: "Vase", role: "decorative", box: [0.4, 0, 0.5, 0.1] },
  ] },
  materials: { parts: { body: { class: "laminate" }, door_l: { class: "painted_wood" }, handle: { class: "metal" }, vase: { class: "other" } } },
};

test("a linked part uses its own reading; a fused mesh with painted fronts is not turned to wood", () => {
  assert.deepEqual(specClasses(doc, "body", false), ["laminate"]);
  assert.deepEqual(specClasses(doc, undefined, false), []);
  // One fused mesh is the whole wardrobe: its painted doors count, its small metal handle and the vase do not.
  assert.deepEqual(specClasses(doc, undefined, true), ["laminate", "painted_wood"]);
  assert.equal(woodBlocked(plain, undefined, specClasses(doc, undefined, true)), "painted_wood");
  assert.equal(woodBlocked(plain, undefined, specClasses(doc, "body", false)), null);
});
