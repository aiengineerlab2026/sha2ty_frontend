import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshPhysicalMaterial, Shape, SphereGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PartDocument } from "./parts";

/** Admin "Generate furniture": GPT Sol's design (backend services/furniture_design.py) built as a modular model, one
 * named mesh per part in the order below (the part list matches meshes by order). Metres, y up, the front is +z. */
export type FurnitureKind = "bed" | "sofa" | "chair" | "dining_table";
export type MaterialKind = "fabric" | "velvet" | "leather" | "boucle" | "wood" | "metal" | "brass" | "marble" | "lacquer";
export type FurnitureSpec = {
  kind: FurnitureKind;
  title: string;
  description: string;
  style: string;
  width_m: number;
  depth_m: number;
  height_m: number;
  leg_shape: "square" | "round" | "tapered" | "splayed";
  leg_height_m: number;
  leg_thickness_m: number;
  back_shape: "straight" | "rounded" | "curved";
  back_height_m: number;
  seat_height_m: number;
  top_shape: "rectangle" | "rounded" | "oval";
  top_thickness_m: number;
  arms: "square" | "rounded" | "none";
  cushions: number;
  tufted: boolean;
  /** Vertical channel tufting on upholstered backs and headboards (wins over buttons). */
  channels?: boolean;
  /** Beds: "box" is an upholstered base down to short hidden legs; "frame" a raised frame on legs. */
  bed_base?: "frame" | "box";
  looks: Record<string, { color: string; material: MaterialKind }>;
};

export const PARTS: Record<FurnitureKind, string[]> = {
  bed: ["Headboard", "Mattress", "Legs", "Sides", "Headboard Upholstery"],
  dining_table: ["Table Head", "Legs"],
  chair: ["Chair Base", "Legs", "Chair Back"],
  sofa: ["Sofa Base", "Sofa Legs", "Sofa Back", "Sofa Back Upholstery"],
};

/** How each material catches light (glTF PBR + sheen / clearcoat, kept by the exported file and the viewer). */
const FINISH: Record<MaterialKind, { roughness: number; metalness: number; sheen?: number; clearcoat?: number }> = {
  fabric: { roughness: 0.92, metalness: 0, sheen: 0.4 }, velvet: { roughness: 0.75, metalness: 0, sheen: 1 },
  leather: { roughness: 0.5, metalness: 0, clearcoat: 0.25 }, boucle: { roughness: 1, metalness: 0, sheen: 0.6 },
  wood: { roughness: 0.55, metalness: 0, clearcoat: 0.15 }, metal: { roughness: 0.35, metalness: 0.85 }, brass: { roughness: 0.3, metalness: 1 },
  marble: { roughness: 0.12, metalness: 0, clearcoat: 0.8 }, lacquer: { roughness: 0.2, metalness: 0, clearcoat: 1 },
};

