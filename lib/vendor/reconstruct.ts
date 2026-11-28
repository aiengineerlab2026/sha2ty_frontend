import { BackSide, Box3, BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, FrontSide, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from "three";
import { layerOfLook } from "./layers";
import { authoredSwing, boxInModel, HINGES, localFrame, openAngle, sheetArea, type AnimationConfig, type PartAnimation } from "./animation";

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

/** Model → the part's own sheet (+z along the thin axis, flipped so the surface faces +z). A door posed open is still thin. */
function sheetBasis(mesh: Mesh, modelRoot: Object3D, tri: Triangles): Matrix4 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const s = mesh.geometry.boundingBox!.getSize(new Vector3());
  const thin = s.x <= s.y && s.x <= s.z ? new Vector3(1, 0, 0) : s.y <= s.z ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const normal = thin.transformDirection(toModel).normalize();
  let up = new Vector3(0, 1, 0);
  if (Math.abs(up.dot(normal)) > 0.85) up = new Vector3(1, 0, 0);
  const x = new Vector3().crossVectors(up, normal).normalize();
  const y = new Vector3().crossVectors(normal, x).normalize();
  let frame = new Matrix4().makeBasis(x, y, normal).transpose();
  const turned = local(tri, frame);
  let signed = 0;
  for (let t = 0; t < turned.count; t++) signed += turned.nz[t] * turned.area[t];
  if (signed < 0) frame = new Matrix4().makeBasis(x.negate(), y, normal.negate()).transpose();
  return frame;
}

/** A mesh in front of a part icon. Glass and the part's own assembly do not hide the control. */
export function blocksPartIcon(mesh: Mesh, own: Set<Mesh>): boolean {
  if (!mesh.isMesh || !mesh.visible || own.has(mesh)) return false;
  const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const clear = list.length > 0 && list.every((m) => {
    const mat = m as MeshStandardMaterial & { transmission?: number };
    return Boolean((mat.transparent && (mat.opacity ?? 1) <= 0.45) || (mat.transmission ?? 0) > 0.2);
  });
  return !clear;
}

const corners = (b: Box3) => [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => new Vector3(x ? b.max.x : b.min.x, y ? b.max.y : b.min.y, z ? b.max.z : b.min.z))));

/** The mesh's own box in `frame`, so a swung door stays a thin sheet instead of the box around its swing. */
function orientedBox(mesh: Mesh, modelRoot: Object3D, frame: Matrix4): Box3 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  return new Box3().setFromPoints(corners(mesh.geometry.boundingBox!).map((p) => p.applyMatrix4(toModel).applyMatrix4(frame)));
}
const inFrame = (b: Box3, m: Matrix4) => new Box3().setFromPoints(corners(b).map((p) => p.applyMatrix4(m)));

/** The part's box at the end of its movement (model coordinates). */
export function movedBox(anim: PartAnimation, box: Box3, t = 1): Box3 {
  if (anim.type === "translation") {
    const d = new Vector3(anim.axis === "x" ? 1 : 0, anim.axis === "y" ? 1 : 0, anim.axis === "z" ? 1 : 0).multiplyScalar((anim.distance ?? 0) * t);
    return box.clone().translate(d);
  }
  return new Box3().setFromPoints(corners(box).map((p) => p.applyMatrix4(turnAt(anim, t))));
}

/** The rigid turn (model coordinates) from the file's pose to `anim` at `t`, as poseAt plays it. */
export function turnAt(anim: PartAnimation, t: number, degrees = (anim.from ?? 0) + ((anim.to ?? 0) - (anim.from ?? 0)) * t): Matrix4 {
  const pivot = new Vector3(...(anim.pivot ?? [0, 0, 0]));
  const axis = new Vector3(anim.axis === "x" ? 1 : 0, anim.axis === "y" ? 1 : 0, anim.axis === "z" ? 1 : 0);
  return new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z).multiply(new Matrix4().makeRotationAxis(axis, (degrees * Math.PI) / 180)).multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

