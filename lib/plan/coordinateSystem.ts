/** 1 Three.js unit = 1 meter. X width, Y height, Z depth. */

export const METERS = 1;

export type CameraView = "perspective" | "iso" | "top" | "front" | "side" | "2d" | "walk";

/** Camera for a view, fitted so the whole apartment (its bounding sphere) is in frame at this field of view. */
export function cameraForView(view: CameraView, width: number, depth: number, height: number, fovDeg = 50) {
  const cx = width / 2;
  const cz = depth / 2;
  if (view === "top") return { position: [cx, Math.max(width, depth) * 1.2, cz] as const, target: [cx, 0, cz] as const };
  const target = view === "iso" ? ([cx, 0, cz] as const) : ([cx, height * 0.4, cz] as const);
  // Same viewing directions as before; only the distance now follows the plan's size.
  // Front looks north from the south side (+z), side looks west from the east (+x), both slightly from above.
  const dir =
    view === "iso" ? [width, height * 2.2, depth] : view === "front" ? [0, 0.45, 1] : view === "side" ? [1, 0.45, 0] : [width * 0.6, height * 1.4 - height * 0.4, depth * 0.9];
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const radius = Math.hypot(width, depth, height) / 2;
  const distance = (radius / Math.sin(((fovDeg * Math.PI) / 180) / 2)) * 1.05;
  const position = [target[0] + (dir[0] / len) * distance, target[1] + (dir[1] / len) * distance, target[2] + (dir[2] / len) * distance] as const;
  return { position, target };
}
