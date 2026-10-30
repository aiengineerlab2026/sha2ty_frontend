import type { PlanGeometry, PlacedItem } from "./types";

type Pt = { x: number; z: number };

/** Same convention as three.js `rotation.y`: +θ turns +X towards −Z (counter-clockwise seen from above). */
export function rotateY(x: number, z: number, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) + z * Math.sin(r), z: -x * Math.sin(r) + z * Math.cos(r) };
}

type Sized = Pick<PlacedItem, "width_m" | "height_m" | "depth_m" | "size">;

/**
 * A w × h × d box standing on y = 0, tilted by `deg` about its own X axis through its base centre.
 * Returns its floor footprint depth and height after the tilt, the footprint centre's shift along the
 * item's local z, and how far it must be lifted so its lowest corner touches the floor.
 * (three.js rotation.x: y' = y·cos − z·sin, z' = y·sin + z·cos.)
 */
export function tilted(size: { width: number; height: number; depth: number }, deg = 0) {
  const t = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return {
    width: size.width,
    height: size.height * c + size.depth * s,
    depth: size.height * s + size.depth * c,
    shift: (size.height * Math.sin(t)) / 2,
    lift: (size.depth / 2) * s,
  };
}

export const normalizeYaw = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;
export const clampTilt = (deg: number) => Math.max(-90, Math.min(90, Math.round(deg)));

/** What collides is what is drawn: the rendered size when known, else the catalogue size. */
export function physicalSize(item: Sized) {
  return item.size ?? { width: item.width_m, height: item.height_m, depth: item.depth_m };
}

type Footprinted = Pick<PlacedItem, "x" | "z" | "width_m" | "height_m" | "depth_m" | "rotation_y" | "rotation_x" | "size" | "shape" | "arm_m">;

const isL = (item: Pick<PlacedItem, "shape">) => item.shape === "l_left" || item.shape === "l_right";

/**
 * L-shaped unit in its own frame (bounding box centred on the origin, front facing +z): the back arm
 * runs along −z across the whole width; the side arm runs along −x (l_left) or +x (l_right). Returns the
 * two arm rectangles, the 6-point outline and the corner point (where the two walls meet).
 */
export function lLocal(width: number, depth: number, arm: number, shape: "l_left" | "l_right") {
  const hw = width / 2;
  const hd = depth / 2;
  const a = Math.min(arm, width, depth);
  const left = shape === "l_left";
  const sx = left ? -hw : hw; // side-arm wall
  const ix = left ? -hw + a : hw - a; // side-arm inner face
  const back: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, -hd + a], [-hw, -hd + a]];
  const side: [number, number][] = left ? [[sx, -hd + a], [ix, -hd + a], [ix, hd], [sx, hd]] : [[ix, -hd + a], [sx, -hd + a], [sx, hd], [ix, hd]];
  const outline: [number, number][] = left
    ? [[-hw, -hd], [hw, -hd], [hw, -hd + a], [ix, -hd + a], [ix, hd], [-hw, hd]]
    : [[-hw, -hd], [hw, -hd], [hw, hd], [ix, hd], [ix, -hd + a], [-hw, -hd + a]];
  return { rects: [back, side], outline, corner: [sx, -hd] as [number, number] };
}

/** Rendered arm depth: the catalogue arm scaled like the rest of the model. */
function armOf(item: Footprinted) {
  const size = physicalSize(item);
  const scale = item.width_m ? size.width / item.width_m : 1;
  return (item.arm_m ?? Math.min(size.width, size.depth) * 0.35) * scale;
}

const place = (item: Footprinted) => ([x, z]: [number, number]) => {
  const p = rotateY(x, z, item.rotation_y);
  return { x: p.x + item.x, z: p.z + item.z };
};

/** The footprint as rectangles (one, or the two arms of an L) in world space, for overlap tests. */
export function footprintRects(item: Footprinted): Pt[][] {
  if (!isL(item)) return [footprintCorners(item)];
  const size = physicalSize(item);
  return lLocal(size.width, size.depth, armOf(item), item.shape as "l_left" | "l_right").rects.map((r) => r.map(place(item)));
}

/** Rotated footprint of the furniture at its physical size (an L's 6-point outline for corner units). */
export function footprintCorners(item: Footprinted): Pt[] {
  if (isL(item)) {
    const size = physicalSize(item);
    return lLocal(size.width, size.depth, armOf(item), item.shape as "l_left" | "l_right").outline.map(place(item));
  }
  const t = tilted(physicalSize(item), item.rotation_x);
  const hw = t.width / 2;
  const hd = t.depth / 2;
  return [
    [-hw, t.shift - hd],
    [hw, t.shift - hd],
    [hw, t.shift + hd],
    [-hw, t.shift + hd],
  ].map(([x, z]) => {
    const p = rotateY(x, z, item.rotation_y);
    return { x: p.x + item.x, z: p.z + item.z };
  });
}

