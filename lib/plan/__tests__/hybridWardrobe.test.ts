import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Box3, Group, Mesh, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { openAngle, refine, type AnimationConfig } from "../../vendor/animation";
import { checkMovers } from "../../vendor/reconstruct";

// A wardrobe rebuilt by the backend's hybrid engine (backend services/hybrid.py, tests/hybrid_fixtures.py): four
// doors, one handle each, a fluted plinth drawer, inferred carcass panels. Textures stripped (Node cannot decode
// them). The file and its part document as the editor receives them.
const load = () =>
  new Promise<Group>((resolve, reject) => {
    const data = readFileSync("lib/plan/__tests__/hybridWardrobe.glb");
    new GLTFLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", (g) => resolve(g.scene), reject);
  });
const doc: { components: { id: string; name: string }[]; animation: AnimationConfig } = JSON.parse(readFileSync("lib/plan/__tests__/hybridWardrobe.json", "utf8"));

async function editor() {
  const scene = await load();
  scene.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  scene.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
  // The viewer matches parts by the id written into the file (glTF extras → userData.partId).
  const slots = meshes.map((mesh) => {
    const id = (mesh.userData.partId ?? mesh.parent?.userData.partId) as string;
    return { id, name: doc.components.find((c) => c.id === id)?.name ?? mesh.name, mesh };
  });
  return { scene, slots };
}

test("hybrid wardrobe: every part loads as its own mesh with its stable id, in metres", async () => {
  const { scene, slots } = await editor();
  assert.equal(slots.length, doc.components.length);
  assert.deepEqual(slots.map((s) => s.id).sort(), doc.components.map((c) => c.id).sort());
  const size = new Box3().setFromObject(scene).getSize(new Vector3());
  assert.ok(Math.abs(size.x - 1.6) < 0.01 && Math.abs(size.y - 2.0) < 0.01, `${size.x} × ${size.y}`);
});

test("hybrid wardrobe: in the editor every door opens fully on its own, with its own handle, and the drawer slides", async () => {
  const { scene, slots } = await editor();
  const config = checkMovers(refine(JSON.parse(JSON.stringify(doc.animation)), slots, scene), slots, scene)!;
  const doors = config.animations.filter((a) => a.type === "rotation");
  assert.equal(doors.length, 4);
  for (const a of doors) {
    assert.ok(a.enabled && !a.issues.length, `${a.label}: ${a.issues.join("; ")}`);
    // Never stopped by its own parts; a real neighbour can stop it (doors 2 and 3 hinge back to back at the centre:
    // door 3's handle, open, stands 3 cm into door 2's swing, so door 2 stops at ~78° instead of passing through it).
    const own = a.limit && /^Door (\d)/.exec(a.limit.by)?.[1] === /^Door (\d)/.exec(a.label)?.[1];
    assert.ok(!own, `${a.label} stopped by its own part ${a.limit?.by}`);
    assert.ok((a.limit?.angle ?? openAngle(a)) >= 70, `${a.label} opens only ${a.limit?.angle}° (${a.limit?.by})`);
    const handles = a.follow.filter((id) => /handle/.test(id));
    assert.equal(handles.length, 1, `${a.label} carries ${handles.join(", ")}`);
    assert.ok(handles[0].startsWith(a.component.replace(/_\d+$/, "")), `${a.label} carries its own handle (${handles[0]})`);
  }
  const owners = new Map<string, string[]>();
  for (const a of config.animations) for (const f of a.follow) owners.set(f, [...(owners.get(f) ?? []), a.component]);
  for (const [id, hosts] of owners) assert.equal(hosts.length, 1, `${id} on ${hosts.join(", ")}`);
  // The carved crest Meshy generated on its own: its own part in the file, fixed to the carcass, never carried by a door.
  assert.ok(slots.some((s) => s.id === "carved_crest_generated"));
  assert.ok(!config.animations.some((a) => a.component === "carved_crest_generated" || a.follow.includes("carved_crest_generated")));
  const drawer = config.animations.find((a) => a.type === "translation");
  assert.ok(drawer?.enabled && (drawer.distance ?? 0) > 0);
});
