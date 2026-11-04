import type { Vec2 } from "./types";

/** "4 × 14 × 16 × 17" → the room's wall lengths in metres, in order around the room (separators * x ×, spaces
 * allowed, decimal comma or point). Null when a part is not a positive number. */
export function parseWalls(text: string): number[] | null {
  const parts = text.split(/[*x×X]/).map((p) => p.trim().replace(",", "."));
  if (!text.trim() || parts.some((p) => !/^\d*\.?\d+$/.test(p) || Number(p) <= 0)) return null;
  return parts.map(Number);
}

/** Why these walls cannot make a closed room, or null when they can: at least 3, and the longest wall shorter than
 * all the others together (otherwise the last wall cannot reach the first; 1% short of that is a flat sliver, not a
 * room, and is refused too). */
export function wallsProblem(sides: number[]): "few" | "open" | null {
  if (sides.length < 3) return "few";
  const longest = Math.max(...sides);
  return longest >= (sides.reduce((a, b) => a + b, 0) - longest) * 0.99 ? "open" : null;
}

/** The outline really is these walls, end to end and closed: each edge within 1 mm of its wall, the last one ending
 * where the first starts. (A guard on polygonFromSides: an outline that fails is never shown or built.) */
export function closes(polygon: Vec2[], sides: number[]): boolean {
  return polygon.length === sides.length && polygon.every((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return Math.abs(Math.hypot(q[0] - p[0], q[1] - p[1]) - sides[i]) < 1e-3;
  });
}

/** The floor outline with exactly these wall lengths, in order. Lengths alone do not fix the corner angles, so the
 * corners are put on one circle (the cyclic polygon: unique, convex, and the largest floor those walls can enclose);
 * equal opposite walls give a rectangle, four equal walls a square. The first wall runs along +x from (0, 0) and the
 * outline is shifted to start at the origin. */
export function polygonFromSides(sides: number[]): Vec2[] {
  const longest = Math.max(...sides);
  const angle = (s: number, r: number) => 2 * Math.asin(Math.min(1, s / (2 * r)));
  const total = (r: number) => sides.reduce((sum, s) => sum + angle(s, r), 0);
  // Centre inside the room when the walls go all the way round at the smallest circle; else outside it, and the
  // longest wall's arc equals all the others' together.
  const inside = total(longest / 2) >= 2 * Math.PI;
  const error = (r: number) => (inside ? total(r) - 2 * Math.PI : total(r) - 2 * angle(longest, r));
  let lo = longest / 2;
  let hi = longest * 1e4;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    // inside: the error falls as the circle grows; outside: it rises.
    if (error(mid) > 0 === inside) lo = mid;
    else hi = mid;
  }
  const r = (lo + hi) / 2;
  let at = 0;
  const points: Vec2[] = sides.map((s, i) => {
    const point: Vec2 = [r * Math.cos(at), r * Math.sin(at)];
    at += !inside && s === longest && sides.indexOf(longest) === i ? -angle(s, r) : angle(s, r);
    return point;
  });
  // First wall along +x, then everything moved to positive coordinates.
  const [a, b] = [points[0], points[1]];
  const turn = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  const rotated = points.map(([x, y]): Vec2 => {
    const dx = x - a[0];
    const dy = y - a[1];
    return [dx * Math.cos(turn) - dy * Math.sin(turn), dx * Math.sin(turn) + dy * Math.cos(turn)];
  });
  const minX = Math.min(...rotated.map((p) => p[0]));
  const minY = Math.min(...rotated.map((p) => p[1]));
  return rotated.map(([x, y]): Vec2 => [Number((x - minX).toFixed(4)), Number((y - minY).toFixed(4))]);
}