/** A mesh's own box corners in model coordinates (they turn rigidly with it). */
function meshCorners(mesh: Mesh, modelRoot: Object3D): Vector3[] {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  return corners(mesh.geometry.boundingBox!).map((p) => p.applyMatrix4(toModel));
}

const STEP = 2; // degrees between collision samples
const CLEAR = 0.003; // m: touching within this is not a collision

/** A part's pose at openness `f` relative to the file (model coordinates): what applyAnimations does to it. */
export function poseMatrix(anim: PartAnimation, f: number): Matrix4 {
  if (anim.type === "rotation") return turnAt(anim, f);
  const d = (anim.distance ?? 0) * f;
  return new Matrix4().makeTranslation(anim.axis === "x" ? d : 0, anim.axis === "y" ? d : 0, anim.axis === "z" ? d : 0);
}

/** Something a turning part may hit: a part's own box (`box`, in the frame `local` maps model coordinates to at the
 * file's pose: a mesh's own geometry box, so a swung door is its true slab, not a loose world box), moving with
 * `mover` when it is on another moving part. */
export type Obstacle = { label: string; box: Box3; local: Matrix4; mover?: PartAnimation };

/** The widest a turning part opens (≤ its configured angle) before the swinging half of it enters another part: the
 * fixed ones, and every other moving part shut, fully open and opening at the same time ("Open all"). `null` when
 * it opens fully. A part it already sits in when shut (the body around a door) is no obstacle. */
export function safeAngle(anim: PartAnimation, own: Vector3[], others: Obstacle[]): { angle: number; by: string } | null {
  return sweep(anim, own, others).stop;
}

