import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Box3, Group, Mesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type AnimationConfig } from "../../vendor/animation";
import type { ModelValidation } from "../../vendor/parts";
import { authoritativeMovers } from "../../vendor/reconstruct";
import { modelNotes, publishBlockers } from "../../vendor/verdict";

// The wardrobe from the report (model 43a5b0c2): its stored verdict said needs_repair / publishable false with the
// divider-through-the-base errors listed twice; the backend's automatic repair fixed the file (dividerWardrobe.glb).
type Doc = { components: { id: string; kind: string; box: number[][] }[]; animation: AnimationConfig; validation: ModelValidation; legacyValidation: ModelValidation; sizeSource?: string };
const doc: Doc = JSON.parse(readFileSync("lib/plan/__tests__/dividerWardrobe.json", "utf8"));
const source = (path: string) => readFileSync(path, "utf8");

test("a usable model publishes whatever its technical checks say (geometry errors, intersections, coplanar faces, likeness)", () => {
  const withErrors = { glbUrl: "model.glb", validation: doc.legacyValidation };
  assert.equal(doc.legacyValidation.status, "needs_repair");
  assert.equal(doc.legacyValidation.publishable, false);
  assert.ok(doc.legacyValidation.errors.some((e) => e.includes("pass through each other")) && doc.legacyValidation.errors.some((e) => e.includes("flicker")));
  assert.deepEqual(publishBlockers(withErrors), []);
  for (const v of [
    { ok: false, errors: ["Door 1: inside out."], warnings: [], parts: 9, status: "needs_repair", publishable: false },
    { ok: true, errors: [], warnings: ["Door: its colour differs from the photo (ΔE 38)."], parts: 9, status: "valid_with_warnings" },
    { ok: true, errors: [], warnings: [], parts: 9, status: "needs_confirmation", confirm: ["How Door 1 opens was estimated."] },
  ] as ModelValidation[]) {
    assert.deepEqual(publishBlockers({ glbUrl: "model.glb", ...{ validation: v } }), []);
  }
});

test("only a missing 3D file stops a model being saved ready", () => {
  assert.equal(publishBlockers({ glbUrl: null }).length, 1);
  assert.equal(publishBlockers({}).length, 1);
});

test("model notes are categories, never the technical messages", () => {
  const notes = modelNotes({ validation: { ...doc.validation, notes: [{ kind: "check", text: "Bottom panel and Central vertical divider pass through each other (176 cm³)." }, { kind: "material", text: "Side: material estimated (in shadow)." }] }, sizeSource: "photo" });
  assert.deepEqual(notes, ["material", "dimension"]);
  assert.deepEqual(modelNotes({ validation: { ok: false, errors: ["x"], warnings: ["y"], parts: 1 } }), []); // nothing a person needs: hidden
});

test("the ordinary vendor and customer screens never show validation messages or force drafts / unlisting", () => {
  const screens = ["components/vendor/ModelForm.tsx", "components/vendor/ComponentReview.tsx", "components/vendor/ModelDetail.tsx", "components/vendor/AppModelEditor.tsx", "components/vendor/ModelViewer.tsx"];
  for (const path of screens) {
    const s = source(path);
    assert.ok(!/validation\??\.(errors|warnings)/.test(s), `${path} renders raw validation messages`);
    assert.ok(!/geometry errors|This model has problems|Low-quality model/.test(s), `${path} shows a technical warning`);
    assert.ok(!/listed: false/.test(s), `${path} unlists a model by itself`);
  }
  const form = source("components/vendor/ModelForm.tsx");
  assert.ok(/status: blockers\.length \? "draft" : "ready"/.test(form) && /publishBlockers\(review\)/.test(form), "saving uses the file, not the checks");
  assert.ok(!/ValidationNotice|QualityNotice|Swatches/.test(form));
  // a previously held draft is published when saved, its listing left to the vendor
  assert.ok(/model\.status === "draft" && \(model\.glb_url \|\| newFile\.glb_url\) \? \{ status: "ready" \}/.test(source("components/vendor/ModelDetail.tsx")));
});

test("admin diagnostics stay available (admins only)", () => {
  const admin = source("components/admin/AdminModels.tsx");
  assert.ok(admin.includes("/models/${id}/diagnostics") && admin.includes("Diagnostics"));
});

test("the reported wardrobe, repaired automatically: its divider stands on the base board and every door still opens", async () => {
  const data = readFileSync("lib/plan/__tests__/dividerWardrobe.glb");
  const scene = await new Promise<Group>((resolve, reject) =>
    new GLTFLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", (g) => resolve(g.scene), reject));
  scene.updateMatrixWorld(true);
  const slots: { id: string; name: string; mesh: Mesh }[] = [];
  scene.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) slots.push({ id: (m.userData.partId ?? m.parent?.userData.partId) as string, name: m.name, mesh: m });
  });
  const box = (id: string) => new Box3().setFromObject(slots.find((s) => s.id === id)!.mesh);
  const divider = box("divider_center"), base = box("base_panel"), top = box("top_panel");
  assert.ok(Math.abs(divider.min.y - base.max.y) < 1e-3, "it starts on the base's upper face (a joint, not through it)");
  assert.ok(Math.abs(divider.max.y - top.min.y) < 1e-3, "it ends under the top board");
  assert.deepEqual(doc.validation.errors, []);
  assert.ok(doc.validation.publishable);
  const config = authoritativeMovers(doc.animation, slots, scene)!;
  const movers = config.animations.filter((a) => a.enabled);
  assert.equal(movers.length, doc.animation.animations.length);
  assert.deepEqual(publishBlockers({ glbUrl: "dividerWardrobe.glb" }), []);
});
