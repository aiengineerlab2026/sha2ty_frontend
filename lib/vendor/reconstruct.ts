import { BackSide, Box3, BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from "three";
import { boxInModel, HINGES, type AnimationConfig, type PartAnimation } from "./animation";

/** Geometry reconstruction for movable parts (after `refine`, on the editor's / viewer's own copy of the model; the
 * stored original file is never touched):
 *
 *  1. checkMovers: a part only moves when its geometry is a real door / drawer front. A fragment that overlaps another
 *     moving part (Meshy Auto Split cut overlapping pieces), is no flat panel, or barely covers its own outline
 *     (an irregular piece) is disabled and reported. Each movement is simulated: a swing into the body is turned the
 *     other way, or disabled when neither way is clear.
 *  2. openCavities: a generated body is often solid behind its doors (its front faces run straight across). The faces
 *     the closed door covers are removed (invisible while closed) and a hollow interior is added behind the opening;
 *     a drawer gets a hollow box that slides with its front. Only where the body really is solid there.
 *  3. rebuildPanel: the vendor replaces one malformed part with a clean flat panel of the same size and material.
 */

type SlotLike = { id: string; mesh: Mesh; name?: string };
const size = (b: Box3) => b.getSize(new Vector3());
const area = (b: Box3) => size(b).x * size(b).y;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const outlineOverlap = (a: Box3, b: Box3) => overlap(a.min.x, a.max.x, b.min.x, b.max.x) * overlap(a.min.y, a.max.y, b.min.y, b.max.y);

type Triangles = { centroid: Float32Array; nz: Float32Array; area: Float32Array; count: number };

/** Every triangle of a mesh in model coordinates: its centroid, how much it faces the front (+z), its area. */
export function triangles(mesh: Mesh, modelRoot: Object3D): Triangles {
  modelRoot.updateMatrixWorld(true);
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const pos = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  const count = (index ? index.count : pos.count) / 3;
  const out: Triangles = { centroid: new Float32Array(count * 3), nz: new Float32Array(count), area: new Float32Array(count), count };
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), ab = new Vector3(), ac = new Vector3();
  for (let t = 0; t < count; t++) {
    const i = (k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    a.fromBufferAttribute(pos, i(0)).applyMatrix4(toModel);
    b.fromBufferAttribute(pos, i(1)).applyMatrix4(toModel);
    c.fromBufferAttribute(pos, i(2)).applyMatrix4(toModel);
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    const len = n.length();
    out.area[t] = len / 2;
    out.nz[t] = len ? n.z / len : 0;
    out.centroid[t * 3] = (a.x + b.x + c.x) / 3;
    out.centroid[t * 3 + 1] = (a.y + b.y + c.y) / 3;
    out.centroid[t * 3 + 2] = (a.z + b.z + c.z) / 3;
  }
  return out;
}

/** How much of a part's front outline its front-facing surface covers (1: a full panel; low: an irregular piece). */
export function frontFill(tri: Triangles, box: Box3): number {
  let sum = 0;
  for (let t = 0; t < tri.count; t++) if (tri.nz[t] > 0.5) sum += tri.area[t];
  return Math.min(sum / Math.max(area(box), 1e-9), 1);
}

const corners = (b: Box3) => [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => new Vector3(x ? b.max.x : b.min.x, y ? b.max.y : b.min.y, z ? b.max.z : b.min.z))));

/** The part's box at the end of its movement (model coordinates). */
export function movedBox(anim: PartAnimation, box: Box3): Box3 {
  if (anim.type === "translation") {
    const d = new Vector3(anim.axis === "x" ? 1 : 0, anim.axis === "y" ? 1 : 0, anim.axis === "z" ? 1 : 0).multiplyScalar(anim.distance ?? 0);
    return box.clone().translate(d);
  }
  const pivot = new Vector3(...(anim.pivot ?? [0, 0, 0]));
  const axis = new Vector3(anim.axis === "x" ? 1 : 0, anim.axis === "y" ? 1 : 0, anim.axis === "z" ? 1 : 0);
  const m = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new Matrix4().makeRotationAxis(axis, (((anim.to ?? 0) - (anim.from ?? 0)) * Math.PI) / 180)).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  return new Box3().setFromPoints(corners(box).map((p) => p.applyMatrix4(m)));
}

/** Does the movement go into the body (behind the part's own back face by more than a sliver)? */
export function intoBody(anim: PartAnimation, box: Box3): boolean {
  return movedBox(anim, box).min.z < box.min.z - 0.2 * Math.max(Math.min(size(box).x, size(box).y), 0.02);
}