const clamp = (v: number | undefined, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v!)) : fallback);
const merge = (list: BufferGeometry[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!; // RoundedBox has no index

/** A rounded box centred on (x, y, z). */
function box(w: number, h: number, d: number, x: number, y: number, z: number, r = 0.01) {
  return new RoundedBoxGeometry(w, h, d, 3, Math.max(0.001, Math.min(r, Math.min(w, h, d) / 2 - 0.001))).translate(x, y, z);
}

/** Legs standing on the floor at each (x, z); splayed ones lean outwards. */
function legs(shape: FurnitureSpec["leg_shape"], h: number, t: number, spots: [number, number][]) {
  return merge(spots.map(([x, z]) => {
    const g = shape === "square" ? new BoxGeometry(t, h, t) : new CylinderGeometry(t / 2, shape === "round" ? t / 2 : t * 0.3, h, 20);
    if (shape === "splayed") g.rotateZ(Math.sign(x) * 0.12).rotateX(-Math.sign(z) * 0.12);
    return g.translate(x, h / 2, z);
  }));
}

const corners = (x: number, z: number): [number, number][] => [[-x, -z], [x, -z], [-x, z], [x, z]];

/** Shapes a back or headboard: "rounded" arches its top, "curved" bows its sides forward. */
function shaped(g: BufferGeometry, shape: FurnitureSpec["back_shape"], halfW: number) {
  if (shape === "straight") return g;
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const across = (p.getX(i) / halfW) ** 2;
    if (shape === "rounded") p.setY(i, p.getY(i) - 0.35 * (max.y - min.y) * across * ((p.getY(i) - min.y) / (max.y - min.y)) ** 2);
    else p.setZ(i, p.getZ(i) + 0.08 * halfW * across);
  }
  g.computeVertexNormals();
  return g;
}

/** Leans a back by `angle` (radians, backwards) about its bottom edge. */
function leaned(g: BufferGeometry, angle: number) {
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const [y, z] = [min.y, (min.z + max.z) / 2]; // copies: translate() updates the box in place
  return g.translate(0, -y, -z).rotateX(-angle).translate(0, y, z);
}

/** An upholstered panel centred on x between y0 and y1 at z: plain, or in vertical channels (a padded tube each). */
function panel(w: number, y0: number, y1: number, x: number, z: number, d: number, channels?: boolean) {
  if (!channels) return box(w, y1 - y0, d, x, (y0 + y1) / 2, z, Math.min(0.03, d / 2));
  const n = Math.max(3, Math.round(w / 0.17)), cw = w / n;
  return merge(Array.from({ length: n }, (_, i) => box(cw - 0.004, y1 - y0, d, x - w / 2 + cw * (i + 0.5), (y0 + y1) / 2, z, Math.min(cw, d) * 0.45)));
}

/** Buttons on a tufted panel's front face (z), in a grid. */
function tufts(w: number, x0: number, y0: number, y1: number, z: number) {
  const cols = Math.max(2, Math.round(w / 0.25)), rows = Math.max(1, Math.round((y1 - y0) / 0.2));
  const list: BufferGeometry[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    list.push(new SphereGeometry(0.012, 8, 6).translate(x0 - w / 2 + (w * (c + 0.5)) / cols, y0 + ((y1 - y0) * (r + 0.5)) / rows, z));
  }
  return list;
}

function bed(s: FurnitureSpec) {
  const W = s.width_m, D = s.depth_m, boxBase = s.bed_base === "box";
  // A box base: tall upholstered sides on short hidden legs. A frame: rails on visible legs.
  const legH = boxBase ? 0.04 : clamp(s.leg_height_m, 0.06, 0.25, 0.12), t = clamp(s.leg_thickness_m, 0.03, 0.08, 0.05);
  const hbT = 0.08, railH = boxBase ? 0.3 : 0.2, railT = boxBase ? 0.08 : 0.05, frameTop = legH + railH, z0 = -D / 2 + hbT, len = D - hbT;
  const mattressTop = frameTop + 0.16;
  const H = Math.max(s.height_m, mattressTop + 0.4);
  const hbW = W + (boxBase ? 0.14 : 0.06); // modern upholstered beds have a headboard a little wider than the base
  const upTop = H - (s.channels ? 0.04 : 0.07), upBottom = mattressTop - 0.1, upW = hbW - (s.channels ? 0.06 : 0.22);
  let upholstery = shaped(panel(upW, upBottom, upTop, 0, z0 + 0.035, 0.07, s.channels), s.back_shape, upW / 2);
  if (s.tufted && !s.channels && s.back_shape === "straight") upholstery = merge([upholstery, ...tufts(upW, 0, upBottom + 0.12, upTop, z0 + 0.07)]);
  // The mattress, dressed with pillows against the headboard (part of the mattress: they go with the bedding).
  const pillows = W < 1.4 ? 1 : 2, pw = Math.min(0.7, (W - 0.2) / pillows - 0.04);
  const bedding = Array.from({ length: pillows }, (_, i) =>
    leaned(box(pw, 0.14, 0.42, -((pillows - 1) * (pw + 0.04)) / 2 + i * (pw + 0.04), mattressTop + 0.12, z0 + 0.12, 0.06), 0.9));
  return {
    Headboard: shaped(box(hbW, H, hbT, 0, H / 2, -D / 2 + hbT / 2, 0.02), s.back_shape, hbW / 2),
    Mattress: merge([box(W - 2 * railT - 0.01, 0.24, len - 2 * railT - 0.01, 0, frameTop - 0.08 + 0.12, z0 + len / 2, 0.07), ...bedding]),
    Legs: legs(s.leg_shape, legH, t, corners(W / 2 - t / 2 - (boxBase ? 0.06 : 0.01), len / 2 - t / 2 - (boxBase ? 0.06 : 0.01)).map(([x, z]) => [x, z + z0 + len / 2])),
    Sides: merge([
      box(railT, railH, len, -W / 2 + railT / 2, legH + railH / 2, z0 + len / 2, boxBase ? 0.03 : 0.01),
      box(railT, railH, len, W / 2 - railT / 2, legH + railH / 2, z0 + len / 2, boxBase ? 0.03 : 0.01),
      box(W - 2 * railT, railH, railT, 0, legH + railH / 2, D / 2 - railT / 2, boxBase ? 0.03 : 0.01),
      box(W - 2 * railT, railH, railT, 0, legH + railH / 2, z0 + railT / 2, boxBase ? 0.03 : 0.01),
    ]),
    "Headboard Upholstery": upholstery,
  };
}

function diningTable(s: FurnitureSpec) {
  const W = s.width_m, D = s.depth_m, tt = clamp(s.top_thickness_m, 0.02, 0.07, 0.04), legH = s.height_m - tt;
  const t = clamp(s.leg_thickness_m, 0.035, 0.09, 0.06);
  const shape = new Shape();
  if (s.top_shape === "oval") shape.absellipse(0, 0, W / 2, D / 2, 0, Math.PI * 2, false, 0);
  else {
    const r = s.top_shape === "rounded" ? Math.min(W, D) * 0.12 : 0.01, x = W / 2, y = D / 2;
    shape.moveTo(-x + r, -y).lineTo(x - r, -y).quadraticCurveTo(x, -y, x, -y + r).lineTo(x, y - r).quadraticCurveTo(x, y, x - r, y)
      .lineTo(-x + r, y).quadraticCurveTo(-x, y, -x, y - r).lineTo(-x, -y + r).quadraticCurveTo(-x, -y, -x + r, -y);
  }
  const top = new ExtrudeGeometry(shape, { depth: tt - 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 48 });
  top.clearGroups(); // one material
  top.rotateX(-Math.PI / 2).translate(0, legH + 0.004, 0);
  const [x, z] = s.top_shape === "oval" ? [W * 0.3, D * 0.27] : [W / 2 - 0.1, D / 2 - 0.1];
  return { "Table Head": top, Legs: legs(s.leg_shape, legH, t, corners(x, z)) };
}

function chair(s: FurnitureSpec) {
  const W = s.width_m, D = s.depth_m, seatH = clamp(s.seat_height_m, 0.42, 0.5, 0.46), st = 0.06;
  const t = clamp(s.leg_thickness_m, 0.025, 0.05, 0.035), seatTop = seatH + 0.04;
  const H = Math.max(s.height_m, seatTop + 0.3), backH = H - seatTop, bt = 0.045, z = -D / 2 + bt / 2;
  let back = shaped(s.channels ? panel(W - 0.02, seatTop, H, 0, z, bt, true) : box(W - 0.02, backH, bt, 0, seatTop + backH / 2, z, 0.02), s.back_shape, W / 2);
  if (s.tufted && !s.channels && s.back_shape === "straight") back = merge([back, ...tufts(W - 0.1, 0, seatTop + 0.1, H - 0.05, z + bt / 2)]);
  return {
    "Chair Base": merge([box(W, st, D, 0, seatH - st / 2, 0, 0.015), box(W - 0.02, 0.04, D - 0.04, 0, seatH + 0.02, 0.01, 0.018)]),
    Legs: legs(s.leg_shape, seatH - st, t, corners(W / 2 - t / 2 - 0.015, D / 2 - t / 2 - 0.015)),
    "Chair Back": leaned(back, 0.12),
  };
}

function sofa(s: FurnitureSpec) {
  const W = s.width_m, D = s.depth_m;
  const legH = clamp(s.leg_height_m, 0.04, 0.16, 0.1), seatH = clamp(s.seat_height_m, 0.4, 0.48, 0.44);
  const t = clamp(s.leg_thickness_m, 0.03, 0.07, 0.045), H = Math.max(s.height_m, seatH + 0.3);
  const armW = s.arms === "none" ? 0 : 0.17, armH = Math.min(seatH + 0.2, H - 0.08), innerW = W - 2 * armW;
  const backT = 0.18, cushT = 0.16, n = Math.round(clamp(s.cushions, 1, 4, 3)), cw = innerW / n;
  const seatBack = -D / 2 + backT + cushT, seatZ = (D / 2 + seatBack) / 2;
  const base = [box(W, seatH - 0.14 - legH, D, 0, (legH + seatH - 0.14) / 2, 0, 0.02)];
  if (armW) for (const side of [-1, 1]) base.push(box(armW, armH - legH, D, side * (W / 2 - armW / 2), (legH + armH) / 2, 0, s.arms === "rounded" ? 0.07 : 0.02));
  const back: BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const x = -innerW / 2 + cw * (i + 0.5);
    base.push(box(cw - 0.01, 0.14, D / 2 - seatBack, x, seatH - 0.07, seatZ, 0.05));
    const top = H - 0.05;
    back.push(s.channels ? panel(cw - 0.01, seatH, top, x, -D / 2 + backT + cushT / 2, cushT, true) : box(cw - 0.01, top - seatH, cushT, x, (top + seatH) / 2, -D / 2 + backT + cushT / 2, 0.06));
    if (s.tufted && !s.channels) back.push(...tufts(cw - 0.12, x, seatH + 0.08, top - 0.04, -D / 2 + backT + cushT));
  }
  return {
    "Sofa Base": merge(base),
    "Sofa Legs": legs(s.leg_shape, legH, t, corners(W / 2 - 0.06, D / 2 - 0.06)),
    "Sofa Back": shaped(box(W, H - legH, backT, 0, (legH + H) / 2, -D / 2 + backT / 2, 0.03), s.back_shape, W / 2),
    "Sofa Back Upholstery": leaned(merge(back), 0.1),
  };
}