function insidePolygon(pt: Pt, polygon: [number, number][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], zi = polygon[i][1];
    const xj = polygon[j][0], zj = polygon[j][1];
    const intersect = zi > pt.z !== zj > pt.z && pt.x < ((xj - xi) * (pt.z - zi)) / (zj - zi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Clear length of the room through `center` along direction `dir` (unit vector): the span between
 * the nearest wall faces on either side. This is what a sofa aligned with that axis must fit in.
 */
export function clearSpan(center: Pt, dir: Pt, polygon: [number, number][]): number {
  let ahead = Infinity;
  let behind = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = { x: polygon[j][0], z: polygon[j][1] };
    const b = { x: polygon[i][0], z: polygon[i][1] };
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const denom = dir.x * ez - dir.z * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((a.x - center.x) * ez - (a.z - center.z) * ex) / denom; // along dir
    const s = ((a.x - center.x) * dir.z - (a.z - center.z) * dir.x) / denom; // along edge
    if (s < 0 || s > 1) continue;
    if (t >= 0) ahead = Math.min(ahead, t);
    else behind = Math.min(behind, -t);
  }
  return ahead + behind;
}

export function localWarnings(item: PlacedItem, geometry: PlanGeometry | null, others: PlacedItem[]): string[] {
  if (!geometry?.rooms.length) return ["Place furniture after a room exists."];
  const warnings: string[] = [];
  // A tilted item's footprint centre moves along its own z: measure the room from there.
  const size = tilted(physicalSize(item), item.rotation_x);
  const offset = rotateY(0, size.shift, item.rotation_y);
  const center = { x: item.x + offset.x, z: item.z + offset.z };
  const room = geometry.rooms.find((entry) => insidePolygon(center, entry.polygon));
  if (!room) return [`${item.title} is outside the rooms.`];

  // Never resize to fit: report how much is missing along each of the furniture's own axes.
  const along = rotateY(1, 0, item.rotation_y);
  const across = rotateY(0, 1, item.rotation_y);
  const spanW = clearSpan(center, along, room.polygon);
  const spanD = clearSpan(center, across, room.polygon);
  if (size.width > spanW + 0.005) warnings.push(`${item.title} is ${size.width.toFixed(2)} m wide but ${room.name} has ${spanW.toFixed(2)} m there (${(size.width - spanW).toFixed(2)} m short).`);
  if (size.depth > spanD + 0.005) warnings.push(`${item.title} is ${size.depth.toFixed(2)} m deep but ${room.name} has ${spanD.toFixed(2)} m there (${(size.depth - spanD).toFixed(2)} m short).`);
  if (!warnings.length && footprintCorners(item).some((c) => !insidePolygon(c, room.polygon))) {
    warnings.push(`${item.title} intersects a wall. Move it into the room.`);
  }
  if (size.height > geometry.height + 0.01) {
    warnings.push(`${item.title} exceeds room height by ${(size.height - geometry.height).toFixed(2)} m.`);
  }
  for (const other of others) {
    if (other.instanceId === item.instanceId) continue;
    // A ceiling light hangs above the furniture: only same-level items can collide.
    if ((other.mount ?? "floor") !== (item.mount ?? "floor")) continue;
    // A TV may stand on a table: the two never collide (restOnSurfaces lifts the TV onto it).
    if (onTable(item, other) || onTable(other, item)) continue;
    if (footprintsOverlap(item, other)) warnings.push(`${item.title} intersects ${other.title}.`);
  }
  return warnings;
}

/** Separating-axis test on the rotated rectangles; an L counts as its two arms (its empty corner is free). */
export function footprintsOverlap(a: PlacedItem, b: PlacedItem) {
  return footprintRects(a).some((ra) => footprintRects(b).some((rb) => rectsOverlap(ra, rb)));
}

function rectsOverlap(pa: Pt[], pb: Pt[]) {
  for (const poly of [pa, pb]) {
    for (let i = 0; i < 2; i++) {
      const p = poly[i];
      const q = poly[i + 1];
      const axis = { x: -(q.z - p.z), z: q.x - p.x };
      const project = (pts: Pt[]) => pts.map((v) => v.x * axis.x + v.z * axis.z);
      const ra = project(pa);
      const rb = project(pb);
      if (Math.max(...ra) <= Math.min(...rb) + 1e-9 || Math.max(...rb) <= Math.min(...ra) + 1e-9) return false;
    }
  }
  return true;
}

export function nearestWallDistance(item: PlacedItem, geometry: PlanGeometry | null): number | null {
  if (!geometry?.walls.length) return null;
  const pt = { x: item.x, z: item.z };
  let best = Infinity;
  for (const wall of geometry.walls) {
    const d = distToSegment(pt, { x: wall.start[0], z: wall.start[1] }, { x: wall.end[0], z: wall.end[1] });
    best = Math.min(best, d);
  }
  return best;
}

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/**
 * Carpet fit: the catalogue width × length (never resized) at its rotation must lie inside one room and
 * fit that room's clear span along both of its axes. Carpets may overlap furniture, so others are ignored.
 */
export function rugWarnings(
  rug: { name: string; width: number; length: number; x: number; z: number; rotation: number; tilt?: number },
  geometry: PlanGeometry | null,
): string[] {
  const asItem = {
    instanceId: "__rug__",
    modelId: "",
    title: rug.name,
    company: "",
    glbUrl: "",
    width_m: rug.width,
    height_m: 0,
    depth_m: rug.length,
    x: rug.x,
    y: 0,
    z: rug.z,
    rotation_y: rug.rotation,
    rotation_x: rug.tilt ?? 0,
    warnings: [],
  } satisfies PlacedItem;
  // localWarnings calls the carpet's length its "depth": say length in carpet messages.
  return localWarnings(asItem, geometry, []).map((w) => w.replace(" m deep but ", " m long but "));
}

/**
 * Auto-fix a placement: the nearest position (same rotation) where the item has no warnings,
 * searching outward in 5 cm rings up to 3 m. null when nothing nearby fits (e.g. wider than the room).
 * ponytail: ring search, ~1000 cheap checks worst case; a proper free-space solver if plans get dense.
 */
export function nearestValidSpot(item: PlacedItem, geometry: PlanGeometry, others: PlacedItem[]): { x: number; z: number } | null {
  const fits = (x: number, z: number) => localWarnings({ ...item, x, z }, geometry, others).length === 0;
  if (fits(item.x, item.z)) return { x: item.x, z: item.z };
  for (let r = 0.05; r <= 3 + 1e-9; r += 0.05) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / 0.1));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      const x = item.x + r * Math.cos(a);
      const z = item.z + r * Math.sin(a);
      if (fits(x, z)) return { x, z };
    }
  }
  return null;
}