/** safeAngle, and the moving parts behind this one (`after` it: they wait for it to open, so it meets them shut). */
function sweep(anim: PartAnimation, own: Vector3[], others: Obstacle[]): { stop: { angle: number; by: string } | null; behind: PartAnimation[] } {
  const pivot = new Vector3(...(anim.pivot ?? [0, 0, 0]));
  const axis = new Vector3(anim.axis === "x" ? 1 : 0, anim.axis === "y" ? 1 : 0, anim.axis === "z" ? 1 : 0);
  const closed = own.map((p) => p.clone().applyMatrix4(turnAt(anim, 0)));
  const reach = (p: Vector3) => { const d = p.clone().sub(pivot); return d.addScaledVector(axis, -d.dot(axis)).length(); };
  const far = Math.max(...closed.map(reach));
  // Points over the swinging half of the part: from mid-width to the free edge, across its height and thickness.
  const hingeSide = closed.filter((p) => reach(p) <= 0.5 * far);
  const edge = closed.filter((p) => reach(p) > 0.5 * far);
  const free: Vector3[] = [];
  for (const s of [0.5, 0.625, 0.75, 0.875, 1]) {
    const row = edge.map((f) => hingeSide.reduce((a, b) => (b.distanceToSquared(f) < a.distanceToSquared(f) ? b : a), hingeSide[0] ?? f).clone().lerp(f, s));
    for (let i = 0; i < row.length; i++) for (let j = i; j < row.length; j++) for (const k of [0, 0.25, 0.5, 0.75, 1]) free.push(row[i].clone().lerp(row[j], k));
  }
  const shrunk = new Map(others.map((o) => [o, o.box.clone().expandByScalar(-CLEAR)]));
  const into = (o: Obstacle, f: number) => (o.mover ? poseMatrix(o.mover, f).invert().premultiply(o.local) : o.local);
  const inside = (o: Obstacle, f: number, pts: Vector3[]) => { const m = into(o, f), b = shrunk.get(o)!; return pts.some((p) => b.containsPoint(p.clone().applyMatrix4(m))); };
  const centre = new Box3().setFromPoints(closed).getCenter(new Vector3());
  const obstacles = others.filter((o) => !inside(o, 0, free) && !o.box.clone().expandByScalar(0.01).containsPoint(centre.clone().applyMatrix4(into(o, 0))));
  const wanted = openAngle(anim), sign = Math.sign((anim.to ?? 0) - (anim.from ?? 0)) || 1;
  const shut = turnAt(anim, 0).invert();
  // A part that, open, would be where this one is shut (a drawer behind a door) waits for this one to open (`after`,
  // step) and is shut again before it closes: it is only ever met shut.
  // In the part's own frame (+z out of its face): what sits wholly behind its shut face and, open, comes through it.
  const face = localFrame(anim);
  const shutBox = new Box3().setFromPoints(closed.map((p) => p.clone().applyMatrix4(face))).expandByScalar(-CLEAR);
  const boxAt = (o: Obstacle, f: number) => new Box3().setFromPoints(corners(o.box).map((p) => p.applyMatrix4(into(o, f).invert()).applyMatrix4(face)));
  // Its whole travel, shut to open (a drawer front alone jumps clean over a door's thin slab between the two poses).
  const travel = (o: Obstacle) => [0, 0.25, 0.5, 0.75, 1].reduce((all, f) => all.union(boxAt(o, f)), new Box3());
  const behind = new Set(obstacles.filter((o) => o.mover && boxAt(o, 0).max.z <= shutBox.min.z + CLEAR && travel(o).intersectsBox(shutBox)));
  for (let a = STEP; a < wanted + STEP; a += STEP) {
    const at = Math.min(a, wanted);
    const pts = free.map((p) => p.clone().applyMatrix4(turnAt(anim, 0, (anim.from ?? 0) + sign * at).multiply(shut)));
    for (const o of obstacles) {
      const poses: [number, string][] = !o.mover || behind.has(o) ? [[0, ""]] : [[0, ""], [1, " (open)"], [at / wanted, " (opening with it)"]];
      const hit = poses.find(([f]) => inside(o, f, pts));
      if (hit) return { stop: { angle: Math.max(0, at - STEP), by: o.label + hit[1] }, behind: movers(behind) };
    }
  }
  return { stop: null, behind: movers(behind) };
}
const movers = (list: Set<Obstacle>) => [...new Set([...list].map((o) => o.mover!))];

/** Does the movement go into the body (behind the part's own back face, in its own frame, by more than a sliver)? */
export function intoBody(anim: PartAnimation, box: Box3): boolean {
  const m = localFrame(anim);
  const rest = inFrame(box, m), end = inFrame(movedBox(anim, box), m);
  return end.min.z < rest.min.z - 0.2 * Math.max(Math.min(size(rest).x, size(rest).y), 0.02);
}

/** A model rebuilt part by part (backend services/hybrid.py, `authoritative`): its parts, their relations and its
 * movements are the backend's, validated on the real file. Nothing is guessed from names and nothing is added (no
 * mirror backing, no hollowed interior, no second carcass); every movement is still checked for collisions. */
