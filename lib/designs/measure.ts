import { Box3, Vector3, type Mesh } from "three";
import { fmt, type ViewPart } from "./viewParts";

/** The report's measurements, one source for its pictures and its tables: sizes from the meshes' geometry and world
 * transforms (never from a picture), each part's sides put on the furniture's own axes (width x, height y, depth z),
 * alike parts grouped the way the PDF's parts table groups them, and the checks run before the PDF is made. */

export type Axis = 0 | 1 | 2; // width, height, depth
export const AXES = ["width", "height", "depth"] as const;
const PERMS: [Axis, Axis, Axis][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/** A mesh's size on the furniture's axes (metres): its geometry's box along its own axes, scaled by its world matrix
 * (nested groups, scale and rotation included), each own axis put on the world axis it lies most along. `axes[i]`:
 * the world axis of the mesh's own axis i (what a picture's dimension line along that edge is labelled). */
export function orientedSize(mesh: Mesh): { size: Vector3; axes: [Axis, Axis, Axis] } {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  mesh.updateWorldMatrix(true, false);
  const extent = mesh.geometry.boundingBox!.getSize(new Vector3());
  const e = mesh.matrixWorld.elements;
  const columns = [0, 1, 2].map((i) => new Vector3(e[4 * i], e[4 * i + 1], e[4 * i + 2]));
  const lengths = columns.map((c, i) => c.length() * extent.getComponent(i));
  const dirs = columns.map((c) => (c.lengthSq() ? c.clone().normalize() : c));
  const best = PERMS.reduce((b, p) => {
    const score = p.reduce<number>((s, world, i) => s + Math.abs(dirs[i].getComponent(world)), 0);
    return score > b.score ? { p, score } : b;
  }, { p: PERMS[0], score: -1 }).p;
  const size = new Vector3();
  best.forEach((world, i) => size.setComponent(world, lengths[i]));
  return { size, axes: best };
}

/** The sizes of a part's pieces on the furniture's axes and how many: alike pieces (within 1 %) one size × n; else
 * the box around them all (`axes` the world's own). */
export function partSize(meshes: Mesh[]): { size: Vector3; quantity: number; axes: [Axis, Axis, Axis] } {
  const sized = meshes.map(orientedSize);
  const first = sized[0];
  if (sized.every((s) => s.size.distanceTo(first.size) <= 0.01 * first.size.length() + 1e-4)) return { size: first.size, quantity: sized.length, axes: first.axes };
  return { size: meshes.reduce((box, m) => box.union(new Box3().setFromObject(m)), new Box3()).getSize(new Vector3()), quantity: 1, axes: [0, 1, 2] };
}

/** A part's name as the parts table shows it. */
export const tableName = (p: ViewPart, lang: "ar" | "en") => (lang === "ar" ? p.main_name_ar || p.name_ar || p.name : p.main_name || p.name);

/** One row of the parts table: identical parts (same name, material, group and sizes, to the millimetre) and their
 * count; parts that differ at all get rows of their own (no ranges: a carpenter cuts one size per row). The same rule
 * as the PDF's (backend request_report._components), so a close-up and its row agree. */
export type Row = { parts: ViewPart[]; quantity: number; lo: Record<(typeof AXES)[number], number>; hi: Record<(typeof AXES)[number], number> };
export const SAME_WITHIN = 0.05; // cm: the same size once rounded to the millimetre
const GROUP_ORDER = ["structure", "doors", "drawers", "shelves", "accessories"];

export function tableRows(parts: ViewPart[], lang: "ar" | "en"): Row[] {
  const key = (p: ViewPart) => JSON.stringify([tableName(p, lang), p.kind, p.material, p.board, p.board_mm, p.surface, p.paint, p.texture, p.added, p.group]);
  const rows: (Row & { key: string })[] = [];
  for (const p of parts) {
    const k = key(p);
    const same = rows.find((r) => r.key === k && AXES.every((a) => Math.abs(p[a] - r.lo[a]) <= SAME_WITHIN && Math.abs(p[a] - r.hi[a]) <= SAME_WITHIN));
    if (same) {
      same.parts.push(p);
      same.quantity += p.quantity;
      for (const a of AXES) [same.lo[a], same.hi[a]] = [Math.min(same.lo[a], p[a]), Math.max(same.hi[a], p[a])];
    } else rows.push({ key: k, parts: [p], quantity: p.quantity, lo: { width: p.width, height: p.height, depth: p.depth }, hi: { width: p.width, height: p.height, depth: p.depth } });
  }
  const rank = (r: Row) => GROUP_ORDER.indexOf(r.parts[0].group);
  return rows.sort((a, b) => rank(a) - rank(b)).map(({ parts: ps, quantity, lo, hi }) => ({ parts: ps, quantity, lo, hi }));
}

/** A size as the table prints it: one number, or the range of alike parts ("36–37.5"). */
export const span = (lo: number, hi: number) => (Math.abs(hi - lo) < 0.05 ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`);

const WORDS = {
  ar: { width: "العرض", height: "الارتفاع", depth: "العمق", thickness: "السُمك", length: "الطول", cm: "سم" },
  en: { width: "Width", height: "Height", depth: "Depth", thickness: "Thickness", length: "Length", cm: "cm" },
};

/** The labels of a row's picture, by the mesh's own axis (`axes`: own axis → world axis).
 * A flat panel uses the cutting list's words: the longest edge is Length, the other face Width, the thinnest Thickness.
 * A solid part keeps the world axis (width, height, depth). The numbers are the table's, never a new measurement. */
export function axisTexts(row: Row, axes: [Axis, Axis, Axis], lang: "ar" | "en"): string[] {
  const w = WORDS[lang];
  const flat = row.parts.some((p) => p.thickness > 0);
  const name = axes.map((world) => w[AXES[world]]);
  if (flat) {
    const rank = axes.map((world, i) => ({ i, size: row.hi[AXES[world]] })).sort((a, b) => b.size - a.size || a.i - b.i);
    const face = [w.length, w.width, w.thickness];
    rank.forEach((r, n) => { name[r.i] = face[n]; });
  }
  return axes.map((world, i) => `${name[i]} ${span(row.lo[AXES[world]], row.hi[AXES[world]])} ${w.cm}`);
}

/** One finding, rendered by the PDF in its own language (backend request_report c_*): `parts` are part ids.
 * critical: the report is not ready for manufacturing until it is confirmed or fixed; warning: to check; info: to note. */
export type Check = { level: "critical" | "warning" | "info"; code: "approx" | "mismatch" | "units" | "missing" | "exceeds" | "over_request" | "axis" | "overlap" | "joint" | "clearance" | "drawer" | "shelf"; parts: string[]; params: Record<string, number | string> };
type Cm = { width: number; height: number; depth: number };
/** A part's box in the model at rest (cm, world axes). */
export type RestBox = { min: [number, number, number]; max: [number, number, number] };

const OVERLAP = 0.5; // cm: pieces that go further into each other than this do not fit as modelled
const CLEARANCE = 0.1; // cm: doors closer than this have no gap to open
const DRAWER_GAP = 1.0; // cm: less room than this beside a panel is tight for a slide; a normal 1.2 cm gap is not flagged
const SHELF_GAP = 0.3; // cm: a shelf this close to a side, but not housed in it, does not meet the panel
const round = (v: number) => Math.round(v * 10) / 10;

/** The checks before the PDF: never changes a size, only says what does not add up. Sizes that are estimates (the
 * real size unknown) or differ from what the customer asked for are critical: they must be confirmed first. `requested`: the customer's size
 * (cm; null when none was set); `model`: the 3D model's, measured; `boxes`: the main parts at rest. */
export function checkMeasurements({ parts, model, requested, scaleKnown, boxes }: { parts: ViewPart[]; model: Cm; requested: Cm | null; scaleKnown: boolean; boxes: Map<string, RestBox> }): Check[] {
  const checks: Check[] = [];
  if (!scaleKnown) checks.push({ level: "critical", code: "approx", parts: [], params: {} });
  if (requested) {
    for (const a of AXES) {
      const diff = model[a] - requested[a];
      if (Math.abs(diff) > Math.max(1, 0.01 * requested[a])) checks.push({ level: "critical", code: "mismatch", parts: [], params: { axis: a, requested: round(requested[a]), model: round(model[a]), diff: round(diff) } });
    }
  }
  if (AXES.some((a) => !(model[a] >= 10 && model[a] <= 600))) checks.push({ level: "critical", code: "units", parts: [], params: { width: round(model.width), height: round(model.height), depth: round(model.depth) } });
  const main = parts.filter((p) => p.main);
  for (const p of main) {
    if (AXES.some((a) => !(p[a] > 0) || !Number.isFinite(p[a]))) {
      checks.push({ level: "critical", code: "missing", parts: [p.id], params: {} });
      continue;
    }
    for (const a of AXES) if (p[a] > model[a] + 0.5) checks.push({ level: "critical", code: "exceeds", parts: [p.id], params: { axis: a, value: round(p[a]), overall: round(model[a]) } });
    // Larger than the size the customer asked for, even when the 3D model is larger still. The part is not resized.
    if (requested) for (const a of AXES) if (p[a] > requested[a] + 0.5) checks.push({ level: "critical", code: "over_request", parts: [p.id], params: { axis: a, value: round(p[a]), overall: round(requested[a]) } });
    // A door or a drawer front is thinnest front to back; a shelf top to bottom.
    const expected = p.group === "doors" ? "depth" : p.group === "shelves" ? "height" : null;
    if (expected && p.thickness && AXES.reduce((m, a) => (p[a] < p[m] ? a : m), "width" as (typeof AXES)[number]) !== expected) checks.push({ level: "warning", code: "axis", parts: [p.id], params: { expected } });
  }
  // How far two boxes go into each other on each axis (negative: the gap between them).
  const into = (a: RestBox, b: RestBox) => [0, 1, 2].map((i) => Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]));
  const solid = main.filter((p) => p.group !== "accessories" && boxes.has(p.id));
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const [p, q] = [solid[i], solid[j]];
      const d = into(boxes.get(p.id)!, boxes.get(q.id)!);
      if (d.every((v) => v > OVERLAP)) {
        // No deeper than half the thicker board: a groove or housing (a shelf let into a side, a back panel in its
        // groove), to confirm. Deeper: the two pieces fill the same space, a modelling error.
        const depth = round(Math.min(...d));
        const board = Math.max(p.thickness, q.thickness);
        const joint = board > 0 && depth <= board / 2 + 0.05;
        checks.push({ level: joint ? "info" : "warning", code: joint ? "joint" : "overlap", parts: [p.id, q.id], params: { depth } });
      }
      else if (p.group === "doors" && q.group === "doors" && d[1] > 0 && d[2] > -CLEARANCE && d[0] > -CLEARANCE) {
        checks.push({ level: "warning", code: "clearance", parts: [p.id, q.id], params: { gap: round(Math.max(0, -d[0])) } }); // side by side, touching
      }
      else if ((p.group === "drawers") !== (q.group === "drawers")) {
        // A gap, not an intersection. Too little room beside a panel, or almost none above or below the box.
        const other = p.group === "drawers" ? q : p;
        if (other.group === "structure" || other.group === "shelves") {
          const side = d[1] > 0 && d[2] > 0 && d[0] < 0 && d[0] > -DRAWER_GAP;
          const vertical = d[0] > 0 && d[2] > 0 && d[1] < 0 && d[1] > -SHELF_GAP;
          if (side || vertical) checks.push({ level: "warning", code: "drawer", parts: [p.id, q.id], params: { gap: round(-(side ? d[0] : d[1])) } });
        }
      }
      else if ((p.group === "shelves") !== (q.group === "shelves")) {
        const other = p.group === "shelves" ? q : p;
        if (other.group === "structure" && d[1] > 0 && d[2] > 0 && d[0] < 0 && d[0] > -SHELF_GAP) {
          checks.push({ level: "warning", code: "shelf", parts: [p.id, q.id], params: { gap: round(-d[0]) } });
        }
      }
    }
  }
  return checks;
}
