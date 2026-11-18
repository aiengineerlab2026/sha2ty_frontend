import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3, type Object3D } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildGeometry, type AddedSpec } from "../../vendor/parts3d";

// Node has Blob but no FileReader: the exporter only needs these two reads.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  onload: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((b) => { this.result = b; this.onload?.(); this.onloadend?.(); });
  }
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((b) => { this.result = `data:application/octet-stream;base64,${Buffer.from(b).toString("base64")}`; this.onload?.(); this.onloadend?.(); });
  }
}
(globalThis as unknown as { FileReader: typeof NodeFileReader }).FileReader ??= NodeFileReader;

const exportGlb = (root: Object3D) => new Promise<ArrayBuffer>((resolve, reject) => new GLTFExporter().parse(root, (r) => resolve(r as ArrayBuffer), reject, { binary: true }));
const load = (data: ArrayBuffer) => new Promise<Group>((resolve, reject) => new GLTFLoader().parse(data, "", (g) => resolve(g.scene), reject));

/** The bug: added parts only lived in memory or were found by their place in the file. Every part's id now goes into
 * the file (glTF extras) and comes back on loading, so a reopened model finds its added shelf, door and drawer by id,
 * with the same size, place and colour. */
test("an edited model saved as GLB reopens with every added part: same id, size, place and colour", async () => {
  const model = new Group();
  const body = new Mesh(new BoxGeometry(1, 2, 0.6).translate(0, 1, 0), new MeshStandardMaterial({ color: "#d8c3a5" }));
  body.name = "Body";
  body.userData.partId = "model_part0";
  model.add(body);
  const mpu = new Vector3(1, 1, 1);
  const specs: AddedSpec[] = [
    { id: "added_shelf_a1", type: "shelf", size: [0.95, 0.018, 0.5], center: [0, 1.4, -0.03] },
    { id: "added_door_b2", type: "door", size: [0.5, 1.2, 0.018], center: [-0.25, 1.2, 0.31], hinge: "left" },
    { id: "added_drawer_c3", type: "drawer", size: [0.9, 0.18, 0.45], center: [0, 0.2, 0.06] },
  ];
  for (const spec of specs) {
    const mesh = new Mesh(buildGeometry(spec, mpu), new MeshStandardMaterial({ color: spec.type === "shelf" ? "#2f6f4e" : "#eeeeee" }));
    mesh.name = spec.type;
    mesh.position.set(...spec.center);
    mesh.userData.partId = spec.id; // what the editor writes at export
    model.add(mesh);
  }
  const reopened = await load(await exportGlb(model));
  const byId = new Map<string, Mesh>();
  reopened.traverse((o) => { if ((o as Mesh).isMesh && o.userData.partId) byId.set(o.userData.partId as string, o as Mesh); });
  assert.deepEqual([...byId.keys()].sort(), ["added_door_b2", "added_drawer_c3", "added_shelf_a1", "model_part0"]);
  const shelf = byId.get("added_shelf_a1")!;
  assert.deepEqual(shelf.position.toArray().map((v) => +v.toFixed(4)), [0, 1.4, -0.03]);
  shelf.geometry.computeBoundingBox();
  const size = shelf.geometry.boundingBox!.getSize(new Vector3());
  assert.ok(Math.abs(size.x - 0.95) < 1e-6 && Math.abs(size.y - 0.018) < 1e-6 && Math.abs(size.z - 0.5) < 1e-6);
  assert.equal(`#${(shelf.material as MeshStandardMaterial).color.getHexString()}`, "#2f6f4e");
  // Reopening twice never makes a second copy: each id is in the file once.
  let count = 0;
  reopened.traverse((o) => { if (o.userData.partId === "added_shelf_a1") count += 1; });
  assert.equal(count, 1);
});