const BUILD: Record<FurnitureKind, (s: FurnitureSpec) => Record<string, BufferGeometry>> = { bed, dining_table: diningTable, chair, sofa };

export const partId = (name: string) => name.toLowerCase().replace(/\s+/g, "_");

/** The model: one mesh per part, named, in PARTS order, each with its own material (its look from the design). */
export function buildFurniture(spec: FurnitureSpec): Group {
  const geometries = BUILD[spec.kind](spec);
  const group = new Group();
  group.name = spec.kind;
  for (const name of PARTS[spec.kind]) {
    const look = spec.looks[name] ?? { color: "#8a7f72", material: "fabric" };
    const { sheen = 0, clearcoat = 0, ...pbr } = FINISH[look.material] ?? FINISH.fabric;
    const color = new Color(look.color);
    const material = new MeshPhysicalMaterial({ name, color, ...pbr, sheen, sheenColor: color.clone().lerp(new Color("#ffffff"), 0.4), sheenRoughness: 0.6, clearcoat, clearcoatRoughness: 0.2 });
    const mesh = new Mesh(geometries[name], material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = partId(name);
    group.add(mesh);
  }
  return group;
}

/** The part list saved with the model (ids = mesh names; vendor-named, so the names are kept as they are). */
export function furnitureParts(kind: FurnitureKind): PartDocument {
  return { modelType: kind, separated: true, components: PARTS[kind].map((name) => ({ id: partId(name), name, editable: true, naming: "vendor" })) };
}

const LEGS = ["square", "round", "tapered", "splayed"] as const;
const BACKS = ["straight", "rounded", "curved"] as const;
const TOPS = ["rectangle", "rounded", "oval"] as const;
const cap = (word: string) => word[0].toUpperCase() + word.slice(1);
const MAX_VARIANTS = 3;

/** Other shapes offered to customers for each part, as designs that differ only where that part changes: built and
 * cut out with partOf(). Parts without a shape choice get another finish (a look from the same design). */
export function partOptions(spec: FurnitureSpec): Record<string, { name: string; spec: FurnitureSpec }[]> {
  const other = <T extends string>(all: readonly T[], now: T) => all.filter((v) => v !== now);
  const legs = other(LEGS, spec.leg_shape).map((leg_shape) => ({ name: `${cap(leg_shape)} legs`, spec: { ...spec, leg_shape } }));
  const backs = (part: string) => other(BACKS, spec.back_shape).map((back_shape) => ({ name: `${cap(back_shape)} ${part.toLowerCase()}`, spec: { ...spec, back_shape } }));
  // The other upholstery styles: plain, button-tufted, channel-tufted.
  const now = spec.channels ? "channels" : spec.tufted ? "buttons" : "plain";
  const STYLE = { plain: ["Plain", { tufted: false, channels: false }], buttons: ["Button-tufted", { tufted: true, channels: false }], channels: ["Channel-tufted", { tufted: false, channels: true }] } as const;
  const tufting = (part: string) => (Object.keys(STYLE) as (keyof typeof STYLE)[]).filter((k) => k !== now)
    .map((k) => ({ name: `${STYLE[k][0]} ${part.toLowerCase()}`, spec: { ...spec, ...STYLE[k][1], back_shape: "straight" as const } }));
  // ponytail: a finish variant reuses another part's look from the same design; add a palette when more are wanted.
  const finish = (part: string, from: string, label: string) => [{ name: label, spec: { ...spec, looks: { ...spec.looks, [part]: spec.looks[from] ?? spec.looks[part] } } }];
  const options: Record<FurnitureKind, Record<string, { name: string; spec: FurnitureSpec }[]>> = {
    bed: {
      Headboard: backs("Headboard"),
      Mattress: [{ name: "Ivory mattress", spec: { ...spec, looks: { ...spec.looks, Mattress: { color: "#f1ede4", material: "fabric" } } } }],
      Legs: legs,
      Sides: finish("Sides", "Headboard Upholstery", "Upholstered sides"),
      "Headboard Upholstery": [...backs("Upholstery"), ...tufting("Upholstery")],
    },
    dining_table: {
      "Table Head": other(TOPS, spec.top_shape).map((top_shape) => ({ name: `${cap(top_shape)} top`, spec: { ...spec, top_shape } })),
      Legs: legs,
    },
    chair: {
      "Chair Base": finish("Chair Base", "Legs", "Wooden seat"),
      Legs: legs,
      "Chair Back": [...backs("Back"), ...tufting("Back")],
    },
    sofa: {
      "Sofa Base": [
        ...other(["square", "rounded", "none"] as const, spec.arms).map((arms) => ({ name: arms === "none" ? "No arms" : `${cap(arms)} arms`, spec: { ...spec, arms } })),
        ...[2, 3, 4].filter((n) => n !== Math.round(spec.cushions)).map((cushions) => ({ name: `${cushions} seat cushions`, spec: { ...spec, cushions } })),
      ],
      "Sofa Legs": legs,
      "Sofa Back": backs("Back"),
      "Sofa Back Upholstery": [...tufting("Cushions"), ...[2, 3, 4].filter((n) => n !== Math.round(spec.cushions)).map((cushions) => ({ name: `${cushions} back cushions`, spec: { ...spec, cushions } }))],
    },
  };
  return Object.fromEntries(Object.entries(options[spec.kind]).map(([part, list]) => [part, list.slice(0, MAX_VARIANTS)]));
}

/** One part of a design on its own (its mesh and material), for a part variant's file. */
export function partOf(spec: FurnitureSpec, part: string): Group {
  const mesh = buildFurniture(spec).children.find((m) => m.name === partId(part))!;
  const group = new Group();
  group.add(mesh);
  return group;
}
