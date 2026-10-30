/** 1 Three.js unit = 1 meter. X width, Y height, Z depth. */

export const METERS = 1;

export type CameraView = "perspective" | "iso" | "top" | "2d" | "walk";

export function cameraForView(view: CameraView, width: number, depth: number, height: number) {
  const cx = width / 2;
  const cz = depth / 2;
  if (view === "top") return { position: [cx, Math.max(width, depth) * 1.2, cz] as const, target: [cx, 0, cz] as const };
  if (view === "iso") return { position: [cx + width, height * 2.2, cz + depth] as const, target: [cx, 0, cz] as const };
  return { position: [cx + width * 0.6, height * 1.4, cz + depth * 0.9] as const, target: [cx, height * 0.4, cz] as const };
}
