import { BackSide, Box3, BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from "three";
import { boxInModel, HINGES, localFrame, type AnimationConfig, type PartAnimation } from "./animation";

/** Geometry reconstruction for movable parts (after `refine`, on the editor's / viewer's own copy of the model; the
 * stored original file is never touched):
 *
 *  1. checkMovers: a part only moves when its geometry is a real door / drawer front. Judged as an ASSEMBLY (the part
 *     and what rides on it: a glazed door's frame with its glass, a front with its handle), in the part's own frame
 *     (where it faces, whatever the model's orientation). A fragment that overlaps another moving part without being
 *     on it (Meshy Auto Split cut overlapping pieces), is no flat panel, or barely covers its own outline (an
 *     irregular piece) is disabled and reported. Each movement is simulated: a swing into the body is turned the
 *     other way, or disabled when neither way is clear.
 *  2. openCavities: behind each moving part, the fixed parts' faces that close it off (a generated body is often
 *     solid there) are removed (invisible while closed) and a hollow interior is added. Every drawer gets a box
 *     (bottom, two sides, back, real thickness, the front's own material) that slides with its front, unless one
 *     already moves with it. Only the minimum: nothing where the body is already hollow but the drawer box.
 *  3. rebuildPanel: the vendor replaces one malformed part with a clean flat panel of the same size and material.
 */

type SlotLike = { id: string; mesh: Mesh; name?: string };
const size = (b: Box3) => b.getSize(new Vector3());
const area = (b: Box3) => size(b).x * size(b).y;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const outlineOverlap = (a: Box3, b: Box3) => overlap(a.min.x, a.max.x, b.min.x, b.max.x) * overlap(a.min.y, a.max.y, b.min.y, b.max.y);

type Triangles = { centroid: Float32Array; normal: Float32Array; nz: Float32Array; area: Float32Array; count: number };

/** Every triangle of a mesh in model coordinates: its centroid, its unit normal, how much it faces +z, its area. */
export function triangles(mesh: Mesh, modelRoot: Object3D): Triangles {
  modelRoot.updateMatrixWorld(true);
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const pos = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  const count = (index ? index.count : pos.count) / 3;
  const out: Triangles = { centroid: new Float32Array(count * 3), normal: new Float32Array(count * 3), nz: new Float32Array(count), area: new Float32Array(count), count };
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), ab = new Vector3(), ac = new Vector3();
  for (let t = 0; t < count; t++) {
    const i = (k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    a.fromBufferAttribute(pos, i(0)).applyMatrix4(toModel);
    b.fromBufferAttribute(pos, i(1)).applyMatrix4(toModel);
    c.fromBufferAttribute(pos, i(2)).applyMatrix4(toModel);
    const n = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    const len = n.length();
    out.area[t] = len / 2;
    if (len) n.divideScalar(len);
    out.normal.set([n.x, n.y, n.z], t * 3);
    out.nz[t] = len ? n.z : 0;
    out.centroid.set([(a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3], t * 3);
  }
  return out;
}

/** In a frame (`toLocal`): the triangles with their centroids and normals turned into it. */
function local(tri: Triangles, toLocal: Matrix4): Triangles {
  const rot = new Matrix4().extractRotation(toLocal);
  const out: Triangles = { ...tri, centroid: new Float32Array(tri.centroid), normal: new Float32Array(tri.normal), nz: new Float32Array(tri.count) };
  const v = new Vector3();
  for (let t = 0; t < tri.count; t++) {
    v.fromArray(tri.centroid, t * 3).applyMatrix4(toLocal).toArray(out.centroid, t * 3);
    v.fromArray(tri.normal, t * 3).applyMatrix4(rot).toArray(out.normal, t * 3);
    out.nz[t] = out.normal[t * 3 + 2];
  }
  return out;
}

/** How much of a part's front outline its front-facing surface covers (1: a full panel; low: an irregular piece).
 * `parts`: several meshes judged as one assembly (a glazed door: its frame AND its glass), each counted only inside
 * the outline, the total capped at the outline. */
export function frontFill(tri: Triangles | Triangles[], box: Box3): number {
  let sum = 0;
  for (const set of Array.isArray(tri) ? tri : [tri])
    for (let t = 0; t < set.count; t++) {
      const x = set.centroid[t * 3], y = set.centroid[t * 3 + 1];
      if (set.nz[t] > 0.5 && x >= box.min.x - 1e-6 && x <= box.max.x + 1e-6 && y >= box.min.y - 1e-6 && y <= box.max.y + 1e-6) sum += set.area[t];
    }
  return Math.min(sum / Math.max(area(box), 1e-9), 1);
}

const corners = (b: Box3) => [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => new Vector3(x ? b.max.x : b.min.x, y ? b.max.y : b.min.y, z ? b.max.z : b.min.z))));
const inFrame = (b: Box3, m: Matrix4) => new Box3().setFromPoints(corners(b).map((p) => p.applyMatrix4(m)));

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

