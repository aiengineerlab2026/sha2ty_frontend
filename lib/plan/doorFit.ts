import type { PlanGeometry, Vec2 } from "./types";

/** Door openings are cut 2.1 m high (backend geometry_builder DOOR_HEIGHT; the lintel starts there). */
export const DOOR_OPENING_HEIGHT = 2.1;
/** A door this much smaller than its opening (either way) still fits, the frame covers the gap. */
export const DOOR_GAP_TOLERANCE = 0.1;

export type Doorway = { id: string; start: Vec2; end: Vec2; thickness: number; width: number; height: number };

/** The plan's door openings with their real size in metres. */
export function doorways(geometry: Pick<PlanGeometry, "doors" | "height">): Doorway[] {
  const height = Math.min(DOOR_OPENING_HEIGHT, geometry.height || DOOR_OPENING_HEIGHT);
  return ((geometry.doors ?? []) as { id?: string; start: Vec2; end: Vec2; thickness?: number }[]).map((d, i) => ({
    id: d.id ?? `door-${i}`,
    start: d.start,
    end: d.end,
    thickness: d.thickness ?? 0.2,
    width: Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]),
    height,
  }));
}

/**
 * Does a door (width × height, m) fit an opening? "too_big" when it is wider or taller than the
 * opening (it can't go in), "gap" when it is more than DOOR_GAP_TOLERANCE smaller (it goes in, with a
 * gap), else "fits". `wide` / `tall` are opening minus door in cm (negative = door too big).
 */
export function doorFit(door: { width: number; height: number }, opening: { width: number; height: number }) {
  const wide = Math.round((opening.width - door.width) * 100);
  const tall = Math.round((opening.height - door.height) * 100);
  const status: "fits" | "gap" | "too_big" = wide < 0 || tall < 0 ? "too_big" : wide > DOOR_GAP_TOLERANCE * 100 || tall > DOOR_GAP_TOLERANCE * 100 ? "gap" : "fits";
  return { status, wide, tall };
}