const isTv = (i: Pick<PlacedItem, "category">) => i.category === "tv";
const isTable = (i: Pick<PlacedItem, "category">) => i.category === "table";
const onTable = (top: PlacedItem, below: PlacedItem) => isTv(top) && isTable(below);

/** Height of the highest table top under the item's centre, or 0 when it stands on the floor. */
export function surfaceHeight(item: Pick<PlacedItem, "x" | "z" | "instanceId">, others: PlacedItem[]): number {
  let top = 0;
  for (const t of others) {
    if (t.instanceId === item.instanceId || !isTable(t)) continue;
    const corners = footprintCorners(t).map((c) => [c.x, c.z] as [number, number]);
    if (!insidePolygon({ x: item.x, z: item.z }, corners)) continue;
    top = Math.max(top, (t.y ?? 0) + tilted(physicalSize(t), t.rotation_x).height);
  }
  return top;
}

/** TVs stand on whatever table is under them (or the floor); everything else keeps its height. */
export function restOnSurfaces(list: PlacedItem[]): PlacedItem[] {
  return list.map((item) => {
    if (!isTv(item) || item.mount === "ceiling") return item;
    const y = surfaceHeight(item, list);
    return Math.abs((item.y ?? 0) - y) < 1e-9 ? item : { ...item, y };
  });
}

/**
 * Fit a window on a wall face at the clicked point: keep it whole inside the wall (shifted in from
 * the ends / floor / top), or say why it cannot fit. Returns the centre position along the wall and height.
 */
export function fitWindowOnWall(
  win: { name: string; width: number; height: number },
  wall: { length: number; height: number; start: [number, number]; end: [number, number] },
  along: number,
  y: number,
): { along: number; y: number } | { problem: string } {
  const length = wall.length || Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
  if (win.width > length + 1e-6) return { problem: `${win.name} is ${win.width.toFixed(2)} m wide but this wall is ${length.toFixed(2)} m.` };
  if (win.height > wall.height + 1e-6) return { problem: `${win.name} is ${win.height.toFixed(2)} m high but this wall is ${wall.height.toFixed(2)} m.` };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return { along: clamp(along, win.width / 2, length - win.width / 2), y: clamp(y, win.height / 2, wall.height - win.height / 2) };
}

