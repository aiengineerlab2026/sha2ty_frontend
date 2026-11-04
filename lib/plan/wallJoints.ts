import type { Vec2 } from "./types";

type WallLike = { start: Vec2; end: Vec2; thickness: number; height: number; elevation?: number };

/** Convex hull (monotone chain), counter-clockwise. */
function hull(points: Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Vec2[]) => list.reduce<Vec2[]>((out, q) => {
    while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 1e-12) out.pop();
    out.push(q);
    return out;
  }, []);
  const lower = half(p);
  const upper = half([...p].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Where two or more full walls meet: the outline filling the joint (hull of their end faces) and its height (the
 * lowest). Walls are straight boxes ending at the corner point, so without these the outside of every angled
 * corner is open. Same as backend geometry_builder.wall_joints (the GLB export). */
export function wallJoints(walls: WallLike[]): { outline: Vec2[]; height: number }[] {
  const ends = new Map<string, { at: Vec2; corners: Vec2[]; heights: number[] }>();
  for (const w of walls) {
    if ((w.elevation ?? 0) > 0) continue; // lintels and sills, not corners
    const [x0, z0] = w.start;
    const [x1, z1] = w.end;
    const length = Math.hypot(x1 - x0, z1 - z0);
    if (length < 1e-6) continue;
    const nx = (-(z1 - z0) / length) * (w.thickness / 2);
    const nz = ((x1 - x0) / length) * (w.thickness / 2);
    for (const [x, z] of [w.start, w.end]) {
      const key = `${x.toFixed(3)},${z.toFixed(3)}`;
      const joint = ends.get(key) ?? { at: [x, z] as Vec2, corners: [], heights: [] };
      joint.corners.push([x + nx, z + nz], [x - nx, z - nz]);
      joint.heights.push(w.height);
      ends.set(key, joint);
    }
  }
  return [...ends.values()].filter((j) => j.heights.length >= 2).map((j) => ({ outline: hull([...j.corners, j.at]), height: Math.min(...j.heights) })).filter((j) => j.outline.length >= 3);
}
