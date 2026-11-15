import { Box3, Color, Mesh, MeshStandardMaterial, Vector3, type Material } from "three";
import type { MaterialEdit } from "../vendor/parts";
import { offsetsOf, type AddedSpec, type Side } from "../vendor/parts3d";
import { arabicName, isFitting, mainName } from "./partNames";

/** One row of the request report's parts table (backend app/api/marketplace.py ViewPart): sizes in cm. */
export type ViewPart = {
  n: number;
  id: string;
  name: string;
  added: boolean;
  quantity: number;
  material: string | null;
  color: string | null;
  width: number;
  height: number;
  depth: number;
  thickness: number;
  /** Distances from the inside faces of the compartment it was fitted into (added parts). */
  offsets: Partial<Record<Side, number>> | null;
  /** Labelled in the opened picture (the parts worth pointing at; the small fittings on them are not). */
  shown: boolean;
  /** The name in Arabic (the vendor's, else translated), and both without position or number ("Wood grain door"). */
  name_ar: string;
  main_name: string;
  main_name_ar: string;
  /** A main furniture part (body, doors, shelves, drawers…): not hardware (handles, hinges, locks, slides…). */
  main: boolean;
  /** The material chosen for it (wood, paint, fabric…) and its finish from its roughness; null: not set. */
  kind: string | null;
  finish: "matte" | "satin" | "gloss" | null;
  /** The board chosen in the editor (wood_type: mdf, plywood, oak…), its thickness (mm), the surface on it (veneer,
   * melamine…: name and type), a paint's colour name, and the texture picture; null: not chosen. */
  board: string | null;
  board_mm: number | null;
  surface: string | null;
  surface_type: string | null;
  paint: string | null;
  texture: string | null;
  /** The report's section: the body, doors, drawers, shelves, then small fittings. */
  group: PartGroup;
  /** Its picture in the parts sheet (main parts only): cell `pic` of PARTS_SHEET; null: none. */
  pic: number | null;
};

export type PartGroup = "structure" | "doors" | "drawers" | "shelves" | "accessories";
const ADDED_GROUP: Record<string, PartGroup> = { shelf: "shelves", door: "doors", drawer: "drawers", divider: "structure", back: "structure", rod: "accessories", handle: "accessories", leg: "accessories" };
/** The main parts' pictures: PARTS_SHEET.size squares, PARTS_SHEET.cols to a line. */
export const PARTS_SHEET = { size: 512, cols: 8 };

const cm = (m: number) => Math.round(m * 1000) / 10;

/** A flat board at the model's very top or bottom (the top cap, the bottom panel): the body's, not a shelf. */
function atTopOrBottom(meshes: Mesh[], bounds: Box3): boolean {
  const box = meshes.reduce((b, m) => b.union(new Box3().setFromObject(m)), new Box3());
  const near = 0.03 * (bounds.max.y - bounds.min.y);
  const wide = box.max.x - box.min.x >= 0.9 * (bounds.max.x - bounds.min.x); // spans the whole width: a body panel
  return wide || box.max.y >= bounds.max.y - near || box.min.y <= bounds.min.y + near;
}


/** A mesh's size along its own axes in metres (rotation and parent transforms included): its geometry's box times
 * the scale its world matrix gives each axis. `local` × `world scale` stays right for a rotated part, where a world
 * box would measure the turned part's diagonal. */
export function meshSize(mesh: Mesh): Vector3 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  return mesh.geometry.boundingBox!.getSize(new Vector3()).multiply(new Vector3().setFromMatrixScale(mesh.matrixWorld));
}

function colorOf(material: Material | Material[]): string | null {
  const m = (Array.isArray(material) ? material[0] : material) as MeshStandardMaterial;
  if (m?.map) return null; // a texture (wood grain, a pattern): its colour is the picture's, not the base colour
  return m?.color instanceof Color ? `#${m.color.getHexString()}` : null;
}

/** Every part of the saved model as the report lists it, measured from the real geometry (world matrices must be
 * up to date, the model at rest). Parts of several alike pieces are one row with a quantity. Added parts take their
 * exact saved size (`mpu`: metres per model unit on x, y, z) and their offsets in the compartment they were fitted
 * into; original parts have no compartment saved, so no offsets (never guessed). Numbered: added parts, and original
 * parts at least `minShare` of the model's largest side that are not accessories riding on another part. */
