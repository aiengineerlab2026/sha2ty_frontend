import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { measure } from "@/lib/plan/modelNormalization";

// The same compressed-mesh decoders the 3D viewer uses (drei's defaults).
const DRACO_PATH = "https://www.gstatic.com/draco/versioned/decoders/1.5.5/";

/** A GLB file's real size in metres (glTF units are metres): width = X, height = Y, depth = Z of the whole scene,
 * every node's transform included. Null when the file cannot be read or is empty. */
export async function glbSize(file: File): Promise<{ width: number; height: number; depth: number } | null> {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
  loader.setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  try {
    const gltf = await loader.parseAsync(await file.arrayBuffer(), "");
    const size = measure(gltf.scene);
    return [size.width, size.height, size.depth].every((v) => Number.isFinite(v) && v > 0) ? size : null;
  } catch {
    return null;
  } finally {
    draco.dispose();
  }
}
