import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Box3, Group, Matrix4, Mesh, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type AnimationConfig } from "../../vendor/animation";
import { type HybridDocument } from "../../vendor/hybrid";
import { publishBlockers } from "../../vendor/verdict";
import { authoritativeMovers, freeEdgeAnchor } from "../../vendor/reconstruct";

// A real wardrobe (model b4aad1bc): a plain left door with a vertical bar handle and two mirrored hinged doors (a frame
// with an opening and its mirror pane each). `legacy` is the file and document saved before the fix (movement
// uncertainty stored as `issues`, verdict "needs_confirmation"); the other is the same model rebuilt from its stored
// reading, with no new photo reading.
type Doc = { components: { id: string; kind: string; assembly?: string; host?: string; hardware?: Record<string, unknown> }[]; animation: AnimationConfig; validation: HybridDocument["validation"] };
const fixture = (name: string) => {
  const data = readFileSync(`lib/plan/__tests__/${name}.glb`);
  const doc: Doc = JSON.parse(readFileSync(`lib/plan/__tests__/${name}.json`, "utf8"));
  return { data, doc };
};
async function loaded(name: string) {
  const { data, doc } = fixture(name);
  const scene = await new Promise<Group>((resolve, reject) =>
    new GLTFLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", (g) => resolve(g.scene), reject));
  scene.updateMatrixWorld(true);
  const slots: { id: string; name: string; mesh: Mesh }[] = [];
  scene.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) slots.push({ id: (m.userData.partId ?? m.parent?.userData.partId) as string, name: m.name, mesh: m });
  });
  return { scene, slots, doc };
}

for (const name of ["mirrorHingedWardrobe", "mirrorHingedWardrobe.legacy"]) {
  test(`${name}: every door, mirrored ones included, has an enabled opening that carries its pane`, async () => {
    const { scene, slots, doc } = await loaded(name);
    const config = authoritativeMovers(doc.animation, slots, scene)!;
    const doors = config.animations.filter((a) => a.type === "rotation");
    assert.equal(doors.length, 3);
    for (const a of doors) assert.ok(a.enabled && !a.issues.length, `${a.component}: ${a.issues.join("; ")}`);
    for (const id of ["center", "right"]) {
      const a = doors.find((d) => d.component === `door_${id}_frame`)!;
      assert.ok(a.follow.includes(`mirror_${id}`), "the mirror moves with its frame");
    }
    if (name.endsWith("legacy")) assert.ok(doors.some((a) => (a.notes ?? []).some((n) => n.includes("hinge side"))), "old uncertainty kept as a note");
  });

  test(`${name}: estimated movements never block publishing`, () => {
    assert.deepEqual(publishBlockers(fixture(name).doc as unknown as HybridDocument), []);
  });
}

test("rebuilt wardrobe: the handle is a vertical bar on the left door, opening swings the mirrored assembly as one", async () => {
  const { scene, slots, doc } = await loaded("mirrorHingedWardrobe");
  const handle = doc.components.find((c) => c.kind === "handle")!;
  assert.equal(handle.host, "door_left");
  assert.equal((handle.hardware as { type: string; orientation: string }).type, "bar");
  assert.equal((handle.hardware as { orientation: string }).orientation, "vertical");
  const hb = new Box3().setFromObject(slots.find((s) => s.id === handle.id)!.mesh).getSize(new Vector3());
  assert.ok(hb.y > 0.3 && hb.x < 0.05 && hb.z > 0.02, `a long thin bar standing off the door (${hb.toArray().map((v) => v.toFixed(3))})`);
  // Swing the centre door 90° about its pivot: frame and mirror turn together, the mirror stays inside the frame.
  const a = authoritativeMovers(doc.animation, slots, scene)!.animations.find((x) => x.component === "door_center_frame")!;
  const frame = slots.find((s) => s.id === "door_center_frame")!.mesh, mirror = slots.find((s) => s.id === "mirror_center")!.mesh;
  const p = new Vector3(...(a.pivot ?? [0, 0, 0]));
  const turn = new Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new Matrix4().makeRotationY(Math.PI / 2)).multiply(new Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  const fb = new Box3().setFromObject(frame).applyMatrix4(turn), mb = new Box3().setFromObject(mirror).applyMatrix4(turn);
  assert.ok(fb.expandByScalar(1e-4).containsBox(mb), "the pane stays in its frame when the door opens");
});

test("a handleless door's control sits near its free edge, at mid-height", async () => {
  const { slots } = await loaded("mirrorHingedWardrobe");
  const frame = slots.find((s) => s.id === "door_right_frame")!.mesh;
  frame.geometry.computeBoundingBox();
  const b = frame.geometry.boundingBox!;
  const at = freeEdgeAnchor(frame, "right")!;
  assert.ok(at.x < b.min.x + 0.25 * (b.max.x - b.min.x), "hinged right: the control is on the left (free) edge");
  assert.ok(Math.abs(at.y - (b.min.y + b.max.y) / 2) < 1e-6 && at.z >= b.max.z);
  assert.ok(freeEdgeAnchor(frame, "left")!.x > b.min.x + 0.75 * (b.max.x - b.min.x));
  assert.equal(freeEdgeAnchor(frame, "top"), undefined);
});

test("only real damage blocks publishing", () => {
  const v = (validation: object) => ({ components: [], validation }) as unknown as HybridDocument;
  assert.deepEqual(publishBlockers(v({ status: "needs_confirmation", errors: [], confirm: ["How the door opens was estimated."] })), []);
  assert.deepEqual(publishBlockers(v({ status: "valid_with_warnings", publishable: true, notes: [{ kind: "material", text: "x" }] })), []);
  assert.deepEqual(publishBlockers(v({ status: "needs_repair", errors: ["Door 1: inside out."] })), ["Door 1: inside out."]);
  assert.equal(publishBlockers(v({ status: "failed", errors: [] })).length, 1);
});