export function partsTable({ slots, names, namesAr = new Map(), added, mpu, edits, accessories, whole, minShare = 0.12, moving = new Map(), bounds }: {
  slots: { id: string; mesh: Mesh }[];
  names: Map<string, string>;
  /** The vendor's Arabic names, where there are some. */
  namesAr?: Map<string, string | null | undefined>;
  added: AddedSpec[];
  mpu: Vector3;
  edits: Record<string, MaterialEdit>;
  /** Parts that ride on a movable part (handles, locks, trim): listed, not numbered in the picture. */
  accessories: Set<string>;
  /** The whole model's size in metres. */
  whole: Vector3;
  minShare?: number;
  /** The moving parts (detected or set): a turning one is a door (or lid), a sliding one a drawer. */
  moving?: Map<string, "rotation" | "translation">;
  /** The whole model's box (world): a flat board at its very top or bottom is the body's, not a shelf. */
  bounds?: Box3;
}): ViewPart[] {
  const specs = new Map(added.map((a) => [a.id, a]));
  const groups = new Map<string, Mesh[]>();
  for (const { id, mesh } of slots) groups.set(id, [...(groups.get(id) ?? []), mesh]);
  const biggest = Math.max(whole.x, whole.y, whole.z);
  const rows: Omit<ViewPart, "n">[] = [];
  for (const [id, meshes] of groups) {
    const spec = specs.get(id);
    let size: Vector3;
    let quantity = 1;
    if (spec) size = new Vector3(...spec.size).multiply(mpu);
    else {
      const sizes = meshes.map(meshSize);
      const alike = sizes.every((s) => s.distanceTo(sizes[0]) <= 0.01 * sizes[0].length() + 1e-4);
      if (alike) [size, quantity] = [sizes[0], sizes.length];
      else size = meshes.reduce((box, m) => box.union(new Box3().setFromObject(m)), new Box3()).getSize(new Vector3());
    }
    const edit = edits[id];
    let offsets: ViewPart["offsets"] = null;
    if (spec?.space) {
      const raw = offsetsOf(spec, new Box3(new Vector3(...spec.space[0]), new Vector3(...spec.space[1])));
      const axis: Record<Side, number> = { top: mpu.y, bottom: mpu.y, left: mpu.x, right: mpu.x, front: mpu.z, back: mpu.z };
      offsets = Object.fromEntries((Object.keys(raw) as Side[]).map((side) => [side, cm(Math.max(0, raw[side]) * axis[side])]));
    }
    const name = names.get(id) ?? meshes[0].name ?? id;
    const nameAr = arabicName(name, namesAr.get(id));
    const shown = Boolean(spec) || (!accessories.has(id) && Math.max(size.x, size.y, size.z) >= minShare * biggest);
    const roughness = edit?.roughness;
    rows.push({
      id,
      name,
      name_ar: nameAr,
      main_name: mainName(name),
      main_name_ar: mainName(nameAr),
      main: shown && !isFitting(name) && !isFitting(nameAr),
      kind: edit?.material?.kind ?? null,
      board: edit?.material?.wood_type ?? null,
      board_mm: edit?.material?.thickness_mm ?? null,
      surface: edit?.material?.finish?.name ?? null,
      surface_type: edit?.material?.finish?.wood_type ?? null,
      paint: edit?.material?.kind === "paint" ? edit.material.color_name ?? null : null,
      texture: edit?.mapUrl ?? null,
      group: spec ? ADDED_GROUP[spec.type] ?? "structure"
        : moving.has(id) ? (moving.get(id) === "rotation" ? "doors" : "drawers")
        : accessories.has(id) || Math.max(size.x, size.y, size.z) < minShare * biggest ? "accessories"
        : Math.min(size.x, size.y, size.z) <= 0.1 && size.y < Math.min(size.x, size.z) && !(bounds && atTopOrBottom(meshes, bounds)) ? "shelves" // a board lying flat inside
        : "structure",
      pic: null,
      finish: roughness == null ? null : roughness < 0.3 ? "gloss" : roughness < 0.6 ? "satin" : "matte",
      added: Boolean(spec),
      quantity,
      material: edit?.material?.name ?? (edit?.mapUrl ? "Texture" : null),
      color: edit?.color ?? colorOf(meshes[0].material),
      width: cm(size.x),
      height: cm(size.y),
      depth: cm(size.z),
      // A board's thickness (its thinnest side, up to 10 cm); 0 for solid parts, where it means nothing.
      thickness: Math.min(size.x, size.y, size.z) <= 0.1 ? cm(Math.min(size.x, size.y, size.z)) : 0,
      offsets,
      shown,
    });
  }
  // The labelled original parts first, then the rest of the originals, then what the customer added.
  const order = [...rows.filter((r) => !r.added && r.shown), ...rows.filter((r) => !r.added && !r.shown), ...rows.filter((r) => r.added)];
  // The main parts' pictures, in this order.
  let pic = 0;
  return order.map((r, i) => ({ n: i + 1, ...r, pic: r.main ? pic++ : null }));
}

