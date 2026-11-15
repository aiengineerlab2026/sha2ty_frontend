import { Box3, BoxGeometry, BufferGeometry, CylinderGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Components a user adds to any model (the editor's gallery): a registry, the geometry made from a size, and where
 * a dropped component goes. Everything here is in the model's own coordinates (y up, +z front); `mpu` converts:
 * metres per model unit along x, y, z (the model is shown at its real size). Sizes are regenerated, never stretched:
 * a resized drawer gets a new box and the same 18 mm boards; a handle keeps its size. */

export type Placement = "in-compartment" | "on-front" | "under";
export type ComponentDef = {
  type: string;
  name: string;
  nameAr: string;
  /** Object types it suits ("*": any); suggested first in the gallery. */
  for: string[];
  placement: Placement;
  /** Default and limits, metres (width × height × depth). */
  size: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  /** Which sizes the user may change (the others follow the space or stay fixed). */
  resizable: [boolean, boolean, boolean];
  /** The board / metal look: "body" takes the model's own material, "metal" brushed steel. */
  material: "body" | "metal";
  /** Moves: a hinged door or a sliding drawer (an animation is made for it). */
  moves?: "hinge" | "slide";
};

const T = 0.018; // board thickness, m
const ANY = ["*"];
const STORAGE = ["wardrobe", "cabinet", "closet", "cupboard", "bookcase", "shelf", "sideboard", "dresser", "desk", "tv", "furniture", "*"];

export const REGISTRY: ComponentDef[] = [
  { type: "shelf", name: "Shelf", nameAr: "رف", for: STORAGE, placement: "in-compartment", size: [0.8, T, 0.5], min: [0.1, 0.012, 0.1], max: [3, 0.05, 1.2], resizable: [false, true, false], material: "body" },
  { type: "divider", name: "Divider", nameAr: "فاصل رأسي", for: STORAGE, placement: "in-compartment", size: [T, 1, 0.5], min: [0.012, 0.1, 0.1], max: [0.05, 3, 1.2], resizable: [true, false, false], material: "body" },
  { type: "drawer", name: "Drawer", nameAr: "درج", for: STORAGE, placement: "in-compartment", size: [0.6, 0.18, 0.45], min: [0.15, 0.08, 0.15], max: [1.5, 0.6, 1], resizable: [false, true, false], material: "body", moves: "slide" },
  { type: "door", name: "Door", nameAr: "باب", for: STORAGE, placement: "in-compartment", size: [0.5, 1.2, T], min: [0.15, 0.15, 0.012], max: [1.2, 2.8, 0.04], resizable: [false, false, false], material: "body", moves: "hinge" },
  { type: "rod", name: "Hanging rail", nameAr: "قضيب تعليق", for: ["wardrobe", "closet", "cabinet", "*"], placement: "in-compartment", size: [0.8, 0.025, 0.025], min: [0.15, 0.015, 0.015], max: [3, 0.04, 0.04], resizable: [false, false, false], material: "metal" },
  { type: "back", name: "Back panel", nameAr: "لوح خلفي", for: STORAGE, placement: "in-compartment", size: [0.8, 1, 0.008], min: [0.1, 0.1, 0.004], max: [3, 3, 0.02], resizable: [false, false, false], material: "body" },
  { type: "handle", name: "Handle", nameAr: "مقبض", for: ANY, placement: "on-front", size: [0.12, 0.014, 0.03], min: [0.03, 0.01, 0.015], max: [0.6, 0.04, 0.06], resizable: [true, false, false], material: "metal" },
  { type: "leg", name: "Leg", nameAr: "رجل", for: ["table", "desk", "sofa", "bed", "chair", "cabinet", "sideboard", "dresser", "tv", "*"], placement: "under", size: [0.04, 0.12, 0.04], min: [0.02, 0.03, 0.02], max: [0.12, 0.8, 0.12], resizable: [true, true, false], material: "body" },
];
export const componentDef = (type: string) => REGISTRY.find((d) => d.type === type);

/** The gallery's order: what suits this object first, then the rest. */
export function suggested(objectType: string | undefined): { fits: ComponentDef[]; more: ComponentDef[] } {
  const kind = (objectType ?? "").toLowerCase();
  const fits = REGISTRY.filter((d) => d.for.some((f) => f !== "*" && kind.includes(f)));
  return fits.length ? { fits, more: REGISTRY.filter((d) => !fits.includes(d)) } : { fits: REGISTRY, more: [] };
}

/** One added component, saved with the model (PartDocument.added). Size and centre in model units. */
export type AddedSpec = {
  id: string; type: string; size: [number, number, number]; center: [number, number, number]; parent?: string | null; hinge?: "left" | "right";
  /** Turned about the vertical axis in quarter turns (degrees); `size` is always along the model's own x, y, z. */
  rotation?: 0 | 90 | 180 | 270;
  /** The compartment it was fitted into (model units, min and max corners): its size never exceeds it. */
  space?: [[number, number, number], [number, number, number]];
};

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new BoxGeometry(w, h, d).translate(x, y, z);

/** The component's geometry at `size` (model units), centred on the origin. Board thickness and handle sizes are real
 * millimetres whatever the size (`mpu`). */
export function buildGeometry(spec: Pick<AddedSpec, "type" | "size" | "hinge" | "rotation">, mpu: Vector3): BufferGeometry {
  const quarter = (spec.rotation ?? 0) % 180 === 90;
  if (spec.type === "handle") {
    // On its part's face: turned about the face's normal (z), so a level bar stands upright.
    const g = buildUpright({ ...spec, size: quarter ? [spec.size[1], spec.size[0], spec.size[2]] : spec.size }, quarter ? new Vector3(mpu.y, mpu.x, mpu.z) : mpu);
    return spec.rotation ? g.rotateZ(((spec.rotation ?? 0) * Math.PI) / 180) : g;
  }
  const g = buildUpright({ ...spec, size: quarter ? [spec.size[2], spec.size[1], spec.size[0]] : spec.size }, quarter ? new Vector3(mpu.z, mpu.y, mpu.x) : mpu);
  return spec.rotation ? g.rotateY(((spec.rotation ?? 0) * Math.PI) / 180) : g;
}

function buildUpright(spec: Pick<AddedSpec, "type" | "size" | "hinge">, mpu: Vector3): BufferGeometry {
  const [w, h, d] = spec.size;
  const t = (axis: "x" | "y" | "z") => T / mpu[axis];
  switch (spec.type) {
    case "rod":
      return new CylinderGeometry(h / 2, h / 2, w, 20).rotateZ(Math.PI / 2);
    case "leg":
      return new CylinderGeometry(w / 2, w / 2 * 0.85, h, 20);
    case "handle": {
      const bar = box(w, h, h, 0, 0, d - h / 2 - d / 2);
      const posts = [-1, 1].map((s) => box(h, h, d - h, s * (w / 2 - h / 2), 0, -h / 2));
      return mergeGeometries([bar, ...posts])!;
    }
    case "drawer": {
      // A hollow drawer: its front, two sides, a back and a bottom (open at the top).
      const tx = t("x"), ty = t("y"), tz = t("z");
      return mergeGeometries([
        box(w, h, tz, 0, 0, d / 2 - tz / 2),
        box(tx, h * 0.85, d - tz, -w / 2 + tx / 2, -h * 0.075, -tz / 2),
        box(tx, h * 0.85, d - tz, w / 2 - tx / 2, -h * 0.075, -tz / 2),
        box(w - 2 * tx, h * 0.85, tz, 0, -h * 0.075, -d / 2 + tz / 2),
        box(w - 2 * tx, ty, d - 2 * tz, 0, -h / 2 + ty / 2, 0),
        box(0.1 / mpu.x, 0.012 / mpu.y, 0.025 / mpu.z, 0, h * 0.25, d / 2 + 0.0125 / mpu.z), // its pull
      ])!;
    }
    case "door": {
      // The leaf and a knob near the side away from the hinge.
      const side = spec.hinge === "right" ? -1 : 1;
      const knob = new CylinderGeometry(0.012 / mpu.x, 0.012 / mpu.x, 0.025 / mpu.z, 16).rotateX(Math.PI / 2).translate(side * (w / 2 - 0.05 / mpu.x), 0, d / 2 + 0.0125 / mpu.z);
      return mergeGeometries([box(w, h, d, 0, 0, 0), knob])!;
    }
    default:
      return box(w, h, d, 0, 0, 0);
  }
}

/** A ray against the model's real geometry (model units): the distance to the first surface and the part hit. */
export type Probe = (origin: Vector3, direction: Vector3) => { distance: number; partId: string | null } | null;
export type Hit = { point: Vector3; normal: Vector3; partId: string | null };
export type Fit = { valid: boolean; reason?: string; size: [number, number, number]; center: [number, number, number]; space?: Box3; parent?: string | null };

/** What placement needs to know about the model besides rays (all in model units, at rest: doors closed):
 * `front`: where the opening at x0..x1, y0..y1 ends (the back of the closed door / drawer front over it, else the
 * structure's own front; null: unknown, nothing is placed); `sweeps`: every moving part's space from closed to fully
 * open (a new part must stay out of it). */
export type Surroundings = {
  front: (x0: number, x1: number, y0: number, y1: number, from: number) => { z: number; part: string | null } | null;
  sweeps: { label: string; boxes: Box3[]; component?: string }[];
};

const DIRS = { left: new Vector3(-1, 0, 0), right: new Vector3(1, 0, 0), down: new Vector3(0, -1, 0), up: new Vector3(0, 1, 0), back: new Vector3(0, 0, -1), front: new Vector3(0, 0, 1) };

/** The empty space around a point, bounded by the real STRUCTURE the rays meet (walls, shelves, floor, back: `probe`
 * sees no door or drawer, open or closed). The front ends at the closed fronts' back face, or the structure's front
 * when the compartment is open (`around.front`). Null when it is not enclosed or its front is unknown. */
export function compartmentAt(origin: Vector3, probe: Probe, around: Pick<Surroundings, "front">): { space: Box3; front: string | null } | null {
  const reach = (dir: Vector3) => probe(origin, dir);
  const l = reach(DIRS.left), r = reach(DIRS.right), dn = reach(DIRS.down), up = reach(DIRS.up), bk = reach(DIRS.back), fr = reach(DIRS.front);
  if (!l || !r || !dn || !up || !bk) return null;
  const x0 = origin.x - l.distance, x1 = origin.x + r.distance, y0 = origin.y - dn.distance, y1 = origin.y + up.distance;
  const limit = around.front(x0, x1, y0, y1, origin.z);
  const rayFront = fr ? origin.z + fr.distance : Infinity;
  const front = Math.min(rayFront, limit?.z ?? Infinity);
  if (!Number.isFinite(front)) return null;
  // What closes it at the front: a door / drawer over the opening, or structure the ray met (null: open).
  const closedBy = limit && limit.part && limit.z <= rayFront ? limit.part : rayFront < (limit?.z ?? Infinity) ? fr!.partId : null;
  return { space: new Box3(new Vector3(x0, y0, origin.z - bk.distance), new Vector3(x1, y1, front)), front: closedBy };
}

/** Is the box free of geometry (rays through it along x, y and z, a 3 × 3 grid each, stopping short of its faces)?
 * Returns the part in the way, else null. Exact for boards and panels; touching faces do not count. */
export function blocker(b: Box3, probe: Probe): string | null {
  const s = b.getSize(new Vector3());
  const eps = Math.max(1e-4, 0.002 * Math.max(s.x, s.y, s.z));
  for (const axis of [0, 1, 2] as const) {
    const [u, v] = [0, 1, 2].filter((k) => k !== axis);
    const length = s.getComponent(axis) - 2 * eps;
    if (length <= 0) continue;
    const dir = new Vector3().setComponent(axis, 1);
    for (const fu of [0.15, 0.5, 0.85]) for (const fv of [0.15, 0.5, 0.85]) {
      const o = new Vector3().setComponent(axis, b.min.getComponent(axis) + eps);
      o.setComponent(u, b.min.getComponent(u) + fu * s.getComponent(u)).setComponent(v, b.min.getComponent(v) + fv * s.getComponent(v));
      const hit = probe(o, dir);
      if (hit && hit.distance < length) return hit.partId ?? "a part";
    }
  }
  return null;
}

const cm = (v: number) => Math.round(v * 100) / 100;

/** Where a dropped component goes and how big it is (see the file comment). `hit`: the surface under the pointer;
 * `mpu`: metres per model unit. Clearances: 2 mm at the sides of boards, 1 cm behind doors, drawers' 1 cm gaps. */
export function fit(def: ComponentDef, hit: Hit, probe: Probe, around: Surroundings, mpu: Vector3, current?: [number, number, number]): Fit {
  const m = (metres: number, axis: "x" | "y" | "z") => metres / mpu[axis];
  const none = (reason: string): Fit => ({ valid: false, reason, size: [m(def.size[0], "x"), m(def.size[1], "y"), m(def.size[2], "z")], center: hit.point.toArray() as [number, number, number] });
  const own = current ?? null;
  if (def.placement === "on-front") {
    if (hit.normal.z < 0.6 || !hit.partId) return none("Drop it on the front of a door, drawer or panel.");
    const size: [number, number, number] = own ?? [m(def.size[0], "x"), m(def.size[1], "y"), m(def.size[2], "z")];
    return { valid: true, size, center: [hit.point.x, hit.point.y, hit.point.z + size[2] / 2], parent: hit.partId };
  }
  if (def.placement === "under") {
    if (hit.normal.y > -0.6 || !hit.partId) return none("Drop it on the underside of the object.");
    const size: [number, number, number] = own ?? [m(def.size[0], "x"), m(def.size[1], "y"), m(def.size[2], "z")];
    return { valid: true, size, center: [hit.point.x, hit.point.y - size[1] / 2, hit.point.z], parent: hit.partId };
  }
  // In a compartment: step off the surface into the space in front of it, then measure the space.
  const origin = hit.point.clone().addScaledVector(hit.normal, m(0.01, "z"));
  const found = compartmentAt(origin, probe, around);
  if (!found) return none("Drop it inside a compartment of the object (its space could not be measured here).");
  const s = found.space;
  const W = s.max.x - s.min.x, H = s.max.y - s.min.y, D = s.max.z - s.min.z;
  const gapX = m(0.002, "x"), gapZ = m(0.01, "z");
  const cx = (s.min.x + s.max.x) / 2;
  let size: [number, number, number];
  let center: [number, number, number];
  switch (def.type) {
    case "shelf": {
      const ty = own?.[1] ?? m(T, "y");
      size = [W - 2 * gapX, ty, D - gapZ];
      center = [cx, Math.min(Math.max(origin.y, s.min.y + ty / 2), s.max.y - ty / 2), s.min.z + size[2] / 2];
      break;
    }
    case "divider": {
      const tx = own?.[0] ?? m(T, "x");
      size = [tx, H, D - gapZ];
      center = [Math.min(Math.max(origin.x, s.min.x + tx / 2), s.max.x - tx / 2), (s.min.y + s.max.y) / 2, s.min.z + size[2] / 2];
      break;
    }
    case "rod": {
      const dia = m(0.025, "y");
      size = [W, dia, dia];
      center = [cx, s.max.y - m(0.06, "y"), (s.min.z + s.max.z) / 2];
      break;
    }
    case "drawer": {
      const h = Math.min(own?.[1] ?? m(def.size[1], "y"), H);
      size = [W - 2 * m(0.006, "x"), h, Math.min(D - gapZ, m(def.max[2], "z"))];
      center = [cx, s.min.y + h / 2, s.max.z - size[2] / 2]; // on the compartment floor (or on the drawer below), flush at the front
      break;
    }
    case "door": {
      if (found.front) return none("This opening already has a front.");
      size = [W, H, m(T, "z")];
      center = [cx, (s.min.y + s.max.y) / 2, s.max.z + size[2] / 2];
      break;
    }
    case "back": {
      const tz = m(0.008, "z");
      size = [W, H, tz];
      center = [cx, (s.min.y + s.max.y) / 2, s.min.z + tz / 2];
      break;
    }
    default:
      return none("This component cannot go here.");
  }
  size = size.map((v) => Math.max(v, 1e-4)) as [number, number, number];
  const real = [size[0] * mpu.x, size[1] * mpu.y, size[2] * mpu.z];
  const small = real.findIndex((v, i) => v < def.min[i] - 1e-6);
  if (small >= 0) return { valid: false, reason: `Too little space here (${["width", "height", "depth"][small]} ${cm(real[small])} m).`, size, center, space: s };
  const big = real.findIndex((v, i) => v > def.max[i] + 1e-6);
  if (big >= 0) return { valid: false, reason: `The space is larger than a ${def.name.toLowerCase()} can be.`, size, center, space: s };
  // Nothing in the way: no structure inside it (rays through it), no door or drawer swinging or sliding through it.
  const placed = specBox({ size, center });
  if (def.type !== "door") {
    const inside = blocker(placed, probe);
    if (inside) return { valid: false, reason: "Something is already in this space.", size, center, space: s };
  }
  const shrunk = placed.clone().expandByScalar(-Math.max(1e-4, 0.002 * Math.min(...size)));
  const hitBy = around.sweeps.find((m) => m.boxes.some((b) => b.intersectsBox(shrunk)));
  if (hitBy) return { valid: false, reason: `It would be in the way of ${hitBy.label} when it opens.`, size, center, space: s };
  return { valid: true, size, center, space: s, parent: null };
}

/** The box a component takes (model units). */
export const specBox = (spec: Pick<AddedSpec, "size" | "center">) =>
  new Box3().setFromCenterAndSize(new Vector3(...spec.center), new Vector3(...spec.size));

/** A size change by dragging one face of a component: the opposite face stays put, the length stays within the
 * component's limits and inside `room` (its compartment, measured without the component itself), and `check` (the
 * structure inside it, other parts, doors and drawers through their movement) has the last word: a blocked drag stops
 * at the last free place (found by halving). `face`: where the dragged face is asked to be (model units). */
export function resizeTo(
  spec: AddedSpec, axis: 0 | 1 | 2, side: 1 | -1, face: number, def: ComponentDef, mpu: Vector3, room: Box3 | null, check: (box: Box3) => string | null,
): { spec: AddedSpec; blocked: string | null } {
  const box = specBox(spec);
  const k = ["x", "y", "z"][axis] as "x" | "y" | "z";
  const fixed = side > 0 ? box.min.getComponent(axis) : box.max.getComponent(axis);
  const was = side > 0 ? box.max.getComponent(axis) : box.min.getComponent(axis);
  let want = face;
  let blocked: string | null = null;
  if (room) {
    const limit = side > 0 ? room.max.getComponent(axis) : room.min.getComponent(axis);
    if (side * (want - limit) > 0) {
      want = limit;
      blocked = "It reaches the compartment's wall.";
    }
  }
  const lo = def.min[axis] / mpu[k], hi = def.max[axis] / mpu[k];
  const length = Math.min(Math.max(Math.abs(want - fixed), lo), hi);
  const at = (f: number): AddedSpec => {
    const size = [...spec.size] as [number, number, number];
    const center = [...spec.center] as [number, number, number];
    size[axis] = Math.abs(f - fixed);
    center[axis] = (f + fixed) / 2;
    return { ...spec, size, center };
  };
  let target = fixed + side * length;
  const why = check(specBox(at(target)));
  if (why) {
    // The furthest free place between where the face was and where it was asked to go.
    let good = was, bad = target;
    for (let i = 0; i < 12; i++) {
      const mid = (good + bad) / 2;
      if (check(specBox(at(mid)))) bad = mid;
      else good = mid;
    }
    target = good;
    blocked = why;
  }
  return { spec: at(target), blocked };
}

/** Parts put on a resized part (handles on a door) keep their place on it: proportionally across its face, at the
 * same distance from its front. */
export function carryChildren(specs: AddedSpec[], before: AddedSpec, after: AddedSpec): AddedSpec[] {
  const a = specBox(before), b = specBox(after);
  const sa = a.getSize(new Vector3()), sb = b.getSize(new Vector3());
  return specs.map((s) => {
    if (s.parent !== before.id) return s;
    const c = s.center;
    const along = (i: 0 | 1) => b.min.getComponent(i) + ((c[i] - a.min.getComponent(i)) / Math.max(sa.getComponent(i), 1e-9)) * sb.getComponent(i);
    return { ...s, center: [along(0), along(1), c[2] + (b.max.z - a.max.z)] };
  });
}

// ---- offsets: where a component sits in its compartment ----

export type Side = "top" | "bottom" | "left" | "right" | "front" | "back";
export const SIDES: Record<Side, [0 | 1 | 2, 1 | -1]> = { top: [1, 1], bottom: [1, -1], right: [0, 1], left: [0, -1], front: [2, 1], back: [2, -1] };

/** The axis a component is measured and moved along in its compartment: across for upright boards (a divider moves
 * left / right), up and down for everything else (a shelf's Top Offset). */
export const offsetAxis = (type: string): 0 | 1 => (type === "divider" ? 0 : 1);

/** Distances from each face of the component to the compartment's inside faces (model units). */
export function offsetsOf(spec: Pick<AddedSpec, "size" | "center">, room: Box3): Record<Side, number> {
  const b = specBox(spec);
  return {
    top: room.max.y - b.max.y, bottom: b.min.y - room.min.y,
    right: room.max.x - b.max.x, left: b.min.x - room.min.x,
    front: room.max.z - b.max.z, back: b.min.z - room.min.z,
  };
}

/** Moves a component along one axis to `center` (its size unchanged): kept inside `room`, and a move into something
 * stops at the last free place (`check`, as for resizing). */
export function moveTo(spec: AddedSpec, axis: 0 | 1 | 2, center: number, room: Box3 | null, check: (box: Box3) => string | null): { spec: AddedSpec; blocked: string | null } {
  const half = spec.size[axis] / 2;
  let want = center;
  let blocked: string | null = null;
  if (room) {
    const lo = room.min.getComponent(axis) + half, hi = room.max.getComponent(axis) - half;
    const kept = lo > hi ? (lo + hi) / 2 : Math.min(Math.max(want, lo), hi);
    if (Math.abs(kept - want) > 1e-9) blocked = "It reaches the compartment's wall.";
    want = kept;
  }
  const at = (c: number): AddedSpec => {
    const next = [...spec.center] as [number, number, number];
    next[axis] = c;
    return { ...spec, center: next };
  };
  const why = check(specBox(at(want)));
  if (!why) return { spec: at(want), blocked };
  let good = spec.center[axis], bad = want;
  for (let i = 0; i < 12; i++) {
    const mid = (good + bad) / 2;
    if (check(specBox(at(mid)))) bad = mid;
    else good = mid;
  }
  return { spec: at(good), blocked: why };
}

/** Puts the component at an exact offset from one inside face of its compartment ("Top Offset 50 cm"). */
export function withOffset(spec: AddedSpec, side: Side, value: number, room: Box3, check: (box: Box3) => string | null): { spec: AddedSpec; blocked: string | null } {
  const [axis, sign] = SIDES[side];
  const half = spec.size[axis] / 2;
  const center = sign > 0 ? room.max.getComponent(axis) - value - half : room.min.getComponent(axis) + value + half;
  return moveTo(spec, axis, center, room, check);
}

// ---- which part a click selects ----

/** One surface under the pointer, nearest first: the part it belongs to and what kind of part it is. */
export type PointerHit = { id: string; distance: number; added: boolean; open: boolean; visible: boolean };

/** The part a click selects among everything under the pointer (nearest first). Hidden parts never count; a door or
 * drawer standing open does not hide what is behind it from a click (a shelf in the opened compartment); at the same
 * depth (a shelf flush against a wall, within `tolerance`) an added part wins over the model's own geometry. */
export function choosePart(hits: PointerHit[], tolerance: number): string | null {
  const seen = hits.filter((h) => h.visible);
  if (!seen.length) return null;
  // Through the open fronts to the first solid surface: an added part there (a shelf in the opened compartment) wins
  // over the open door in front of it; with only structure behind, the door itself (it may be painted too).
  const solid = seen.findIndex((h) => !h.open);
  const addedBehind = seen.slice(0, solid >= 0 ? solid + 1 : seen.length).find((h) => h.added && !h.open);
  if (seen[0].open && addedBehind) return addedBehind.id;
  const near = seen.filter((h) => h.distance - seen[0].distance <= tolerance);
  return (near.find((h) => h.added) ?? seen[0]).id;
}
