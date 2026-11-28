import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type AnimationConfig } from "../../vendor/animation";
import { authoritativeMovers } from "../../vendor/reconstruct";

// A real wardrobe rebuilt by the backend's assembly engine (services/hybrid.py) from its photo (model 7970bf39): a
// cream left door with two raised mouldings, a mirrored right door (a frame with an opening and its mirror pane),
// dark crown trim and plinth, sliding doors on two tracks. The file and its part document as the editor receives them.
const load = () =>
  new Promise<Group>((resolve, reject) => {
    const data = readFileSync("lib/plan/__tests__/mirrorSlidingWardrobe.glb");
    new GLTFLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", (g) => resolve(g.scene), reject);
  });
const doc: { components: { id: string; name: string; kind: string; assembly?: string }[]; animation: AnimationConfig } = JSON.parse(readFileSync("lib/plan/__tests__/mirrorSlidingWardrobe.json", "utf8"));

async function loaded() {
  const scene = await load();
  scene.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  scene.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
  const slots = meshes.map((mesh) => {
    const id = (mesh.userData.partId ?? mesh.parent?.userData.partId) as string;
    return { id, name: doc.components.find((c) => c.id === id)?.name ?? mesh.name, mesh };
  });
  return { scene, slots };
}

test("rebuilt wardrobe: every physical part once, under its assembly; a logical door is a parent, not a solid", async () => {
  const { scene, slots } = await loaded();
  assert.deepEqual(slots.map((s) => s.id).sort(), doc.components.map((c) => c.id).sort());
  let door: import("three").Object3D | undefined;
  scene.traverse((o) => { if (o.userData.assemblyId === "door_right") door = o; });
  assert.ok(door && !(door as Mesh).isMesh && door.userData.logical, "the mirrored door is a group, not a mesh");
  const children = door!.children.map((c) => c.userData.partId).sort();
  assert.deepEqual(children, ["door_right_frame", "door_right_mirror"]);
});

test("rebuilt wardrobe: the frame has a real opening and the mirror sits in it, without touching", async () => {
  const { slots } = await loaded();
  const frame = slots.find((s) => s.id === "door_right_frame")!.mesh;
  const mirror = slots.find((s) => s.id === "door_right_mirror")!.mesh;
  const fb = new Box3().setFromObject(frame), mb = new Box3().setFromObject(mirror);
  assert.ok(fb.containsBox(mb), "the pane is inside the frame's outline");
  assert.ok(mb.max.z < fb.max.z && mb.min.z > fb.min.z, "the pane is within the frame's thickness, not on its face");
  assert.ok(frame.geometry.index ? frame.geometry.index.count > 36 : frame.geometry.attributes.position.count > 36, "the frame is not a plain box");
  const m = mirror.material as MeshStandardMaterial;
  assert.equal(m.metalness, 1);
  assert.ok(m.roughness < 0.1 && !m.map, "a mirror is a reflective material, never a photo of its reflection");
});

test("rebuilt wardrobe: colours are authored as linear factors (the cream reads as cream, not washed out)", async () => {
  const { slots } = await loaded();
  const door = slots.find((s) => s.id === "door_left")!.mesh.material as MeshStandardMaterial;
  const hex = (doc.components.find((c) => c.id === "door_left") as unknown as { material: { color: string } }).material.color;
  assert.equal(`#${door.color.getHexString().toUpperCase()}`, hex); // three reads the linear factor back as the sampled sRGB colour
});

test("rebuilt wardrobe: its own sliding movements are used as written, nothing added, mirror rides with its frame", async () => {
  const { scene, slots } = await loaded();
  const before = slots.length;
  const config = authoritativeMovers(doc.animation, slots, scene)!;
  assert.equal(slots.length, before, "no backing, interior or extra part added");
  const sliding = config.animations.filter((a) => a.type === "translation");
  assert.equal(sliding.length, 2);
  for (const a of sliding) assert.ok(a.enabled, `${a.label}: ${a.issues.join("; ")}`);
  const right = sliding.find((a) => a.component === "door_right_frame")!;
  assert.deepEqual(right.follow, ["door_right_mirror"]);
  assert.ok((right.distance ?? 0) < 0 && (sliding.find((a) => a.component === "door_left")!.distance ?? 0) > 0, "they slide towards each other");
  assert.equal(config.uncertain?.length, 2, "how they move stays flagged for the vendor");
  const size = new Box3().setFromObject(scene).getSize(new Vector3());
  assert.ok(Math.abs(size.x - 2.2) < 0.01 && Math.abs(size.y - 2.15) < 0.01, "real size, no normalisation stretch");
});