export function authoritativeMovers(config: AnimationConfig, slots: SlotLike[], modelRoot: Object3D): AnimationConfig | null {
  return checkMovers({ ...config, animations: config.animations.map((a) => ({ ...a, follow: [...a.follow], issues: [...(a.issues ?? [])] })) }, slots, modelRoot);
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
  const motionOf = new Map<string, PartAnimation>();
  // Overlapping moving parts cannot both be physical doors: the vision-matched, tighter fragment wins. Parts of one
  // assembly (glass in its frame, a handle on its door) are not a collision.
  const rank = (a: PartAnimation) => (a.source === "vision" ? 0 : 1) * 1e6 + area(boxes.get(a.component)!);
  const together = (a: PartAnimation, o: PartAnimation) => a.follow.includes(o.component) || o.follow.includes(a.component);
  for (const a of auto) {
    const box = boxes.get(a.component)!;
    let motion = a;
    let m = localFrame(a);
    if (a.type === "rotation") {
      const leaf = meshOf.get(a.component)!;
      const swung = authoredSwing(leaf, modelRoot, a);
      // The file shows this door open: openness 0 turns it back onto the cabinet (closed), 1 opens it its full angle
      // from there, the way the file shows it open. Its openings are measured from closed, never from the file's pose.
      const angle = openAngle(a);
      motion = Math.abs(swung) > 12 ? { ...a, rest: undefined, from: -swung, to: -swung + Math.sign(swung) * angle } : { ...a, rest: undefined, from: 0, to: Math.sign((a.to ?? 0) - (a.from ?? 0)) * angle };
      m = sheetBasis(leaf, modelRoot, triOf(a.component));
    }
    motionOf.set(a.id, motion);
    const own = a.type === "rotation" ? orientedBox(meshOf.get(a.component)!, modelRoot, m) : inFrame(box, m);
    for (const o of config.animations) {
      const other = boxes.get(o.component);
      if (o === a || !other || !o.enabled || together(a, o)) continue;
      const theirs = meshOf.has(o.component) ? orientedBox(meshOf.get(o.component)!, modelRoot, m) : inFrame(other, m);
      const ts = size(theirs);
      // Cut wrongly: two slabs in one plane, through or flush against each other. A door shut in front of a drawer (a
      // real gap between their depths) is how furniture is built, not a cut.
      const coplanar = ts.z < 0.35 * Math.min(ts.x, ts.y) && Math.abs(own.getCenter(new Vector3()).z - theirs.getCenter(new Vector3()).z) < Math.max(size(own).z, ts.z, 0.02) + 0.03
        && Math.max(own.min.z - theirs.max.z, theirs.min.z - own.max.z) < 0.005;
      if (coplanar && outlineOverlap(own, theirs) > 0.3 * Math.min(area(own), area(theirs)) && rank(a) > rank(o))
        issues.get(a.id)!.push(`Overlaps ${o.label}: the generated parts are cut wrongly here, so it is not moved.`);
    }
    const s = size(own);
    // The whole assembly's front: a glazed door's frame is a ring, its glass fills the middle.
    const assembly = [a.component, ...a.follow].filter((id) => meshOf.has(id));
    const fill = frontFill(assembly.map((id) => local(triOf(id), m)), own);
    if (s.z > 0.35 * Math.min(s.x, s.y) && a.type === "rotation") issues.get(a.id)!.push("Not a flat panel: it would swing a piece of the body.");
    if (fill < 0.6) issues.get(a.id)!.push(`An irregular piece (it covers ${Math.round(fill * 100)}% of its outline): rebuild it as a panel or leave it fixed.`);
    if (!motion.from && intoBody(motion, box)) {
      const reversed: PartAnimation = motion.type === "rotation" ? { ...motion, to: -(motion.to ?? 0) } : { ...motion, distance: -(motion.distance ?? 0) };
      if (intoBody(reversed, box)) issues.get(a.id)!.push("Its movement runs into the body either way.");
      else flip.add(a.id);
    }
  }
  // The vendor's own doors keep their hinge, angle and direction; only where "shut" is comes from the file itself (a
  // file saved closed, or one still showing the door open), so the same settings play right on either.
  for (const a of config.animations) {
    if (a.source !== "manual" || a.type !== "rotation" || a.rest === "open" || !meshOf.has(a.component)) continue;
    const swung = authoredSwing(meshOf.get(a.component)!, modelRoot, a);
    const from = Math.abs(swung) > 12 ? -swung : 0;
    motionOf.set(a.id, { ...a, from, to: from + (Math.sign((a.to ?? 0) - (a.from ?? 0)) || 1) * openAngle(a) });
  }
  const moved = config.animations.map((a) => {
    const base = motionOf.get(a.id) ?? a;
    const next = flip.has(a.id) ? (base.type === "rotation" ? { ...base, to: -(base.to ?? 0), reason: `${base.reason ?? ""} (turned outwards)`.trim() } : { ...base, distance: -(base.distance ?? 0) }) : base;
    const list = [...new Set(issues.get(a.id) ?? [])];
    return a.source === "manual" ? { ...next, issues: list } : { ...next, issues: list, enabled: next.enabled && !list.length };
  });
  // Each turning part swept open against the rest (fixed parts, and the other moving parts shut, open and opening with
  // it): where it would hit something it stops short and says so (`limit`) instead of passing through. In order, so a
  // door checked after its neighbour meets it at the angle the neighbour really opens to.
  const out = [...moved];
  const meshBox = (mesh: Mesh) => { if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox(); return mesh.geometry.boundingBox!.clone(); };
  const toLocal = (mesh: Mesh) => mesh.matrixWorld.clone().invert().multiply(modelRoot.matrixWorld);
  const label = (id: string) => slots.find((s) => s.id === id)?.name ?? id;
  const waits = new Map<string, string[]>(); // a part → the doors in front of it
  out.forEach((a, i) => {
    if (a.type !== "rotation" || !a.enabled || !meshOf.has(a.component)) return;
    const mine = new Set([a.component, ...a.follow]);
    const others: Obstacle[] = [...meshOf].filter(([id]) => !mine.has(id)).map(([id, mesh]) => {
      const owner = out.find((o) => o.enabled && (o.component === id || o.follow.includes(id)));
      return { label: label(id), box: meshBox(mesh), local: toLocal(mesh), ...(owner ? { mover: owner } : {}) };
    });
    const own = [...mine].filter((id) => meshOf.has(id)).flatMap((id) => meshCorners(meshOf.get(id)!, modelRoot));
    const { stop, behind } = sweep(a, own, others);
    for (const b of behind) waits.set(b.id, [...(waits.get(b.id) ?? []), a.id]);
    if (!stop) { out[i] = { ...a, limit: undefined }; return; }
    const sign = Math.sign((a.to ?? 0) - (a.from ?? 0)) || 1;
    // The vendor's own angle is kept (the warning still shows); a detected one opens only as far as is clear.
    out[i] = { ...a, limit: { angle: stop.angle, wanted: openAngle(a), by: stop.by }, ...(a.source === "manual" ? {} : { to: (a.from ?? 0) + sign * stop.angle }) };
  });
  return { ...config, animations: out.map((a) => ({ ...a, after: waits.get(a.id) })) };
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

/** A drawer box's boards: the front's own finish (paint, wood, laminate: colour, texture, maps) when the front is an
 * opaque board, else the body's (a glass or mirror front is no material for a box's sides and bottom). Always solid:
 * never transparent, transmissive or reflective, whatever it was copied from. The front itself is not touched. */
export function boardMaterial(front: Material | Material[], body?: Material | Material[] | null): Material {
  const first = (m: Material | Material[]) => (Array.isArray(m) ? m[0] : m);
  const f = first(front) as MeshStandardMaterial;
  const solid = layerOfLook(f as unknown as Parameters<typeof layerOfLook>[0]) === "solid" && !(f.transparent && f.opacity < 0.95) && (f.metalness ?? 0) < 0.5;
  const base = (solid || !body ? f : first(body)) as MeshStandardMaterial;
  const mat = base.clone() as MeshStandardMaterial & { transmission?: number; thickness?: number };
  mat.name = `${base.name || "board"} (drawer box)`;
  mat.transparent = false;
  mat.opacity = 1;
  if ("transmission" in mat) mat.transmission = 0;
  if ("thickness" in mat) mat.thickness = 0;
  mat.alphaTest = 0;
  mat.depthWrite = true;
  mat.side = FrontSide; // closed boards, faces outwards
  if (!solid) mat.metalness = 0; // the body's board, never a mirror's metal
  mat.needsUpdate = true;
  return mat;
}

/** A part's label without its front's material ("Drawer 1 smoked glass front" → "Drawer 1 front"): a wooden box or an
 * interior named "…glass…" would be taken for glass (wood choice, the request report). */
export const plainLabel = (label: string) =>
  label.replace(/\b(smoked|clear|frosted|tinted|reflective)?\s*(glass|glazed|mirrored|mirror)\b/gi, " ").replace(/(?:^|\s)(?:زجاج|مرآة|مراية)(?=\s|$)/g, " ").replace(/\s+/g, " ").trim() || label;

export type Added = { id: string; name: string; nameAr: string; mesh: Mesh; follows?: string };

/** A drawer already has a box: a part moving with its front reaches well behind it AND spans most of its outline (a
 * box's sides and bottom; not a rod, a runner or a fitting behind it), or a box was added for it before. */
export function hasDrawerBox(a: PartAnimation, frontLocal: Box3, boxesLocal: Map<string, Box3>, modelRoot: Object3D, depth: number): boolean {
  const fs = size(frontLocal);
  if (fs.z > 0.15 * depth) return true; // the moving part is the whole drawer itself (a frame and box round its front)
  if (a.follow.some((id) => {
    const b = boxesLocal.get(id);
    return b && b.min.z < frontLocal.min.z - 0.15 * depth
      && overlap(b.min.x, b.max.x, frontLocal.min.x, frontLocal.max.x) >= 0.6 * fs.x && overlap(b.min.y, b.max.y, frontLocal.min.y, frontLocal.max.y) >= 0.4 * fs.y;
  })) return true;
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
  // The body: the biggest fixed part (its board makes a drawer box behind a glass or mirror front).
  const carcass = [...fixed].sort((p, q) => volume(boxes.get(q.id)!) - volume(boxes.get(p.id)!))[0];
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
      mesh.userData.partId = id; // the same id however often the scene is prepared, and in a saved file
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
      const space = a.type === "translation" ? `Drawer space (${plainLabel(a.label)})` : `Interior (${plainLabel(a.label)})`;
      const spaceAr = a.type === "translation" ? `فراغ الدرج (${a.labelAr ?? a.label})` : `الفراغ الداخلي (${a.labelAr ?? a.label})`;
      place(openBox(x1 - x0, y1 - y0, d, 4), centre, interiorMaterial(body?.mesh.material ?? front.mesh.material, 0.82), `cavity_${a.component}`, space, spaceAr);
    }
    if (a.type !== "translation" || hasDrawerBox(a, fl, boxesLocal, modelRoot, depth) || d <= 0.02 * depth) continue;
    // The drawer box: as wide as the opening less runners, 80 % of its height, as deep as the body allows; it slides
    // no further than it is deep, so it never leaves the body.
    const w = (x1 - x0) * 0.96, h = (y1 - y0) * 0.8, boxDepth = d * 0.95;
    const t = Math.max(Math.min(0.06 * Math.min(w, h), 0.08 * boxDepth), 1e-4);
    if (Math.abs(a.distance ?? 0) > 0.85 * boxDepth) a.distance = Math.sign(a.distance ?? 1) * 0.85 * boxDepth;
    place(drawerBox(w, h, boxDepth, t), new Vector3((x0 + x1) / 2, y0 + h / 2, inner - boxDepth / 2), boardMaterial(front.mesh.material, carcass?.mesh.material),
      `drawer_box_${a.component}`, `Drawer box (${plainLabel(a.label)})`, `صندوق الدرج (${a.labelAr ?? a.label})`, a.id);
  }
  for (const [id, set] of remove) keepTriangles(slots.find((s) => s.id === id)!.mesh.geometry, (t) => !set.has(t));
  return added;
}

