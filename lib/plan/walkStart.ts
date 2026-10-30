import { inside } from "./roomMaterials";
import type { PlanGeometry, Vec2 } from "./types";

/** Eye position on the floor plus yaw (three.js: yaw 0 looks down −Z). */
export type WalkStart = { position: Vec2; yaw: number };

type Door = { start: Vec2; end: Vec2; thickness?: number };

/**
 * Walk mode starts just inside the entrance door of the chosen room (`roomId`, a zone or room id;
 * default: the dining room), looking into that room.
 * The entrance is the dining door that leads outside, else any dining door. Open-plan dining with no
 * door of its own: the apartment entrance, facing the dining area. No doors at all: the dining
 * (or first) zone's centre.
 */
export function walkStart(geometry: Pick<PlanGeometry, "zones" | "rooms" | "doors">, fallback: Vec2, roomId?: string | null): WalkStart {
  const areas = geometry.zones?.length ? geometry.zones : geometry.rooms;
  // "dining" below means the target room: the chosen one, else the dining room.
  const dining = (roomId ? areas.find((a) => a.id === roomId) : undefined) ?? areas.find((a) => a.kind === "dining");
  const doors = (geometry.doors ?? []) as Door[];
  const areaAt = (p: Vec2) => areas.find((a) => inside(p, a.polygon)) ?? null;
  const target = dining ?? areas[0];
  const centre = (target && "label_point" in target ? target.label_point : null) ?? fallback;

  let best: { score: number; position: Vec2; dir: Vec2 } | null = null;
  for (const door of doors) {
    const [ax, az] = door.start;
    const [bx, bz] = door.end;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const mid: Vec2 = [(ax + bx) / 2, (az + bz) / 2];
    const n: Vec2 = [-(bz - az) / len, (bx - ax) / len];
    const reach = (door.thickness ?? 0.2) / 2 + 0.3;
    const side = (s: number): Vec2 => [mid[0] + n[0] * reach * s, mid[1] + n[1] * reach * s];
    for (const s of [1, -1]) {
      const here = areaAt(side(s));
      if (!here) continue;
      const outside = !areaAt(side(-s));
      // dining entrance from outside > other dining door > apartment entrance > anything else
      const score = (here === dining ? 2 : 0) + (outside ? 1 : 0);
      if (best && score <= best.score) continue;
      const dir: Vec2 = here === dining || !dining ? [n[0] * s, n[1] * s] : unit([centre[0] - mid[0], centre[1] - mid[1]]);
      best = { score, position: [mid[0] + n[0] * s * 0.6, mid[1] + n[1] * s * 0.6], dir };
    }
  }
  if (!best) return { position: centre, yaw: 0 };
  return { position: best.position, yaw: Math.atan2(-best.dir[0], -best.dir[1]) };
}

function unit([x, z]: Vec2): Vec2 {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}
