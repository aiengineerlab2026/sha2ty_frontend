import { Box3, Color, Mesh, MeshStandardMaterial, Vector3, type Material } from "three";
import type { MaterialEdit } from "../vendor/parts";
import { offsetsOf, type AddedSpec, type Side } from "../vendor/parts3d";
import { arabicName, isFitting, isSoft, mainName } from "./partNames";
import { partSize } from "./measure";

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
  // Only where it sits: a shelf spans the whole inside width too.
  return box.max.y >= bounds.max.y - near || box.min.y <= bounds.min.y + near;
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
    else ({ size, quantity } = partSize(meshes)); // on the furniture's axes, whatever the piece's own turn
    const edit = edits[id];
    let offsets: ViewPart["offsets"] = null;
    if (spec?.space) {
      const raw = offsetsOf(spec, new Box3(new Vector3(...spec.space[0]), new Vector3(...spec.space[1])));
      const axis: Record<Side, number> = { top: mpu.y, bottom: mpu.y, left: mpu.x, right: mpu.x, front: mpu.z, back: mpu.z };
      offsets = Object.fromEntries((Object.keys(raw) as Side[]).map((side) => [side, cm(Math.max(0, raw[side]) * axis[side])]));
    }
    const name = names.get(id) ?? meshes[0].name ?? id;
    const nameAr = arabicName(name, namesAr.get(id));
    const soft = isSoft(name) || isSoft(nameAr); // bedding: not in the close-ups or the parts list
    const shown = !soft && (Boolean(spec) || (!accessories.has(id) && Math.max(size.x, size.y, size.z) >= minShare * biggest));
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

/** 6: separate W / H / D dimension lines on each part, outside the model (5: labels beside the parts; 4: part pictures). */
export const VIEWS_VERSION = 10; // 10: close-ups at 1600 px, four to a page (9: thickness drawn, one size a row, critical / warning / info)
/** The pictures (lib/designs/captureViews.ts): square, printed about 18 cm wide, one a page. */
export const PICTURE = { W: 2400, H: 2400 };

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
/** Where the measured geometry is on the picture: `data[row * cols + col]` is 1 where a `cell`-px square is covered. */
export type Mask = { cell: number; cols: number; rows: number; data: Uint8Array };
/** One dimension: the measured edge (`from`, `to`), the dimension line set off from it (`a`, `b`, along `n`), its label. */
export type Dim = { from: Pt; to: Pt; a: Pt; b: Pt; n: Pt; label: Rect; text: string; color: string; short: boolean; along: boolean };

export const ARROW = 34; // arrow head length, px
const LEADER = 36; // the first set-off from the edge, px
const STEP = 28;

export function blocked(mask: Mask, r: Rect): boolean {
  const c0 = Math.max(0, Math.floor(r.x / mask.cell)), c1 = Math.min(mask.cols - 1, Math.floor((r.x + r.width) / mask.cell));
  const r0 = Math.max(0, Math.floor(r.y / mask.cell)), r1 = Math.min(mask.rows - 1, Math.floor((r.y + r.height) / mask.cell));
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (mask.data[y * mask.cols + x]) return true;
  return false;
}

const lineBlocked = (mask: Mask, a: Pt, b: Pt, pad: number) => {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps;
    if (blocked(mask, { x: x - pad, y: y - pad, width: 2 * pad, height: 2 * pad })) return true;
  }
  return false;
};

/** Whether the segment a–b passes through the rectangle r (a little inside its edge). */
const through = (a: Pt, b: Pt, r: Rect) => {
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps;
    if (x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height) return true;
  }
  return false;
};
const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const turn = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
};
const overlap = (a: Rect, b: Rect, gap: number) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
const pad = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });

/** Dimension lines on one picture, from the projected corners of each measured box: each along the box edge on the
 * outside of its silhouette, set off further out until its line and label touch no measured geometry (`mask`), no other
 * label and no other dimension line, inside the picture. Never shrinks the text: what finds no place returns null (the
 * caller tries a wider view or fewer parts). */