/** A door that is ONE mesh in ONE reflective material (a mirror door fused by the generator) shows the mirror on every
 * face, the inside and the edges too. Its back and edge faces are moved (not copied: nothing overlaps, so nothing
 * z-fights) into their own part, a wooden backing in the body's colour that moves with the door; the front keeps the
 * mirror. Judged in the door's shut pose, so a door the file shows open is split the same way. Glass is left whole
 * (a glass pane is glass all round), as is any door that already has a backing or frame of its own. Run again on its
 * own output, it finds nothing left to move. */
export function paneBacks(config: AnimationConfig | null, slots: SlotLike[], modelRoot: Object3D): Added[] {
  const added: Added[] = [];
  const meshOf = new Map(slots.map((s) => [s.id, s.mesh]));
  const moving = new Set((config?.animations ?? []).flatMap((a) => [a.component, ...a.follow]));
  const body = slots.filter((s) => !moving.has(s.id)).sort((a, b) => volume(boxInModel(b.mesh, modelRoot)) - volume(boxInModel(a.mesh, modelRoot)))[0];
  for (const a of config?.animations ?? []) {
    const door = meshOf.get(a.component);
    if (!a.enabled || a.type !== "rotation" || !door || Array.isArray(door.material)) continue;
    if (layerOfLook(door.material as MeshStandardMaterial) !== "mirror") continue;
    // Its own frame or backing (a solid part on it as big as a third of it) already covers the inside.
    const area = sheetArea(door);
    if (a.follow.some((id) => { const m = meshOf.get(id); return m && !Array.isArray(m.material) && layerOfLook(m.material as MeshStandardMaterial) === "solid" && sheetArea(m) >= 0.33 * area; })) continue;
    // The sheet's outward normal in its own geometry: its thinnest axis, pointing the way the shut door faces.
    const g = door.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const sz = g.boundingBox!.getSize(new Vector3());
    const thin = sz.x <= sz.y && sz.x <= sz.z ? new Vector3(1, 0, 0) : sz.y <= sz.z ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    modelRoot.updateMatrixWorld(true);
    const toModel = modelRoot.matrixWorld.clone().invert().multiply(door.matrixWorld);
    const shutNormal = thin.clone().transformDirection(toModel).transformDirection(turnAt(a, 0));
    const face = new Vector3(0, 0, 1).applyMatrix4(localFrame(a).clone().transpose());
    if (shutNormal.dot(face) < 0) thin.negate();
    const pos = g.getAttribute("position"), index = g.getIndex();
    const count = (index ? index.count : pos.count) / 3;
    const at = (k: number) => new Vector3().fromBufferAttribute(pos, index ? index.getX(k) : k);
    const front: boolean[] = [];
    for (let t = 0; t < count; t++) {
      const p0 = at(t * 3), n = at(t * 3 + 1).sub(p0).cross(at(t * 3 + 2).sub(p0));
      front.push(n.lengthSq() > 0 && n.normalize().dot(thin) > 0.7);
    }
    if (front.every(Boolean) || !front.some(Boolean)) continue;
    const backGeometry = g.clone();
    keepTriangles(backGeometry, (t) => !front[t]);
    keepTriangles(g, (t) => front[t]);
    const mesh = new Mesh(backGeometry, interiorMaterial(body?.mesh.material ?? new MeshStandardMaterial({ color: "#8a6a4a" }), 0.9));
    (mesh.material as MeshStandardMaterial).side = FrontSide;
    mesh.name = `Backing (${plainLabel(a.label)})`;
    mesh.userData.estimated = true;
    mesh.userData.partId = `backing_${a.component}`;
    mesh.position.copy(door.position);
    mesh.quaternion.copy(door.quaternion);
    mesh.scale.copy(door.scale);
    (door.parent ?? modelRoot).add(mesh);
    mesh.updateMatrixWorld(true);
    added.push({ id: `backing_${a.component}`, name: mesh.name, nameAr: `ظهر (${a.labelAr ?? a.label})`, mesh, follows: a.id });
  }
  return added;
}
const volume = (b: Box3) => { const s = size(b); return s.x * s.y * s.z; };

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