export const fmt = (cm: number) => (Math.abs(cm - Math.round(cm)) < 0.05 ? String(Math.round(cm)) : cm.toFixed(1));

/** A part's label: its name, its size (a board: its two face sizes and its thickness) and, for an added part, how far
 * it sits from the compartment's faces. The same numbers as the parts table. */
export function labelLines(p: ViewPart, lang: "ar" | "en"): string[] {
  const w = lang === "ar"
    ? { W: "عرض", H: "ارتفاع", D: "عمق", T: "سُمك", cm: "سم", top: "من الأعلى", bottom: "من الأسفل", left: "من اليسار", right: "من اليمين" }
    : { W: "W", H: "H", D: "D", T: "T", cm: "cm", top: "Top offset", bottom: "Bottom offset", left: "Left offset", right: "Right offset" };
  const dims: [string, number][] = [[w.W, p.width], [w.H, p.height], [w.D, p.depth]];
  const thin = p.thickness ? dims.reduce((m, d, i) => (d[1] < dims[m][1] ? i : m), 0) : -1;
  const size = dims.filter((_, i) => i !== thin).map(([k, v]) => `${k}: ${fmt(v)}`).join(" × ") + (thin >= 0 ? ` · ${w.T}: ${fmt(p.thickness)}` : "") + ` ${w.cm}`;
  const lines = [lang === "ar" ? p.name_ar : p.name, size];
  if (p.offsets) {
    const sides = (["top", "bottom", "left", "right"] as const).filter((k) => p.offsets?.[k] !== undefined && (k === "top" || k === "bottom" || p.offsets[k]! > 0.05));
    if (sides.length) lines.push(sides.map((k) => `${w[k]}: ${fmt(p.offsets![k]!)}`).join(" · ") + ` ${w.cm}`);
  }
  return lines;
}

/** The pictures' layout (lib/designs/captureViews.ts): 2400 × 1600, the model in the middle half, labels in a column
 * on each side. Version 2: dimensions written beside the parts (version 1 pictures had numbered markers; the report
 * never shows those). */
export const VIEWS_VERSION = 5; // 5: square pictures, labels beside the parts, a view per group (4: part pictures; 3: Arabic names)
export const PICTURE = { W: 2400, H: 2400, GAP: 18, TOP: 16, BOTTOM: 1600 - 110, COLUMN: 0.28 * 2400 - 40 };
/** Label text sizes (px): readable once the 2400 px picture is printed about 18 cm wide. */
export const LABEL_FONT = { name: 34, size: 38, line: 48 };

export type LabelBox = { id: string; anchor: { x: number; y: number }; width: number; height: number; added: boolean; size: number };
export type PlacedLabel = LabelBox & { x: number; y: number; side: 0 | 1 };

/** Where each label goes: in the column on its part's side (the other one when that is full), in the order of the
 * parts' heights so leaders never cross, pushed apart so none overlap, kept in the picture. At most `capacity`, by
 * the order given (most important first); what does not fit is returned in `left` (it gets a close-up), never
 * dropped. */
export function placeLabels(items: LabelBox[], capacity: number): { placed: PlacedLabel[]; left: string[] } {
  const { W, GAP, TOP, BOTTOM } = PICTURE;
  const room = BOTTOM - TOP;
  const columns: LabelBox[][] = [[], []];
  const used = [0, 0];
  const left: string[] = [];
  for (const [i, it] of items.entries()) {
    const want: 0 | 1 = it.anchor.x < W / 2 ? 0 : 1;
    const side = [want, (1 - want) as 0 | 1].find((s) => used[s] + it.height + GAP <= room);
    if (i >= capacity || side === undefined) {
      left.push(it.id);
      continue;
    }
    columns[side].push(it);
    used[side] += it.height + GAP;
  }
  const placed: PlacedLabel[] = [];
  for (const side of [0, 1] as const) {
    const column = columns[side].sort((a, b) => a.anchor.y - b.anchor.y).map((it) => ({ ...it, side, x: side === 0 ? 24 : W - 24 - it.width, y: 0 }));
    let y = TOP;
    for (const it of column) {
      it.y = Math.max(y, Math.min(it.anchor.y - it.height / 2, BOTTOM - it.height));
      y = it.y + it.height + GAP;
    }
    for (let i = column.length - 1, limit = BOTTOM; i >= 0; i--) { // pushed past the bottom: back up
      column[i].y = Math.min(column[i].y, limit - column[i].height);
      limit = column[i].y - GAP;
    }
    placed.push(...column);
  }
  return { placed, left };
}