export class DimLayout {
  readonly dims: Dim[] = [];
  private rects: Rect[] = [];
  private lines: [Pt, Pt][] = [];
  private extensions: [Pt, Pt][] = [];
  constructor(private size: { w: number; h: number }, private mask: Mask, private margin = 28) {}

  /** A place nothing may cover (the legend, a notice). */
  block(r: Rect) {
    this.rects.push(r);
  }

  /** `corners`: the box's 8 corners on the picture, corner i at the max of axis k when bit k of i is set. */
  place(corners: Pt[], axis: 0 | 1 | 2, text: string, width: number, height: number, color: string): Dim | null {
    const bit = 1 << axis;
    const c = { x: corners.reduce((s, p) => s + p.x, 0) / 8, y: corners.reduce((s, p) => s + p.y, 0) / 8 };
    const edges = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !(i & bit)).map((i) => {
      const from = corners[i], to = corners[i | bit];
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      if (len < 1) return null; // the axis points at the camera: no edge to measure along (a thin board's ~3 px edge still is one)
      let n = { x: -(to.y - from.y) / len, y: (to.x - from.x) / len };
      const out = n.x * ((from.x + to.x) / 2 - c.x) + n.y * ((from.y + to.y) / 2 - c.y);
      if (out < 0) n = { x: -n.x, y: -n.y };
      return { from, to, len, n, out: Math.abs(out) };
    }).filter((e): e is NonNullable<typeof e> => e !== null).sort((a, b) => b.out - a.out); // the silhouette's edges first
    const { w, h } = this.size, m = this.margin;
    const inside = (p: Pt) => p.x >= m && p.y >= m && p.x <= w - m && p.y <= h - m;
    // Upright labels first; then, on a near-vertical line, the text written along it (as on a technical drawing: it
    // needs only its height beside the line). Nearest first: each set-off on every edge before a further one.
    for (const along of [false, true]) for (let off = LEADER; off < Math.max(w, h) / 2; off += STEP) {
      for (const e of edges) {
        const d = { x: (e.to.x - e.from.x) / e.len, y: (e.to.y - e.from.y) / e.len };
        if (along && Math.abs(d.y) < 0.94) continue; // only within 20° of vertical: its box stays tight
        const [lw, lh] = along ? [height, width] : [width, height];
        const short = e.len < 2 * ARROW + 24; // arrows outside, pointing in
        const tail = short ? ARROW + 30 : 0;
        const a = { x: e.from.x + e.n.x * off, y: e.from.y + e.n.y * off }, b = { x: e.to.x + e.n.x * off, y: e.to.y + e.n.y * off };
        const a2 = { x: a.x - d.x * tail, y: a.y - d.y * tail }, b2 = { x: b.x + d.x * tail, y: b.y + d.y * tail };
        if (!inside(a2) || !inside(b2)) continue; // off the picture
        // The label just beyond the line's middle.
        const away = Math.abs(e.n.x) * lw / 2 + Math.abs(e.n.y) * lh / 2 + 12;
        const label = { x: (a.x + b.x) / 2 + e.n.x * away - lw / 2, y: (a.y + b.y) / 2 + e.n.y * away - lh / 2, width: lw, height: lh };
        if (!inside(label) || !inside({ x: label.x + lw, y: label.y + lh })) continue;
        if (blocked(this.mask, pad(label, 10)) || lineBlocked(this.mask, a2, b2, 6)) continue;
        if (this.rects.some((r) => overlap(r, label, 16) || through(a2, b2, pad(r, 8)) || through(e.from, a, r) || through(e.to, b, r))) continue;
        if (this.lines.some(([p, q]) => crosses(a2, b2, p, q) || through(p, q, pad(label, 8)))) continue;
        if (this.extensions.some(([p, q]) => through(p, q, label))) continue;
        const dim = { from: e.from, to: e.to, a, b, n: e.n, label, text, color, short, along };
        this.dims.push(dim);
        this.rects.push(label);
        this.lines.push([a2, b2]);
        this.extensions.push([e.from, a], [e.to, b]);
        return dim;
      }
    }
    return null;
  }
}