/** Geometry checks before a part may move (see the file comment). The vendor's own settings ("manual") are kept. */
export function checkMovers(config: AnimationConfig | null, slots: SlotLike[], modelRoot: Object3D): AnimationConfig | null {
  if (!config) return config;
  const boxes = new Map(slots.map((s) => [s.id, boxInModel(s.mesh, modelRoot)]));
  const meshOf = new Map(slots.map((s) => [s.id, s.mesh]));
  const auto = config.animations.filter((a) => a.source !== "manual" && boxes.has(a.component));
  const issues = new Map<string, string[]>(config.animations.map((a) => [a.id, [...a.issues]]));
  const flip = new Set<string>();
  // Overlapping moving parts cannot both be physical doors: the vision-matched, tighter fragment wins.
  const rank = (a: PartAnimation) => (a.source === "vision" ? 0 : 1) * 1e6 + area(boxes.get(a.component)!);
  for (const a of auto) {
    const box = boxes.get(a.component)!;
    for (const o of config.animations) {
      const other = boxes.get(o.component);
      if (o === a || !other || !o.enabled) continue;
      if (outlineOverlap(box, other) > 0.3 * Math.min(area(box), area(other)) && rank(a) > rank(o))
        issues.get(a.id)!.push(`Overlaps ${o.label}: the generated parts are cut wrongly here, so it is not moved.`);
    }
    const s = size(box);
    const fill = frontFill(triangles(meshOf.get(a.component)!, modelRoot), box);
    if (s.z > 0.35 * Math.min(s.x, s.y) && a.type === "rotation") issues.get(a.id)!.push("Not a flat panel: it would swing a piece of the body.");
    if (fill < 0.6) issues.get(a.id)!.push(`An irregular piece (it covers ${Math.round(fill * 100)}% of its outline): rebuild it as a panel or leave it fixed.`);
    if (intoBody(a, box)) {
      const reversed: PartAnimation = a.type === "rotation" ? { ...a, to: -(a.to ?? 0) } : { ...a, distance: -(a.distance ?? 0) };
      if (intoBody(reversed, box)) issues.get(a.id)!.push("Its movement runs into the body either way.");
      else flip.add(a.id);
    }
  }
  return {
    ...config,
    animations: config.animations.map((a) => {
      const next = flip.has(a.id) ? (a.type === "rotation" ? { ...a, to: -(a.to ?? 0), reason: `${a.reason ?? ""} (turned outwards)`.trim() } : { ...a, distance: -(a.distance ?? 0) }) : a;
      const list = [...new Set(issues.get(a.id) ?? [])];
      return a.source === "manual" ? { ...next, issues: list } : { ...next, issues: list, enabled: next.enabled && !list.length };
    }),
  };
}

/** Keeps only the triangles `keep` says, group ranges (one material each) rebuilt to match. In place: the mesh's own
 * geometry copy (prepare clones it), never the loaded file's. */
function keepTriangles(geometry: BufferGeometry, keep: (t: number) => boolean) {
  const index = geometry.getIndex();
  const count = (index ? index.count : geometry.getAttribute("position").count) / 3;
  const at = (k: number) => (index ? index.getX(k) : k);
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: count * 3, materialIndex: 0 }];
  const out: number[] = [];
  const next: { start: number; count: number; materialIndex?: number }[] = [];
  for (const g of groups) {
    const start = out.length;
    for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) if (keep(t)) out.push(at(t * 3), at(t * 3 + 1), at(t * 3 + 2));
    next.push({ start, count: out.length - start, materialIndex: g.materialIndex });
  }
  geometry.setIndex(new BufferAttribute(out.length > 65535 ? new Uint32Array(out) : new Uint16Array(out), 1));
  geometry.clearGroups();
  if (geometry.groups.length || groups.length > 1) for (const g of next) geometry.addGroup(g.start, g.count, g.materialIndex);
}

/** A box without one face, seen from inside (`side`): px, nx, py, ny, pz, nz are BoxGeometry's groups 0–5. */
function openBox(w: number, h: number, d: number, without: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const kept = g.groups.filter((_, i) => i !== without);
  const index = g.getIndex()!;
  const out: number[] = [];
  for (const k of kept) for (let i = k.start; i < k.start + k.count; i++) out.push(index.getX(i));
  g.setIndex(out);
  g.clearGroups();
  return g;
}

function interiorMaterial(from: Material | Material[], darker: number): MeshStandardMaterial {
  const base = Array.isArray(from) ? from[0] : from;
  const color = (base as MeshStandardMaterial).color?.clone() ?? new Color("#d9d4cc");
  return new MeshStandardMaterial({ color: color.multiplyScalar(darker), roughness: 0.85, metalness: 0, side: DoubleSide });
}

export type Added = { id: string; name: string; nameAr: string; mesh: Mesh; follows?: string };

/** Opens the body behind each enabled door / drawer where it is solid (see the file comment). Returns the new parts
 * (interiors stay put; drawer boxes follow their front). Nothing happens where the body is already hollow. */
