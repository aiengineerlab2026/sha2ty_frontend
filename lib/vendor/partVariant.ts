import { BufferGeometry, Float32BufferAttribute, type BufferAttribute, type InterleavedBufferAttribute, type Material, type Mesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export { fitInto } from "./fitPart";

// The same compressed-mesh decoders the 3D viewer uses (drei's defaults).
const DRACO_PATH = "https://www.gstatic.com/draco/versioned/decoders/1.5.5/";

export type LoadedVariant = { geometry: BufferGeometry; material: Material };
const cache = new Map<string, Promise<LoadedVariant>>();

/** Plain float copy of an attribute (quantized / normalised files decoded), so meshes from any file can be merged. */
function floats(attr: BufferAttribute | InterleavedBufferAttribute, size: number) {
  const out = new Float32Array(attr.count * size);
  const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < size; c++) out[i * size + c] = get[c].call(attr, i);
  return new Float32BufferAttribute(out, size);
}

function plain(mesh: Mesh): BufferGeometry {
  const from = mesh.geometry;
  const position = from.attributes.position;
  const out = new BufferGeometry();
  out.setAttribute("position", floats(position, 3));
  out.setAttribute("uv", from.attributes.uv ? floats(from.attributes.uv, 2) : new Float32BufferAttribute(new Float32Array(position.count * 2), 2));
  out.setIndex(from.index ? Array.from(from.index.array) : Array.from({ length: position.count }, (_, i) => i));
  out.applyMatrix4(mesh.matrixWorld);
  return out;
}

/** A part variant's GLB as one geometry (every mesh in it, in the file's layout) and its first material. Cached per URL. */
export function loadVariant(url: string): Promise<LoadedVariant> {
  let hit = cache.get(url);
  if (!hit) {
    hit = (async () => {
      const loader = new GLTFLoader();
      const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
      loader.setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
      try {
        const { scene } = await loader.loadAsync(url);
        scene.updateMatrixWorld(true);
        const meshes: Mesh[] = [];
        scene.traverse((node) => (node as Mesh).isMesh && meshes.push(node as Mesh));
        if (!meshes.length) throw new Error("This file has no 3D shape in it.");
        const geometry = mergeGeometries(meshes.map(plain), false);
        if (!geometry) throw new Error("This file could not be read as one part.");
        const first = meshes[0].material;
        return { geometry, material: (Array.isArray(first) ? first[0] : first).clone() };
      } finally {
        draco.dispose();
      }
    })();
    hit.catch(() => cache.delete(url)); // a failed load can be tried again
    cache.set(url, hit);
  }
  return hit;
}
