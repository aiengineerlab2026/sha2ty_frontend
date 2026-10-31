import type { PlanGeometry, PlanWall, Vec2 } from "./types";

/** Door openings are cut 2.1 m high (backend geometry_builder DOOR_HEIGHT; the lintel starts there). */
export const DOOR_OPENING_HEIGHT = 2.1;
/** A door this much smaller than its opening (either way) still fits, the frame covers the gap. */
export const DOOR_GAP_TOLERANCE = 0.1;

/** Wall left above a door raised to fit a taller one (metres). */
export const LINTEL_MIN = 0.05;

/** `height` is the cut opening; a taller door fits up to `maxHeight`, the wall above it is raised (raiseLintel). */
export type Doorway = { id: string; start: Vec2; end: Vec2; thickness: number; width: number; height: number; maxHeight?: number };

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
    maxHeight: Math.max(height, (geometry.height || DOOR_OPENING_HEIGHT) - LINTEL_MIN),
  }));
}

/** Where a door model stands in an opening: its middle, width along the wall (rotateY turns +X onto start→end), degrees. */
export function doorPose(opening: Pick<Doorway, "start" | "end">) {
  const [dx, dz] = [opening.end[0] - opening.start[0], opening.end[1] - opening.start[1]];
  const yaw = ((Math.round((Math.atan2(-dz, dx) * 180) / Math.PI) % 360) + 360) % 360;
  return { x: (opening.start[0] + opening.end[0]) / 2, z: (opening.start[1] + opening.end[1]) / 2, yaw };
}

/**
 * Does a door (width × height, m) fit an opening? "too_big" when it is wider or taller than the
 * opening (it can't go in), "gap" when it is more than DOOR_GAP_TOLERANCE smaller (it goes in, with a
 * gap), else "fits". `wide` / `tall` are opening minus door in cm (negative = door too big).
 */
export function doorFit(door: { width: number; height: number }, opening: { width: number; height: number; maxHeight?: number }) {
  const wide = Math.round((opening.width - door.width) * 100);
  const tall = Math.round((opening.height - door.height) * 100);
  const limit = opening.maxHeight ?? opening.height; // taller than the cut but under the ceiling: the lintel is raised
  const over = Math.round((door.height - limit) * 100);
  const status: "fits" | "gap" | "too_big" = wide < 0 || over > 0 ? "too_big" : wide > DOOR_GAP_TOLERANCE * 100 || tall > DOOR_GAP_TOLERANCE * 100 ? "gap" : "fits";
  return { status, wide, tall, over, raised: tall < 0 && over <= 0 };
}

/** A door taller than its opening raises the wall piece above it (`<openingId>-lintel`) to the door's top. */
export function raiseLintel(walls: PlanWall[], openingId: string, doorHeight: number, wallHeight: number): PlanWall[] {
  return walls.flatMap((w) => {
    if (w.id !== `${openingId}-lintel` || (w.elevation ?? 0) >= doorHeight) return [w];
    const height = wallHeight - doorHeight;
    return height > 0.01 ? [{ ...w, elevation: doorHeight, height }] : [];
  });
}

/** A door model: the Door category, or a door listed under another category ("Oak door", "باب خشب"). */
export function isDoorModel(model: { category?: string | null; title?: string | null }) {
  // ponytail: name match (Furniture only) until every door is saved with the Door category (supabase/model_categories.sql)
  if (model.category === "door") return true;
  const title = model.title ?? "";
  return (model.category ?? "furniture") === "furniture" && /\bdoors?\b|باب/i.test(title) && !/\bwith\b|wardrobe|cabinet|closet|cupboard|fridge|خزانة|دولاب/i.test(title);
}
