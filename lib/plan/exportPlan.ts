import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { Object3D } from "three";

export async function exportSceneGlb(root: Object3D): Promise<Blob> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(root, { binary: true });
  if (result instanceof ArrayBuffer) return new Blob([result], { type: "model/gltf-binary" });
  return new Blob([JSON.stringify(result)], { type: "model/gltf+json" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
