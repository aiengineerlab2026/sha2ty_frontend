import type { PlacedItem, PlanGeometry, Vec2, WallPaint } from "./types";

export type PriceUnit = "item" | "m2";

// ponytail: one currency for the whole catalogue; add a per-vendor currency column when vendors sell abroad.
export const CURRENCY = "EGP";

const money = new Intl.NumberFormat("en-EG", { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });

export function formatPrice(price: number | null | undefined, unit: PriceUnit = "item") {
  if (price == null) return "Price on request";
  return `${money.format(price)}${unit === "m2" ? " / m²" : ""}`;
}

export interface CostLine {
  /** Stable key: what the line is for (merges same model / paint / carpet). */
  key: string;
  kind: "model" | "carpet" | "wall" | "floor" | "window";
  refId: string;
  name: string;
  /** Pieces for item prices, m² for area prices. */
  quantity: number;
  unit: PriceUnit;
  price: number | null;
  total: number | null;
}

/**
 * What the plan costs. Paints and floor finishes are charged by the area they cover (per m²), or
 * once if the vendor gave a total price. Models and carpets are charged by the piece; a per-m²
 * model or carpet is charged for its own footprint.
 */
export function planCost(geometry: PlanGeometry, items: PlacedItem[]): { lines: CostLine[]; total: number; unpriced: number } {
  const lines = new Map<string, CostLine>();
  // Every line costs price × quantity: pieces for "item" prices, m² for "m2" prices.
  const add = (line: Omit<CostLine, "total">) => {
    const hit = lines.get(line.key);
    if (hit) hit.quantity += line.quantity;
    else lines.set(line.key, { ...line, total: null });
  };
  for (const item of items) {
    const unit = item.price_unit ?? "item";
    add({ key: `model:${item.modelId}`, kind: "model", refId: item.modelId, name: item.title, unit, price: item.price ?? null, quantity: unit === "m2" ? item.width_m * item.depth_m : 1 });
  }
  for (const rug of geometry.rugs ?? []) {
    const unit = rug.price_unit ?? "item";
    add({ key: `carpet:${rug.carpetId}`, kind: "carpet", refId: rug.carpetId, name: rug.name, unit, price: rug.price ?? null, quantity: unit === "m2" ? rug.width * rug.length : 1 });
  }
  for (const win of geometry.placed_windows ?? []) {
    const unit = win.price_unit ?? "item";
    add({ key: `window:${win.windowId}`, kind: "window", refId: win.windowId, name: win.name, unit, price: win.price ?? null, quantity: unit === "m2" ? win.width * win.height : 1 });
  }
  const paint = (kind: "wall" | "floor", p: WallPaint, area: number) => {
    const unit = p.price_unit ?? "m2";
    const key = `${kind}:${p.paint_id ?? p.name}`;
    // A total-priced paint is bought once however much it covers.
    if (unit === "item" && lines.has(key)) return;
    add({ key, kind, refId: p.paint_id ?? p.name, name: p.name, unit, price: p.price ?? null, quantity: unit === "m2" ? area : 1 });
  };
  const walls = new Map(geometry.walls.map((w) => [w.id, w]));
  for (const [face, p] of Object.entries(geometry.wall_paints ?? {})) {
    const wall = walls.get(face.slice(0, face.lastIndexOf(":")));
    if (wall) paint("wall", p, (wall.length || Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])) * wall.height);
  }
  const areas = new Map((geometry.zones?.length ? geometry.zones : geometry.rooms).map((a) => [a.id, a.polygon]));
  for (const [areaId, p] of Object.entries(geometry.floor_paints ?? {})) {
    const polygon = areas.get(areaId);
    if (polygon) paint("floor", p, polygonArea(polygon));
  }

  const all = [...lines.values()].map((l) => ({ ...l, quantity: Math.round(l.quantity * 100) / 100, total: l.price == null ? null : l.price * l.quantity }));
  return { lines: all, total: all.reduce((sum, l) => sum + (l.total ?? 0), 0), unpriced: all.filter((l) => l.price == null).length };
}

export function polygonArea(poly: Vec2[]) {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) sum += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(sum) / 2;
}

export interface FinishUsage {
  /** Rooms / zones whose floor uses the finish, with their floor area. */
  floors: { id: string; name: string; area: number }[];
  /** Wall faces painted with it and their total area (length × height). */
  wallFaces: number;
  wallArea: number;
  area: number;
}

/** Where one library paint / floor finish is used in the plan, and how much area it covers. */
export function finishUsage(geometry: PlanGeometry, paintId: string): FinishUsage {
  const areas = geometry.zones?.length ? geometry.zones : geometry.rooms;
  const floors = Object.entries(geometry.floor_paints ?? {})
    .filter(([, p]) => p.paint_id === paintId)
    .flatMap(([id]) => {
      const a = areas.find((x) => x.id === id);
      return a ? [{ id, name: a.name, area: polygonArea(a.polygon) }] : [];
    });
  const walls = new Map(geometry.walls.map((w) => [w.id, w]));
  let wallFaces = 0;
  let wallArea = 0;
  for (const [face, p] of Object.entries(geometry.wall_paints ?? {})) {
    if (p.paint_id !== paintId) continue;
    const w = walls.get(face.slice(0, face.lastIndexOf(":")));
    if (!w) continue;
    wallFaces += 1;
    wallArea += (w.length || Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])) * w.height;
  }
  return { floors, wallFaces, wallArea, area: floors.reduce((s, f) => s + f.area, 0) + wallArea };
}

/** Whole tiles needed to cover `area` m² with tiles of `tileW` × `tileH` m (cut pieces count as whole tiles). */
export const tilesFor = (area: number, tileW: number, tileH: number) => (area > 0 ? Math.ceil(area / (tileW * tileH) - 1e-9) : 0);