/** Does the movement go into the body (behind the part's own back face, in its own frame, by more than a sliver)? */
export function intoBody(anim: PartAnimation, box: Box3): boolean {
  const m = localFrame(anim);
  const rest = inFrame(box, m), end = inFrame(movedBox(anim, box), m);
  return end.min.z < rest.min.z - 0.2 * Math.max(Math.min(size(rest).x, size(rest).y), 0.02);
}

/** Geometry checks before a part may move (see the file comment). The vendor's own settings ("manual") are kept. */
export function checkMovers(config: AnimationConfig | null, slots: SlotLike[], modelRoot: Object3D): AnimationConfig | null {
  if (!config) return config;
  const boxes = new Map(slots.map((s) => [s.id, boxInModel(s.mesh, modelRoot)]));
  const meshOf = new Map(slots.map((s) => [s.id, s.mesh]));
  const tris = new Map<string, Triangles>();
  const triOf = (id: string) => tris.get(id) ?? tris.set(id, triangles(meshOf.get(id)!, modelRoot)).get(id)!;
  const auto = config.animations.filter((a) => a.source !== "manual" && boxes.has(a.component));
  const issues = new Map<string, string[]>(config.animations.map((a) => [a.id, [...a.issues]]));
  const flip = new Set<string>();
  // Overlapping moving parts cannot both be physical doors: the vision-matched, tighter fragment wins. Parts of one
  // assembly (glass in its frame, a handle on its door) are not a collision.
  const rank = (a: PartAnimation) => (a.source === "vision" ? 0 : 1) * 1e6 + area(boxes.get(a.component)!);
  const together = (a: PartAnimation, o: PartAnimation) => a.follow.includes(o.component) || o.follow.includes(a.component);
  for (const a of auto) {
    const box = boxes.get(a.component)!;
    const m = localFrame(a);
    const own = inFrame(box, m);
    for (const o of config.animations) {
      const other = boxes.get(o.component);
      if (o === a || !other || !o.enabled || together(a, o)) continue;
      const theirs = inFrame(other, m);
      if (outlineOverlap(own, theirs) > 0.3 * Math.min(area(own), area(theirs)) && Math.abs(own.max.z - theirs.max.z) < 0.5 * Math.max(size(own).z, size(theirs).z, 0.02) + 0.05 * Math.max(size(own).x, size(own).y) && rank(a) > rank(o))
        issues.get(a.id)!.push(`Overlaps ${o.label}: the generated parts are cut wrongly here, so it is not moved.`);
    }
    const s = size(own);
    // The whole assembly's front: a glazed door's frame is a ring, its glass fills the middle.
    const assembly = [a.component, ...a.follow].filter((id) => meshOf.has(id));
    const fill = frontFill(assembly.map((id) => local(triOf(id), m)), own);
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

/** Solid panels as one geometry (each a closed box: [w, h, d, x, y, z] centred at x, y, z). */
function panels(list: [number, number, number, number, number, number][]): BufferGeometry {
  const parts = list.map(([w, h, d, x, y, z]) => new BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed());
  const out = new BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const size = parts[0].getAttribute(name).itemSize;
    const all = new Float32Array(parts.reduce((n, g) => n + g.getAttribute(name).array.length, 0));
    let at = 0;
    for (const g of parts) {
      all.set(g.getAttribute(name).array as Float32Array, at);
      at += g.getAttribute(name).array.length;
    }
    out.setAttribute(name, new BufferAttribute(all, size));
  }
  out.computeBoundingBox();
  return out;
}

/** A drawer box (w × h × d, front at z = d / 2, open at the top and the front): a solid bottom between two sides and a
 * back, every panel `t` thick, the bottom resting on the sides' lower edge. */
export function drawerBox(w: number, h: number, d: number, t: number): BufferGeometry {
  return panels([
    [w - 2 * t, t, d - t, 0, -h / 2 + t / 2, t / 2], // bottom, between the sides, in front of the back
    [t, h, d, -w / 2 + t / 2, 0, 0], // left side
    [t, h, d, w / 2 - t / 2, 0, 0], // right side
    [w - 2 * t, h, t, 0, 0, -d / 2 + t / 2], // back
  ]);
}

function interiorMaterial(from: Material | Material[], darker: number): MeshStandardMaterial {
  const base = Array.isArray(from) ? from[0] : from;
  const color = (base as MeshStandardMaterial).color?.clone() ?? new Color("#d9d4cc");
  return new MeshStandardMaterial({ color: color.multiplyScalar(darker), roughness: 0.85, metalness: 0, side: DoubleSide });
}

/** The front's own material (colour, texture, PBR maps), for the box it pulls out. */
const frontMaterial = (from: Material | Material[]) => (Array.isArray(from) ? from[0] : from).clone();

export type Added = { id: string; name: string; nameAr: string; mesh: Mesh; follows?: string };

/** A drawer already has a box: a part moving with its front reaches well behind it, or a box was added before. */
function hasDrawerBox(a: PartAnimation, frontLocal: Box3, boxesLocal: Map<string, Box3>, modelRoot: Object3D, depth: number): boolean {
  if (a.follow.some((id) => { const b = boxesLocal.get(id); return b && b.min.z < frontLocal.min.z - 0.15 * depth; })) return true;
  let found = false;
  modelRoot.traverse((o) => { if (o.userData?.drawerBoxFor === a.component) found = true; });
  return found;
}

/** Opens the fixed parts behind each enabled door / drawer where they close it off, and gives every drawer its box
 * (see the file comment). Returns the new parts (interiors stay put; drawer boxes follow their front). */
export function openCavities(config: AnimationConfig | null, slots: SlotLike[], modelRoot: Object3D): Added[] {
  const moving = (config?.animations ?? []).filter((a) => a.enabled && (a.type === "translation" ? (a.distance ?? 0) !== 0 : HINGES[a.hinge ?? "left"]?.axis !== undefined));
  if (!moving.length) return [];
  const boxes = new Map(slots.map((s) => [s.id, boxInModel(s.mesh, modelRoot)]));
  const movingIds = new Set(moving.flatMap((a) => [a.component, ...a.follow]));
  // Every fixed part can close an opening off (a solid body, a back panel's front, a divider): not only the biggest.
  const fixed = slots.filter((s) => !movingIds.has(s.id) && !s.mesh.userData?.estimated);
  const tris = new Map(fixed.map((s) => [s.id, triangles(s.mesh, modelRoot)]));
  const remove = new Map<string, Set<number>>();
  const added: Added[] = [];
  for (const a of moving) {
    const box = boxes.get(a.component);
    const front = slots.find((s) => s.id === a.component);
    if (!box || !front) continue;
    const toLocal = localFrame(a);
    const toModel = toLocal.clone().transpose();
    const boxesLocal = new Map([...boxes].map(([id, b]) => [id, inFrame(b, toLocal)]));
    const fl = boxesLocal.get(a.component)!;
    const whole = [...boxesLocal.values()].reduce((all, b) => all.union(b), new Box3());
    const depth = size(whole).z;
    const s = size(fl);
    const inset = 0.04 * Math.min(s.x, s.y);
    const x0 = fl.min.x + inset, x1 = fl.max.x - inset, y0 = fl.min.y + inset, y1 = fl.max.y - inset;
    const near = fl.min.z - 0.25 * depth;
    const opening = (x1 - x0) * (y1 - y0);
    // Which fixed faces close the opening: facing out, within the outline, just behind the part.
    let covered = 0;
    const hits = new Map<string, { area: number; faces: number[] }>();
    for (const part of fixed) {
      const tri = local(tris.get(part.id)!, toLocal);
      for (let t = 0; t < tri.count; t++) {
        const cx = tri.centroid[t * 3], cy = tri.centroid[t * 3 + 1], cz = tri.centroid[t * 3 + 2];
        if (tri.nz[t] > 0.5 && cx > x0 && cx < x1 && cy > y0 && cy < y1 && cz > near && cz < fl.max.z) {
          covered += tri.area[t];
          const hit = hits.get(part.id) ?? hits.set(part.id, { area: 0, faces: [] }).get(part.id)!;
          hit.area += tri.area[t];
          hit.faces.push(t);
        }
      }
    }
    const back = Math.max(whole.min.z + 0.03 * depth, fl.min.z - 0.9 * depth);
    const inner = fl.min.z - 0.002;
    const d = inner - back;
    const place = (geometry: BufferGeometry, centre: Vector3, material: Material, id: string, name: string, nameAr: string, follows?: string) => {
      const mesh = new Mesh(geometry, material);
      mesh.name = name;
      mesh.userData.estimated = true;
      if (follows) mesh.userData.drawerBoxFor = a.component;
      mesh.matrix.copy(toModel).setPosition(centre.clone().applyMatrix4(toModel));
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      modelRoot.add(mesh);
      mesh.updateMatrixWorld(true);
      added.push({ id, name, nameAr, mesh, follows });
    };
    if (covered >= 0.4 * opening && d > 0.02 * depth) {
      // Solid behind it: the faces that close it off go (only the parts that really cover it: a shelf's edge stays).
      for (const [id, hit] of hits) if (hit.area >= 0.25 * opening) {
        const set = remove.get(id) ?? remove.set(id, new Set()).get(id)!;
        hit.faces.forEach((t) => set.add(t));
      }
      const body = fixed.find((p) => hits.get(p.id)?.area === Math.max(...[...hits.values()].map((h) => h.area)));
      const centre = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (inner + back) / 2);
      const space = a.type === "translation" ? `Drawer space (${a.label})` : `Interior (${a.label})`;
      const spaceAr = a.type === "translation" ? `فراغ الدرج (${a.labelAr ?? a.label})` : `الفراغ الداخلي (${a.labelAr ?? a.label})`;
      place(openBox(x1 - x0, y1 - y0, d, 4), centre, interiorMaterial(body?.mesh.material ?? front.mesh.material, 0.82), `cavity_${a.component}`, space, spaceAr);
    }
    if (a.type !== "translation" || hasDrawerBox(a, fl, boxesLocal, modelRoot, depth) || d <= 0.02 * depth) continue;
    // The drawer box: as wide as the opening less runners, 80 % of its height, as deep as the body allows; it slides
    // no further than it is deep, so it never leaves the body.
    const w = (x1 - x0) * 0.96, h = (y1 - y0) * 0.8, boxDepth = d * 0.95;
    const t = Math.max(Math.min(0.06 * Math.min(w, h), 0.08 * boxDepth), 1e-4);
    if (Math.abs(a.distance ?? 0) > 0.85 * boxDepth) a.distance = Math.sign(a.distance ?? 1) * 0.85 * boxDepth;
    place(drawerBox(w, h, boxDepth, t), new Vector3((x0 + x1) / 2, y0 + h / 2, inner - boxDepth / 2), frontMaterial(front.mesh.material),
      `drawer_box_${a.component}`, `Drawer box (${a.label})`, `صندوق الدرج (${a.labelAr ?? a.label})`, a.id);
  }
  for (const [id, set] of remove) keepTriangles(slots.find((s) => s.id === id)!.mesh.geometry, (t) => !set.has(t));
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