/** A label to place beside its part: its part's rectangle on the picture (px), the point its leader ends at, its size. */
export type NearLabel = { id: string; part: { x0: number; y0: number; x1: number; y1: number }; anchor: { x: number; y: number }; width: number; height: number };
export type NearPlaced = NearLabel & { x: number; y: number };

/** Whether the segment a–b passes through the rectangle r (a little inside its edge). */
const through = (a: { x: number; y: number }, b: { x: number; y: number }, r: { x: number; y: number; width: number; height: number }) => {
  const inset = 4;
  const x0 = r.x + inset, y0 = r.y + inset, x1 = r.x + r.width - inset, y1 = r.y + r.height - inset;
  for (let i = 0; i <= 24; i++) {
    const x = a.x + ((b.x - a.x) * i) / 24, y = a.y + ((b.y - a.y) * i) / 24;
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
};
const crosses = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) => {
  const turn = (p: typeof a, q: typeof a, r: typeof a) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
};

/** Each label beside its part, never shrunk: the first of a few places around the part (above, below, beside, then
 * further out) that stays inside the picture (`margin`), overlaps no placed label, covers no other part's anchor point
 * and whose leader crosses no other leader. What finds no clean place is returned in `left` (it goes to another view). */
export function placeNear(items: NearLabel[], size: { w: number; h: number }, margin = 24, gap = 14): { placed: NearPlaced[]; left: string[] } {
  const placed: NearPlaced[] = [];
  const left: string[] = [];
  const leaders: [{ x: number; y: number }, { x: number; y: number }][] = [];
  const end = (r: { x: number; y: number; width: number; height: number }, to: { x: number; y: number }) => ({ x: Math.min(Math.max(to.x, r.x), r.x + r.width), y: Math.min(Math.max(to.y, r.y), r.y + r.height) });
  for (const it of items) {
    const { x0, y0, x1, y1 } = it.part;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const spots: { x: number; y: number }[] = [];
    for (const out of [gap, gap + 70, gap + 160]) {
      spots.push(
        { x: cx - it.width / 2, y: y0 - out - it.height }, // above
        { x: cx - it.width / 2, y: y1 + out }, // below
        { x: x1 + out, y: cy - it.height / 2 }, // beside
        { x: x0 - out - it.width, y: cy - it.height / 2 },
      );
    }
    spots.push({ x: cx - it.width / 2, y: cy - it.height / 2 }); // on the part itself (a big panel)
    const spot = spots.find((s) => {
      const r = { ...s, width: it.width, height: it.height };
      if (s.x < margin || s.y < margin || s.x + it.width > size.w - margin || s.y + it.height > size.h - margin) return false;
      if (placed.some((p) => s.x < p.x + p.width + gap && p.x < s.x + it.width + gap && s.y < p.y + p.height + gap && p.y < s.y + it.height + gap)) return false;
      if (items.some((o) => o.id !== it.id && o.anchor.x > s.x - 6 && o.anchor.x < s.x + it.width + 6 && o.anchor.y > s.y - 6 && o.anchor.y < s.y + it.height + 6)) return false;
      const a = end(r, it.anchor);
      if (leaders.some(([p, q]) => crosses(a, it.anchor, p, q))) return false;
      // Its leader passes through no placed label, and it covers no placed leader.
      if (placed.some((p) => through(a, it.anchor, p))) return false;
      return !leaders.some(([p, q]) => through(p, q, r));
    });
    if (!spot) {
      left.push(it.id);
      continue;
    }
    const done = { ...it, ...spot };
    placed.push(done);
    leaders.push([end(done, it.anchor), it.anchor]);
  }
  return { placed, left };
}