/**
 * Snap an L-shaped unit into the room corner nearest the cursor (within `reach` m): its corner on the
 * room corner and each arm along one of the two walls. Only right-angle inside corners qualify. Room
 * outlines of typed-in rooms run along wall centre lines, so the unit is inset by half a wall there.
 */
export function cornerSnap(
  unit: { shape: "l_left" | "l_right"; width: number; depth: number; arm: number },
  geometry: Pick<PlanGeometry, "rooms" | "zones" | "source" | "wall_thickness">,
  cursor: { x: number; z: number },
  reach = 1.5,
): { x: number; z: number; rotation: number } | null {
  const areas = geometry.zones?.length ? geometry.zones : geometry.rooms;
  const inset = (geometry.source === "dimensions" ? (geometry.wall_thickness ?? 0) / 2 : 0) + 0.005;
  const { corner } = lLocal(unit.width, unit.depth, unit.arm, unit.shape);
  // Directions from the unit's corner along its two arms (local frame).
  const along: [Pt, Pt] = [{ x: unit.shape === "l_left" ? 1 : -1, z: 0 }, { x: 0, z: 1 }];
  let best: { x: number; z: number; rotation: number; d: number } | null = null;
  for (const area of areas) {
    const poly = area.polygon;
    for (let i = 0; i < poly.length; i++) {
      const v = { x: poly[i][0], z: poly[i][1] };
      const d = Math.hypot(cursor.x - v.x, cursor.z - v.z);
      if (d > reach || (best && d >= best.d)) continue;
      const unitDir = (p: [number, number]) => {
        const dx = p[0] - v.x;
        const dz = p[1] - v.z;
        const l = Math.hypot(dx, dz) || 1;
        return { x: dx / l, z: dz / l };
      };
      const e1 = unitDir(poly[(i + 1) % poly.length]);
      const e2 = unitDir(poly[(i - 1 + poly.length) % poly.length]);
      if (Math.abs(e1.x * e2.x + e1.z * e2.z) > 0.2) continue; // not a right angle
      if (!insidePolygon({ x: v.x + 0.1 * (e1.x + e2.x), z: v.z + 0.1 * (e1.z + e2.z) }, poly)) continue; // outside corner
      for (const rotation of [0, 90, 180, 270]) {
        const a = rotateY(along[0].x, along[0].z, rotation);
        const b = rotateY(along[1].x, along[1].z, rotation);
        const fits = (p: Pt, q: Pt) => a.x * p.x + a.z * p.z > 0.9 && b.x * q.x + b.z * q.z > 0.9;
        if (!fits(e1, e2) && !fits(e2, e1)) continue;
        const cw = { x: v.x + inset * (e1.x + e2.x), z: v.z + inset * (e1.z + e2.z) };
        const c = rotateY(corner[0], corner[1], rotation);
        best = { x: cw.x - c.x, z: cw.z - c.z, rotation, d };
        break;
      }
    }
  }
  return best && { x: best.x, z: best.z, rotation: best.rotation };
}

/**
 * Distance between two placed items: the clear gap between their footprints (0 when they touch or
 * overlap; an L counts as its two arms), the nearest points on each, and the centre-to-centre distance.
 */
export function measureBetween(a: PlacedItem, b: PlacedItem): { gap: number; from: Pt; to: Pt; centres: number } {
  const centres = Math.hypot(a.x - b.x, a.z - b.z);
  if (footprintsOverlap(a, b)) return { gap: 0, from: { x: a.x, z: a.z }, to: { x: b.x, z: b.z }, centres };
  let best = { gap: Infinity, from: { x: a.x, z: a.z }, to: { x: b.x, z: b.z } };
  const edges = (rects: Pt[][]) => rects.flatMap((r) => r.map((p, i) => [p, r[(i + 1) % r.length]] as [Pt, Pt]));
  const ea = edges(footprintRects(a));
  const eb = edges(footprintRects(b));
  const consider = (p: Pt, [s, e]: [Pt, Pt], pFromA: boolean) => {
    const q = closestOnSegment(p, s, e);
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d < best.gap) best = { gap: d, from: pFromA ? p : q, to: pFromA ? q : p };
  };
  // Closest points of two convex outlines lie at a vertex of one against an edge of the other.
  for (const [p] of ea) for (const edge of eb) consider(p, edge, true);
  for (const [p] of eb) for (const edge of ea) consider(p, edge, false);
  return { ...best, centres };
}

function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return { x: a.x + t * dx, z: a.z + t * dz };
}
