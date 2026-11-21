import assert from "node:assert/strict";
import { test } from "node:test";
import { Color, MeshPhysicalMaterial, Texture } from "three";
import { fidelityProblem, linkedVisual, structuralEdits, structuralParts } from "../structural";
import { restoreMaterial } from "../materialRestore";
import type { CarpenterModel, PartDocument } from "../../vendor/parts";

const part = (id: string, name: string, specId?: string, source: "observed" | "inferred" = "observed") => ({
  id, name, specId, source, materialCategory: "wood", classification: "structural",
  sizeCm: { width: 80, height: 150, depth: 1.8 }, positionCm: { x: 0, y: 0, z: 0 }, orientation: [0, 0, 0], estimated: true,
});

const carpenter: CarpenterModel = {
  url: "https://cdn.test/m.carpenter.glb", fabricationReady: false, estimated: true, note: "",
  components: [part("left_door_1", "Left mirrored door", "door_left"), part("drawer_1_2", "Drawer 1", "drawer_1"), part("back_panel_3", "Back Panel", "body", "inferred"), part("leg_4", "Leg 1")],
  excluded: [],
};

// The visual model: other meshes, other ids, other topology. Only the spec's component id links them.
const visual: PartDocument = {
  separated: true,
  components: [
    { id: "mesh_7", name: "Mirror door", editable: true, analysisId: "door_left" },
    { id: "mesh_2", name: "Carcass", editable: true, analysisId: "body" },
    { id: "mesh_3", name: "Plinth", editable: true },
  ],
};

test("every structural board is its own editable part, linked to the spec component it was built from", () => {
  const doc = structuralParts(carpenter);
  assert.deepEqual(doc.components.map((p) => [p.id, p.editable, p.analysisId ?? null, p.estimated]), [
    ["left_door_1", true, "door_left", false], ["drawer_1_2", true, "drawer_1", false], ["back_panel_3", true, "body", true], ["leg_4", true, null, false],
  ]);
});

test("structural and visual parts are linked by the spec, never by mesh id or order", () => {
  assert.deepEqual(linkedVisual(carpenter, visual), { left_door_1: ["Mirror door"], drawer_1_2: [], back_panel_3: ["Carcass"], leg_4: [] });
  assert.deepEqual(linkedVisual(carpenter, null).left_door_1, []);
});

test("woods from the material spec are laid on boards the vendor has not edited; saved edits win", () => {
  const edits = structuralEdits({ ...carpenter, material_edits: { drawer_1_2: { color: "#112233" } } }, {
    door_left: { class: "mirror", woodType: null }, drawer_1: { class: "solid_wood", woodType: "oak" }, body: { class: "solid_wood", woodType: "walnut" },
  });
  assert.equal(edits.left_door_1, undefined); // a mirror keeps the file's material
  assert.deepEqual(edits.drawer_1_2, { color: "#112233" });
  assert.deepEqual(edits.back_panel_3, { mapUrl: "/woods/walnut.jpg", mapping: "box", tile: 0.6 });
  assert.equal(edits.leg_4, undefined); // no spec component: nothing assumed
});

test("a low-quality model names the step where it lost fidelity", () => {
  assert.equal(fidelityProblem({ ...visual, fidelity: { ok: true, quality: "ok", lostAt: null, stages: [] } }), null);
  const problem = fidelityProblem({ ...visual, fidelity: { ok: false, quality: "low", lostAt: "materials", stages: [{ stage: "materials", ok: false, issues: ["lost its normal map"] }] } });
  assert.deepEqual(problem, { stage: "materials", issues: ["lost its normal map"] });
});

test("resetting a part brings back every loaded material property, not only its colour", () => {
  const loaded = new MeshPhysicalMaterial({ color: new Color(0x8b5a2b), roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.4, transmission: 0.9, clearcoat: 0.5 });
  loaded.roughnessMap = new Texture();
  loaded.metalnessMap = new Texture();
  loaded.normalMap = new Texture();
  const current = loaded.clone();
  // What laying a pattern does (ModelViewer neutralise): white, no relief maps, opaque.
  current.color.set(0xffffff);
  current.roughnessMap = null;
  current.metalnessMap = null;
  current.transparent = false;
  current.opacity = 1;
  current.transmission = 0;
  restoreMaterial(current, loaded);
  assert.equal(current.color.getHex(), 0x8b5a2b);
  assert.equal(current.roughnessMap, loaded.roughnessMap);
  assert.equal(current.metalnessMap, loaded.metalnessMap);
  assert.equal(current.normalMap, loaded.normalMap);
  assert.equal(current.transparent, true);
  assert.equal(current.opacity, 0.4);
  assert.equal(current.transmission, 0.9);
  assert.equal(current.clearcoat, 0.5);
});