export function openCavities(config: AnimationConfig | null, slots: SlotLike[], modelRoot: Object3D): Added[] {
  const moving = (config?.animations ?? []).filter((a) => a.enabled && (a.type === "translation" ? a.direction === "front" : HINGES[a.hinge ?? "left"]?.axis === "y"));
  if (!moving.length) return [];
  const boxes = new Map(slots.map((s) => [s.id, boxInModel(s.mesh, modelRoot)]));
  const movingIds = new Set(moving.flatMap((a) => [a.component, ...a.follow]));
  const vol = (b: Box3) => size(b).x * size(b).y * size(b).z;
  const body = slots.filter((s) => !movingIds.has(s.id)).sort((a, b) => vol(boxes.get(b.id)!) - vol(boxes.get(a.id)!))[0];
  if (!body) return [];
  const bodyBox = boxes.get(body.id)!;
  const depth = size(bodyBox).z;
  const tri = triangles(body.mesh, modelRoot);
  const remove = new Set<number>();
  const added: Added[] = [];
  const toBody = body.mesh.matrixWorld.clone().invert().multiply(modelRoot.matrixWorld); // model → body local
  for (const a of moving) {
    const box = boxes.get(a.component);
    if (!box) continue;
    const s = size(box);
    const inset = 0.04 * Math.min(s.x, s.y);
    const x0 = box.min.x + inset, x1 = box.max.x - inset, y0 = box.min.y + inset, y1 = box.max.y - inset;
    const near = box.min.z - 0.25 * depth;
    let covered = 0;
    const faces: number[] = [];
    for (let t = 0; t < tri.count; t++) {
      const cx = tri.centroid[t * 3], cy = tri.centroid[t * 3 + 1], cz = tri.centroid[t * 3 + 2];
      if (tri.nz[t] > 0.5 && cx > x0 && cx < x1 && cy > y0 && cy < y1 && cz > near) {
        covered += tri.area[t];
        faces.push(t);
      }
    }
    if (covered < 0.4 * (x1 - x0) * (y1 - y0)) continue; // hollow already: nothing to open
    faces.forEach((t) => remove.add(t));
    // The hollow behind the opening: back, sides, floor and top, open at the front, inside the body.
    const back = Math.max(bodyBox.min.z + 0.03 * depth, box.min.z - 0.9 * depth);
    const front = box.min.z - 0.002;
    const w = x1 - x0, h = y1 - y0, d = front - back;
    if (d <= 0.02 * depth) continue;
    const material = interiorMaterial(body.mesh.material, 0.82);
    const placeIn = (geometry: BufferGeometry, centre: Vector3, id: string, name: string, nameAr: string, follows?: string) => {
      const mesh = new Mesh(geometry, material.clone());
      mesh.name = name;
      mesh.userData.estimated = true;
      mesh.position.copy(centre.applyMatrix4(toBody));
      mesh.scale.setFromMatrixScale(toBody); // the body's own scale undone: sizes stay in model units
      body.mesh.add(mesh);
      added.push({ id, name, nameAr, mesh, follows });
    };
    const centre = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (front + back) / 2);
    if (a.type === "translation") {
      // The drawer's hollow box (open at the top), sliding with its front; a sleeve for it in the body.
      const boxDepth = Math.min(d, Math.abs(a.distance ?? d) * 1.25);
      placeIn(openBox(w * 0.96, h * 0.8, boxDepth, 2), new Vector3(centre.x, y0 + h * 0.4, front - boxDepth / 2), `drawer_box_${a.component}`, `Drawer box (${a.label})`, `صندوق الدرج (${a.labelAr ?? a.label})`, a.id);
      placeIn(openBox(w, h, d, 4), centre.clone(), `cavity_${a.component}`, `Drawer space (${a.label})`, `فراغ الدرج (${a.labelAr ?? a.label})`);
    } else placeIn(openBox(w, h, d, 4), centre, `cavity_${a.component}`, `Interior (${a.label})`, `الفراغ الداخلي (${a.labelAr ?? a.label})`);
  }
  if (remove.size) keepTriangles(body.mesh.geometry, (t) => !remove.has(t));
  for (const p of added) {
    // Each interior is a child of the body (static); it moves to the model root so it never shifts the body's own
    // children, and drawer boxes become parts that slide with their front.
    modelRoot.attach(p.mesh);
  }
  return added;
}

/** Replaces a malformed part with a clean flat panel of the same outline, in its own frame and material (one material
 * per mesh only). The part keeps its id, edits and the parts attached to it. */
export function rebuildPanel(mesh: Mesh): boolean {
  if (Array.isArray(mesh.material)) return false;
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const b = g.boundingBox!;
  const s = b.getSize(new Vector3());
  const panel = new BoxGeometry(Math.max(s.x, 1e-4), Math.max(s.y, 1e-4), Math.max(s.z, 1e-4)).translate(...b.getCenter(new Vector3()).toArray());
  mesh.geometry = panel;
  return true;
}

/** The interiors stay visible from inside (their faces point outwards; DoubleSide covers both). */
export const INTERIOR_SIDE = BackSide;
