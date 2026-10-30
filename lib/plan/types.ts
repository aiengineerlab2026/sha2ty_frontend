export type Vec2 = [number, number];

export interface PlanWall {
  id: string;
  start: Vec2;
  end: Vec2;
  height: number;
  /** Base height in metres: lintels above doors and window sills/headers sit above the floor. */
  elevation?: number;
  thickness: number;
  length: number;
}

/** Pixel-space structures edited in the correction view. Coordinates are original-image pixels. */
export interface WallPx {
  id: string;
  start: Vec2;
  end: Vec2;
  thickness: number;
  orientation: "h" | "v" | "d";
  confidence: number;
}

export interface OpeningPx {
  id: string;
  kind: "door" | "window" | "opening";
  start: Vec2;
  end: Vec2;
  thickness: number;
  length?: number;
  evidence: string;
  confidence: number;
}

export interface LabelPx {
  name: string;
  kind: string;
  x: number;
  y: number;
  box: [number, number, number, number];
  text: string;
  dims_m: [number, number] | null;
  dims_text: string | null;
  dims_uncertain: boolean;
}

export interface RoomPx {
  id: string;
  name: string;
  kind: string;
  polygon: Vec2[];
  holes: Vec2[][];
  label_point: Vec2;
  area_px: number;
  zone_ids: string[];
  uncertain: boolean;
  invalid: string[];
  confidence: number;
}

export interface ZonePx {
  id: string;
  room_id: string;
  name: string;
  kind: string;
  polygon: Vec2[];
  label_point: Vec2;
  boundary: "wall" | "drawn_line" | "inferred" | "user";
  label_index: number | null;
  dims_m: [number, number] | null;
  dims_text: string | null;
  measured_m: [number, number] | null;
  dims_error?: number;
  confidence: number;
}

export interface PlanScale {
  meters_per_pixel: number | null;
  px_per_ft?: number;
  confidence: number;
  uniform: boolean;
  confirmed: boolean;
  source: string;
  warnings: string[];
  candidates: { zone_id: string; name: string; printed: string; mpp_x: number; mpp_y: number; inlier?: boolean }[];
}

export interface CorrectionState {
  image_size: { width: number; height: number };
  thickness_px: number;
  walls_px: WallPx[];
  openings_px: OpeningPx[];
  labels: LabelPx[];
  zone_lines: { start: Vec2; end: Vec2 }[];
  straight_lines?: string;
  drawing_unit?: string | null;
  meters_per_pixel?: number | null;
  scale_confirmed?: boolean;
  height?: number;
  wall_thickness?: number;
}

export interface PlanZone {
  id: string;
  room_id: string;
  name: string;
  kind: string;
  polygon: Vec2[];
  label_point?: Vec2;
  dimensions?: { width: number; length: number; printed?: [number, number] };
}

export interface PlanRoom {
  id: string;
  name: string;
  kind?: string;
  polygon: Vec2[];
  width: number;
  depth: number;
  height: number;
  dimensions?: { width: number; length: number };
  confidence?: number;
}

/** Paint applied to one wall face; a snapshot so plans keep rendering if the vendor edits the library. */
export interface WallPaint {
  /** Library paint id (pricing and cart); older plans may not have it. */
  paint_id?: string;
  price?: number | null;
  price_unit?: "item" | "m2";
  name: string;
  color: string;
  texture_url: string | null;
  tile_m: number;
  /** Tile width × height in metres (texture repeat); falls back to tile_m on older plans. */
  tile_w?: number;
  tile_h?: number;
}

/** Carpet laid on the floor; rotation in degrees, same convention as furniture rotation_y. */
export interface PlacedRug {
  id: string;
  carpetId: string;
  price?: number | null;
  price_unit?: "item" | "m2";
  name: string;
  image_url: string;
  width: number;
  length: number;
  x: number;
  z: number;
  rotation: number;
  /** Tilt about the carpet's own X axis in degrees (−90…90), e.g. hung on a wall. */
  tilt?: number;
}

/** Window applied to a wall face: centred `along` metres from the wall's start, centre `y` above the floor. */
export interface PlacedWindow {
  id: string;
  windowId: string;
  name: string;
  image_url: string;
  width: number;
  height: number;
  wall_id: string;
  side: "L" | "R";
  along: number;
  y: number;
  price?: number | null;
  price_unit?: "item" | "m2";
}

export interface PlanGeometry {
  rooms: PlanRoom[];
  walls: PlanWall[];
  openings: unknown[];
  doors?: unknown[];
  windows?: unknown[];
  warnings: string[];
  scale_confidence: number;
  source: "image" | "dimensions";
  wall_thickness: number;
  height: number;
  extents?: { width: number; depth: number; height: number };
  ocr_measurements?: { text: string; meters: number }[];
  preview_image?: string;
  debug_images?: Record<string, string>;
  unit?: string;
  zones?: PlanZone[];
  /** `${wallId}:L` / `${wallId}:R` → paint on that face (L = left of start→end seen from above). */
  wall_paints?: Record<string, WallPaint>;
  /** Zone/room id → floor paint. */
  floor_paints?: Record<string, WallPaint>;
  rugs?: PlacedRug[];
  /** Vendor windows on wall faces (not the detected window openings in `windows`). */
  placed_windows?: PlacedWindow[];
  floors?: Vec2[][];
  meters_per_pixel?: number | null;
  // Pixel-space plan (present on image imports) — see CorrectionState.
  image_size?: { width: number; height: number };
  thickness_px?: number;
  walls_px?: WallPx[];
  openings_px?: OpeningPx[];
  labels?: LabelPx[];
  zone_lines?: { start: Vec2; end: Vec2 }[];
  straight_lines?: string;
  drawing_unit?: string | null;
  rooms_px?: RoomPx[];
  zones_px?: ZonePx[];
  footprint_px?: Vec2[];
  scale?: PlanScale;
  validation?: { ok: boolean; errors: string[]; warnings: string[] };
}

export interface CatalogModel {
  id: string;
  title: string;
  /** Vendor's rich-text HTML: sanitise before rendering. */
  description?: string;
  price?: number | null;
  price_unit?: "item" | "m2";
  /** furniture | tv | lighting | ceiling_light | air_conditioner (lib/plan/categories). */
  category?: string;
  /** "straight" (default) or an L-shaped corner unit, corner at the back-left / back-right seen from the front. */
  shape?: "straight" | "l_left" | "l_right";
  /** L-shaped: length along the second wall (width_m is the first wall, depth_m the arm depth). */
  length2_m?: number | null;
  /** Variant photo URLs, in the vendor's order. */
  variants?: string[];
  width_m: number | null;
  height_m: number | null;
  depth_m: number | null;
  glb_url: string;
  thumbnail: string | null;
  company_id: string;
  company: string;
  company_logo?: string | null;
}

export interface CompanyGroup {
  id: string;
  name: string;
  logo_url: string | null;
  models: CatalogModel[];
}

export interface PlacedItem {
  instanceId: string;
  modelId: string;
  title: string;
  company: string;
  glbUrl: string;
  width_m: number;
  height_m: number;
  depth_m: number;
  x: number;
  y: number;
  z: number;
  rotation_y: number;
  /** Tilt about the item's own X axis in degrees (−90…90), applied after rotation_y. */
  rotation_x?: number;
  category?: string;
  /** L-shaped corner unit: width_m × depth_m is its bounding box, arm_m how deep each arm is. */
  shape?: "straight" | "l_left" | "l_right";
  arm_m?: number;
  /** "ceiling": hangs from the ceiling (y = ceiling − height); "wall": wall art centred at eye level.
   * Items only collide with others at the same mount. */
  mount?: "floor" | "ceiling" | "wall";
  /** Legacy field from saved plans; ignored. */
  scale?: [number, number, number];
  /** Rendered size in metres (GLB proportions kept, fitted inside width_m/height_m/depth_m). */
  size?: { width: number; height: number; depth: number };
  price?: number | null;
  price_unit?: "item" | "m2";
  warnings: string[];
}

export interface SavedPlan {
  id: string;
  name: string;
  source: "image" | "dimensions";
  source_image_url: string | null;
  geometry: PlanGeometry;
  items: PlacedItem[];
  camera: unknown;
  warnings: string[];
}
