import { AnimationClip, Box3, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type Mesh, type Object3D } from "three";

/** Movable parts (backend services/animation.py writes the detected ones): each a rigid move of ONE separate mesh,
 * and the estimated parts that travel with it (`follow`), in the model's own coordinates (the GLB's scene: y up,
 * +z front). Rotation: about `axis` through `pivot`, from `from`° to `to`°. Translation: `distance` along `axis`. */
export type Axis = "x" | "y" | "z";
export type Hinge = "left" | "right" | "top" | "bottom" | "back" | "front";
export type Direction = "front" | "back" | "left" | "right" | "up" | "down";
export type PartAnimation = {
  id: string;
  component: string;
  follow: string[];
  label: string;
  labelAr?: string | null;
  motion?: string;
  type: "rotation" | "translation";
  axis: Axis;
  pivot?: [number, number, number];
  hinge?: Hinge;
  from?: number;
  to?: number;
  direction?: Direction;
  distance?: number;
  unit: "degrees" | "meters";
  duration: number;
  enabled: boolean;
  confidence?: number;
  source: "vision" | "names" | "manual";
  issues: string[];
  /** What was estimated (a hinge side the photo does not show): informational, never disables the part. */
  notes?: string[];
  reason?: string;
  revealsInterior?: boolean;
  /** Where the part faces out, in the model's own coordinates (default "front"); a lid faces "up". With `up` and
   * `front` (the model's own up and front: a z-up file, a model facing sideways), the hinge edge and the opening
   * sign follow from these, for any orientation (withHinge). Saved with the animation. */
  face?: Direction;
  up?: Direction;
  front?: Direction;
  /** Older saves only: the file shows this part open, openness 0 was that pose and 1 shut it. Now such a part keeps
   * openness 0 = closed: `from` is the turn from the file's pose back to closed, `to` the turn to fully open. */
  rest?: "open";
  /** A collision stops the part before its configured angle (checkMovers): it opens to `angle`° instead of `wanted`°,
   * where it would hit `by`. */
  limit?: { angle: number; wanted: number; by: string };
  /** The parts in front of this one (a door before the drawer behind it, checkMovers): it starts opening once they are
   * open, and they close only once it is shut (step). Opening it opens them; closing one of them closes it (openPart). */
  after?: string[];
  /** The hinge side was not proven by hinges, a handle, the file's own open pose, a pair or the photo: the vendor
   * should confirm it (AnimationPanel). The door still opens, on the likelier side. */
  hingeUnsure?: boolean;
};
export type AnimationFlag = { label: string; labelAr?: string | null; motion?: string; component?: string; reason: string };
export type AnimationConfig = {
  version: 1;
  movable: boolean;
  animations: PartAnimation[];
  flagged: AnimationFlag[];
  source?: "vision" | "names" | "none" | "manual" | "assembly";
  /** Written by the backend's assembly (services/hybrid.py) and validated on the file: the editor adds nothing and
   * guesses nothing (authoritativeMovers); it still checks every movement for collisions. */
  authoritative?: boolean;
  /** Movements the photo did not clearly show (labels): the vendor confirms them before the model is published. */
  uncertain?: string[];
  interior?: { added: string[]; note: string };
  /** How far each part stands open (animation id → 0..1), as left by the user: restored on reopening. */
  state?: Openness;
  /** The vendor's answer to "Does this object have movable or interactive parts?" (null: not answered yet). */
  answer?: "yes" | "no" | null;
};

/** Open fraction per animation id: 0 closed, 1 fully open. */
export type Openness = Record<string, number>;

// The same table as the backend: hinge → axis, the pivot on the part's box (0 min, 1 max per axis), and the sign
// that swings the part out to the front (+z) / up, away from the body.
export const HINGES: Record<Hinge, { axis: Axis; at: [number, number, number]; sign: 1 | -1 }> = {
  left: { axis: "y", at: [0, 0.5, 1], sign: -1 },
  right: { axis: "y", at: [1, 0.5, 1], sign: 1 },
  bottom: { axis: "x", at: [0.5, 0, 1], sign: 1 },
  top: { axis: "x", at: [0.5, 1, 1], sign: -1 },
  back: { axis: "x", at: [0.5, 1, 0], sign: -1 },
  front: { axis: "x", at: [0.5, 1, 1], sign: 1 },
};
export const DIRECTIONS: Record<Direction, { axis: Axis; sign: 1 | -1 }> = {
  front: { axis: "z", sign: 1 }, back: { axis: "z", sign: -1 }, right: { axis: "x", sign: 1 }, left: { axis: "x", sign: -1 }, up: { axis: "y", sign: 1 }, down: { axis: "y", sign: -1 },
};
const UNIT: Record<Axis, Vector3> = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };

export const enabledAnimations = (config: AnimationConfig | null | undefined) =>
  config && config.answer !== "no" ? config.animations.filter((a) => a.enabled) : [];

export function hingePivot(box: Box3, hinge: Hinge): [number, number, number] {
  const { at } = HINGES[hinge];
  const pick = (i: 0 | 1 | 2) => box.min.getComponent(i) + (box.max.getComponent(i) - box.min.getComponent(i)) * at[i];
  return [pick(0), pick(1), pick(2)].map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number];
}

const VEC: Record<Direction, Vector3> = { front: new Vector3(0, 0, 1), back: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0), left: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0), down: new Vector3(0, -1, 0) };
/** Model → a moving part's own frame: +z where it faces out, +y the model's up, +x its right. A model lying on its
 * side or facing sideways is then judged exactly like a front-facing one (reconstruct.ts, drawer boxes below). */
export function localFrame(anim: Pick<PartAnimation, "face" | "up" | "front">): Matrix4 {
  const O = VEC[anim.face ?? anim.front ?? "front"].clone();
  let U = VEC[anim.up ?? "up"].clone();
  if (Math.abs(U.dot(O)) > 0.5) U = VEC[anim.front ?? "front"].clone(); // a lid faces up: its "up" is the model's front
  const R = new Vector3().crossVectors(U, O);
  return new Matrix4().makeBasis(R, U, O).transpose(); // orthonormal: the inverse is the transpose
}
const cornersOf = (b: Box3) => [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => new Vector3(x ? b.max.x : b.min.x, y ? b.max.y : b.min.y, z ? b.max.z : b.min.z))));
const inFrame = (b: Box3, m: Matrix4) => new Box3().setFromPoints(cornersOf(b).map((p) => p.applyMatrix4(m)));
/** Fixed fittings named after a drawer: the runners it slides on, a rail, the shelf over a stack of drawers. */
const DRAWER_FITTING = /\bdrawers?\b[\w\s]{0,24}?\b(runners?|rails?|slides?|tracks?|guides?|shelf|shelves|stack|divider)\b|\b(runners?|rails?|slides?|tracks?|guides?)\s+(of\s+)?(the\s+)?drawers?\b|(?:^|[\s\d_])(?:مجرى|مجاري|سكة)\s*(?:ال)?درج/i;
/** A drawer's own box, as a generated file or an earlier save names its pieces. */
const DRAWER_BOX = /\bdrawers?\b[\w\s]{0,24}?\b(box|side|sides|bottom|base|back|panel)\b|\b(box|side|bottom|base|back)\s+(of\s+)?(the\s+)?drawer\b|(?:^|[\s\d_])(?:صندوق|جانب|قاع|ظهر)\s*(?:ال)?درج(?=$|[\s\d_])/i;

/** The model direction nearest `v`. */
export const directionOf = (v: Vector3): Direction => (Object.keys(VEC) as Direction[]).reduce((best, d) => (VEC[d].dot(v) > VEC[best].dot(v) ? d : best), "front");
const axisOfVec = (v: Vector3): Axis => (Math.abs(v.x) >= Math.abs(v.y) && Math.abs(v.x) >= Math.abs(v.z) ? "x" : Math.abs(v.y) >= Math.abs(v.z) ? "y" : "z");

/** The part's frame: O where it faces out, U the model's up, F its front, R the right as seen facing the part. */
function partFrame(anim: Pick<PartAnimation, "face" | "up" | "front">, hinge: Hinge) {
  const U = VEC[anim.up ?? "up"], F = VEC[anim.front ?? "front"];
  const O = VEC[anim.face ?? (hinge === "back" || hinge === "front" ? anim.up ?? "up" : anim.front ?? "front")];
  const across = new Vector3().crossVectors(U, O);
  const R = across.lengthSq() > 0.5 ? across : new Vector3().crossVectors(U, F);
  return { U, F, O, R };
}

/** The widest a hinged part opens (degrees): a real door stops around here. */
export const MAX_SWING = 110;
/** A conventional hinged door's opening angle (degrees). */
export const DEFAULT_SWING = 95;
/** How far a turning part opens from closed (degrees). */
export const openAngle = (a: Pick<PartAnimation, "from" | "to">) => Math.abs((a.to ?? 0) - (a.from ?? 0));
/** The same opening direction, `angle`° from closed. */
export const withAngle = <A extends Pick<PartAnimation, "from" | "to">>(a: A, angle: number): A => ({ ...a, to: (a.from ?? 0) + (Math.sign((a.to ?? 0) - (a.from ?? 0)) || 1) * angle });

/** A rotation's settings for `hinge` on a part whose box (model coordinates) is `box`: the pivot on the hinge edge at
 * the outer face, the axis along that edge, and the sign that swings the free edge out (towards `face`), never
 * into the body. Works out the geometry for any facing (`face`, `up`, `front`; mirrored files too): left / right are
 * as seen standing in front of the part, top / bottom along the model's up, back / front (lids) along its front. */
export function withHinge(anim: PartAnimation, hinge: Hinge, box: Box3): PartAnimation {
  const { U, F, O, R } = partFrame(anim, hinge);
  const E = { left: R.clone().negate(), right: R.clone(), top: U.clone(), bottom: U.clone().negate(), back: F.clone().negate(), front: F.clone() }[hinge]; // centre → hinge edge
  const half = box.getSize(new Vector3()).multiplyScalar(0.5);
  const reach = (v: Vector3) => v.clone().multiply(half); // a unit axis vector → half the box along it
  const pivot = box.getCenter(new Vector3()).add(reach(E)).add(reach(O));
  const axis = axisOfVec(new Vector3().crossVectors(O, E));
  // The free edge (opposite the hinge) turned a quarter about +axis: out (along O) is the positive way, else negative.
  const sign = E.clone().negate().applyAxisAngle(UNIT[axis], Math.PI / 2).dot(O) > 0 ? 1 : -1;
  // The opening angle is measured from the closed pose (`from`): a door the file shows open keeps its offset.
  const from = anim.rest === "open" ? 0 : anim.from ?? 0;
  const angle = Math.min(anim.rest === "open" ? DEFAULT_SWING : anim.limit?.wanted ?? (openAngle(anim) || DEFAULT_SWING), MAX_SWING);
  return {
    ...anim, type: "rotation", hinge, axis, pivot: pivot.toArray().map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number],
    from, to: from + sign * angle, rest: undefined, limit: undefined, unit: "degrees", direction: undefined, distance: undefined,
  };
}

/** A slide's settings: `travel` metres towards `direction`. */
export function withDirection(anim: PartAnimation, direction: Direction, travel: number): PartAnimation {
  const { axis, sign } = DIRECTIONS[direction];
  return { ...anim, type: "translation", direction, axis, distance: sign * Math.abs(travel), unit: "meters", hinge: undefined, pivot: undefined, from: undefined, to: undefined };
}

type Rest = { position: Vector3; quaternion: Quaternion };

/** The mesh's pose at `t` (0..1) of `anim`: `toParent` maps model coordinates to the mesh's parent space. Rigid:
 * position and rotation only; scale and geometry never change. */
export function poseAt(rest: Rest, anim: PartAnimation, t: number, toParent: Matrix4): Rest {
  if (anim.type === "rotation") {
    const pivot = new Vector3(...(anim.pivot ?? [0, 0, 0]));
    const p = pivot.clone().applyMatrix4(toParent);
    const axis = pivot.clone().add(UNIT[anim.axis]).applyMatrix4(toParent).sub(p).normalize();
    const degrees = (anim.from ?? 0) + ((anim.to ?? 0) - (anim.from ?? 0)) * t;
    const q = new Quaternion().setFromAxisAngle(axis, (degrees * Math.PI) / 180);
    return { position: rest.position.clone().sub(p).applyQuaternion(q).add(p), quaternion: q.multiply(rest.quaternion) };
  }
  const a = new Vector3().applyMatrix4(toParent);
  const b = UNIT[anim.axis].clone().multiplyScalar((anim.distance ?? 0) * t).applyMatrix4(toParent);
  return { position: rest.position.clone().add(b.sub(a)), quaternion: rest.quaternion.clone() };
}

/** Model coordinates → the mesh's parent space (the model may be scaled, turned and placed in a room). */
export function toParentOf(mesh: Object3D, modelRoot: Object3D): Matrix4 {
  modelRoot.updateMatrixWorld(true);
  const parent = mesh.parent ?? modelRoot;
  return parent.matrixWorld.clone().invert().multiply(modelRoot.matrixWorld);
}

/** A part's box in model coordinates (for pivots and travel when editing). */
export function boxInModel(mesh: Mesh, modelRoot: Object3D): Box3 {
  modelRoot.updateMatrixWorld(true);
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  return mesh.geometry.boundingBox!.clone().applyMatrix4(toModel);
}

type SlotLike = { id: string; mesh: Mesh };

/** The meshes an animation moves: its part and the parts that follow it, once each. */
export function meshesOf(slots: SlotLike[], anim: PartAnimation): Mesh[] {
  const ids = new Set([anim.component, ...anim.follow]);
  return [...new Set(slots.filter((s) => ids.has(s.id)).map((s) => s.mesh))];
}

/** Why this animation cannot play as it is (empty: it can). Only separate meshes move; never a mesh that other parts
 * share, never the whole model. */
export function problems(anim: PartAnimation, slots: SlotLike[]): string[] {
  const out: string[] = [];
  const own = slots.filter((s) => s.id === anim.component);
  if (!own.length) return ["This part is not in the model."];
  const mesh = own[0].mesh;
  const sharing = slots.filter((s) => s.mesh === mesh && s.id !== anim.component && !anim.follow.includes(s.id));
  if (sharing.length) out.push("This part shares one mesh with other parts: they would move with it.");
  if (new Set(slots.map((s) => s.mesh)).size < 2) out.push("The model is one mesh: moving it would move the whole object.");
  if (anim.type === "rotation" && (!anim.pivot || Math.abs((anim.to ?? 0) - (anim.from ?? 0)) > 180)) out.push("Turning parts need a hinge and at most 180°.");
  if (anim.type === "translation" && !anim.distance) out.push("Sliding parts need a distance.");
  return out;
}

/** Puts every enabled animation at its open fraction, on top of the meshes' current (rest) pose: call it after the
 * rest pose is restored (applyPoses). */
export function applyAnimations(slots: SlotLike[], modelRoot: Object3D, config: AnimationConfig | null | undefined, open: Openness) {
  for (const anim of enabledAnimations(config)) {
    const t = Math.min(Math.max(open[anim.id] ?? 0, 0), 1);
    if ((!t && !anim.from) || problems(anim, slots).length) continue; // closed is the file's pose unless `from` says not
    for (const mesh of meshesOf(slots, anim)) {
      const pose = poseAt({ position: mesh.position.clone(), quaternion: mesh.quaternion.clone() }, anim, t, toParentOf(mesh, modelRoot));
      mesh.position.copy(pose.position);
      mesh.quaternion.copy(pose.quaternion);
    }
  }
}

/** The same movements for a file saved with every part shut: `from` (the turn from the file's pose to shut) is 0. */
export function fromClosed(config: AnimationConfig | null | undefined): AnimationConfig | null | undefined {
  if (!config) return config;
  return { ...config, animations: config.animations.map((a) => (a.type === "rotation" && a.from ? { ...a, from: 0, to: (a.to ?? 0) - a.from } : a)) };
}

const STEPS = 8;

/** glTF animation clips (one per enabled animation, "open_<part>"), sampled from the rest pose: the exported file
 * plays them in any viewer. Call with the model at rest. */
export function animationClips(slots: SlotLike[], modelRoot: Object3D, config: AnimationConfig | null | undefined): AnimationClip[] {
  return enabledAnimations(config)
    .filter((anim) => !problems(anim, slots).length)
    .map((anim) => {
      const times = Array.from({ length: STEPS + 1 }, (_, i) => (anim.duration * i) / STEPS);
      const tracks = meshesOf(slots, anim).flatMap((mesh) => {
        const rest = { position: mesh.position.clone(), quaternion: mesh.quaternion.clone() };
        const toParent = toParentOf(mesh, modelRoot);
        const poses = times.map((_, i) => poseAt(rest, anim, i / STEPS, toParent));
        return [
          new VectorKeyframeTrack(`${mesh.uuid}.position`, times, poses.flatMap((p) => p.position.toArray())),
          new QuaternionKeyframeTrack(`${mesh.uuid}.quaternion`, times, poses.flatMap((p) => p.quaternion.toArray())),
        ];
      });
      return new AnimationClip(`open_${anim.component}`, anim.duration, tracks);
    });
}

/** True when the part is showing open. A door authored open is open at 0 and shut at 1. */
export function shownOpen(anim: Pick<PartAnimation, "rest">, t: number): boolean {
  return anim.rest === "open" ? t < 0.5 : t >= 0.5;
}

/** The openness value that shows the part open or shut. */
export function targetFor(anim: Pick<PartAnimation, "rest">, open: boolean): number {
  return anim.rest === "open" ? (open ? 0 : 1) : (open ? 1 : 0);
}

/** The target with what a part's opening needs: the parts in front of an opening part open too (a drawer behind a
 * door opens its door), so nothing passes through a shut door. */
export function withFront(config: AnimationConfig | null | undefined, target: Openness): Openness {
  const out = { ...target };
  const byId = new Map((config?.animations ?? []).map((a) => [a.id, a]));
  const open = (id: string, seen: Set<string>) => {
    for (const f of byId.get(id)?.after ?? []) if (!seen.has(f)) { seen.add(f); out[f] = Math.max(out[f] ?? 0, 1); open(f, seen); }
  };
  for (const [id, t] of Object.entries(target)) if (t > 0) open(id, new Set([id]));
  return out;
}

/** Opens or shuts one part: opening also opens the parts in front of it; shutting also shuts the parts behind it. */
export function openPart(config: AnimationConfig | null | undefined, target: Openness, id: string, value: number): Openness {
  const out = { ...target, [id]: value };
  if (value > 0) return withFront(config, out);
  const close = (front: string) => {
    for (const a of config?.animations ?? []) if (a.after?.includes(front) && (out[a.id] ?? 0) > 0) { out[a.id] = 0; close(a.id); }
  };
  close(id);
  return out;
}

const SETTLED = 0.999;
/** Steps each open fraction towards its target (at the animation's own speed): true while anything still moves. A part
 * behind another (`after`) starts opening once the parts in front are open, and those close once it is shut. */
export function step(current: Openness, target: Openness, config: AnimationConfig | null | undefined, dt: number): boolean {
  let moving = false;
  const goals = withFront(config, target);
  const animations = config?.animations ?? [];
  for (const anim of animations) {
    const now = current[anim.id] ?? 0;
    const goal = anim.enabled && config?.answer !== "no" ? goals[anim.id] ?? 0 : 0;
    if (now === goal) continue;
    const waiting = goal > now
      ? (anim.after ?? []).some((f) => (current[f] ?? 0) < SETTLED * Math.max(goals[f] ?? 0, 1e-9) || (goals[f] ?? 0) <= 0)
      : animations.some((b) => b.after?.includes(anim.id) && (current[b.id] ?? 0) > 1 - SETTLED);
    if (waiting) { moving = true; continue; }
    const delta = dt / Math.max(anim.duration, 0.05);
    current[anim.id] = goal > now ? Math.min(goal, now + delta) : Math.max(goal, now - delta);
    moving = true;
  }
  return moving;
}

/** A new, hand-made animation for a part (the vendor adds one the detection missed): a left-hinged door. */
export function manualAnimation(component: string, label: string, box: Box3): PartAnimation {
  return withHinge(
    { id: `anim_${component}_${Date.now().toString(36)}`, component, follow: [], label, type: "rotation", axis: "y", unit: "degrees", duration: 0.8, enabled: true, source: "manual", issues: [], to: 95 },
    "left",
    box,
  );
}

// ---- detection from the real meshes (every model, old ones too) ----

type Kind = { motion: string; build: (a: PartAnimation, box: Box3, whole: Box3) => PartAnimation };
const turn = (hinge: Hinge, degrees: number) => (a: PartAnimation, box: Box3) => withHinge({ ...a, to: degrees }, hinge, box);
const slide = (a: PartAnimation, _box: Box3, whole: Box3) => withDirection(a, "front", 0.5 * (whole.max.z - whole.min.z));
/** Movable parts by name, any object type (English and Arabic words in the part's id or name). */
const KINDS: [RegExp, Kind][] = [
  [/\b(drawers?|tray)\b|(?:^|[\s\d_])(?:ال)?(?:درج|أدراج)(?=$|[\s\d_])/i, { motion: "slide", build: slide }],
  [/\b(flap|fall[ _-]?front)\b|(?:^|[\s\d_])(?:ال)?(?:غطاء أمامي)(?=$|[\s\d_])/i, { motion: "fold", build: turn("bottom", 90) }],
  [/\b(lid|hatch|top[ _-]?cover)\b|(?:^|[\s\d_])(?:ال)?(?:غطاء)(?=$|[\s\d_])/i, { motion: "lift", build: turn("back", 80) }],
  [/\b(doors?|leaf|leaves|gate)\b|(?:^|[\s\d_])(?:ال)?(?:باب|أبواب|ضلفة|ضلف)(?=$|[\s\d_])/i, { motion: "rotate", build: turn("left", 95) }],
];
const words = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ");
export function moverKind(...names: (string | null | undefined)[]): Kind | null {
  const text = words(names.filter(Boolean).join(" "));
  if (DRAWER_BOX.test(text)) return null; // a drawer's side, bottom or back slides with its front, not on its own
  if (DRAWER_FITTING.test(text)) return null; // a runner, rail or the shelf over a drawer stack stays in the carcass
  // On a door, not a door ("door lock key ring", "mirror door backing", "drawer box", "interior (door 1)").
  // A runner is part of the drawer, not a second drawer. "frame" here is a doorway surround, not a door leaf.
  if (/\b(handles?|knobs?|pulls?|hinges?|runners?|frame|body|carcass|lock|locks|key|keys|keyhole|ring|blade|tooth|teeth|backing|surround|trim|strip|mou?lding|decor|decoration|ornament|escutcheon|plate|interior|cavity|space|box)\b|(?:^|[\s\d_])(?:ال)?(?:مقبض|مقابض|مفصلة|هيكل|إطار|قفل|مفتاح|حلقة|زخرفة|حلية|فراغ|صندوق|داخلي)(?=$|[\s\d_])/i.test(text)) return null;
  return KINDS.find(([re]) => re.test(text))?.[1] ?? null;
}
/** Named a door / drawer / lid at all, accessory words included ("Mirror door backing"): for a part big enough to be one. */
const namedMover = (...names: (string | null | undefined)[]) => KINDS.find(([re]) => re.test(words(names.filter(Boolean).join(" "))))?.[1] ?? null;

const size = (b: Box3) => b.getSize(new Vector3());
const area = (b: Box3) => size(b).x * size(b).y;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const outlineShare = (a: Box3, b: Box3) => overlap(a.min.x, a.max.x, b.min.x, b.max.x) * overlap(a.min.y, a.max.y, b.min.y, b.max.y);
/** Big enough to be a door or a drawer front: 12 % of the model's front, or a tall thin front panel (a narrow door of a
 * wide wardrobe is far less than 12 % of it). */
/** The part's own size, ignoring the swing it was saved in (a door posed open is still a thin sheet). */
function sheetSize(mesh: Mesh): Vector3 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const s = mesh.geometry.boundingBox!.getSize(new Vector3());
  const scale = new Vector3();
  mesh.getWorldScale(scale);
  return new Vector3(Math.abs(s.x * scale.x), Math.abs(s.y * scale.y), Math.abs(s.z * scale.z));
}
export const sheetArea = (mesh: Mesh) => {
  const [long, mid] = [sheetSize(mesh).x, sheetSize(mesh).y, sheetSize(mesh).z].sort((a, b) => b - a);
  return long * mid;
};
/** Big enough to be a door or a drawer front, measured on the sheet rather than its swung bounding box. */
const frontPanel = (mesh: Mesh, whole: Box3) => {
  const dims = [sheetSize(mesh).x, sheetSize(mesh).y, sheetSize(mesh).z].sort((a, b) => a - b);
  const w = size(whole);
  const span = Math.max(w.x, w.y, w.z, 1e-6);
  return dims[1] * dims[2] >= 0.12 * w.x * w.y || (dims[2] >= 0.35 * span && dims[1] >= 0.04 * span && dims[0] <= 0.15 * span);
};
const RUNNER = /\brunners?\b|(?:^|[\s\d_])(?:ال)?(?:مجرى|مجرى درج)(?=$|[\s\d_])/i;

/** Structural parts never ride on a door or drawer, wherever they are (they hold the object together). */
const STRUCTURAL = /\b(shelf|shelves|rail|rod|body|carcass|cabinet|back|plinth|base|divider|partition|side|frame|leg|top)\b|(?:^|[\s\d_])(?:ال)?(?:رف|رفوف|قضيب|هيكل|ظهر|قاعدة|فاصل|جانب|رجل|أرجل|إطار|لوح خلفي)(?=$|[\s\d_])/i; // Arabic as whole words (\b is ASCII only: "رف" is in "زخرفة")
/** Accessory words win over structural ones: "Mirror surround top", "handle base" ride on their door. */
const ACCESSORY_WORDS = /\b(handles?|knobs?|pulls?|locks?|keys?|keyhole|ring|surround|trim|strip|mou?lding|decor|decoration|ornament|escutcheon|mirror|glass)\b|(?:^|[\s\d_])(?:ال)?(?:مقبض|مقابض|قفل|مفتاح|حلقة|زخرفة|حلية|مرآة|زجاج)(?=$|[\s\d_])/i;
const structural = (name: string) => STRUCTURAL.test(name) && !ACCESSORY_WORDS.test(name);

/** Is `b` attached to the front of the moving part `box` (so it moves with it)? Not mere overlap: it must lie within
 * the part's outline, touch its front face (or sit inside the panel), be no deeper than a trim, and be no bigger than
 * the part itself. Handles, knobs, mouldings, arch panels, glass and trim pass; shelves behind a door do not. */
export function attachedTo(box: Box3, b: Box3, wholeDepth: number): boolean {
  const s = size(box), f = size(b);
  const within = overlap(b.min.x, b.max.x, box.min.x, box.max.x) >= 0.8 * f.x && overlap(b.min.y, b.max.y, box.min.y, box.max.y) >= 0.8 * f.y;
  const reach = Math.max(0.015, 0.5 * s.z); // glued on its face (rounding included) or set into the panel
  const touching = b.min.z >= box.min.z - reach && b.min.z <= box.max.z + reach;
  const thin = f.z <= Math.max(3 * s.z, 0.08 * wholeDepth);
  return within && touching && thin && f.x * f.y <= 1.05 * s.x * s.y;
}

/** The parts attached to a moving part's front (attachedTo), not movable themselves and not structural by name. */
export function partsOn(box: Box3, boxes: Map<string, Box3>, skip: Set<string>, names: Map<string, string> = new Map(), wholeDepth = 1): string[] {
  return [...boxes].filter(([id, b]) => !skip.has(id) && !structural(words(names.get(id) ?? "")) && attachedTo(box, b, wholeDepth)).map(([id]) => id);
}

/** Parts held by what is already on a moving part (a handle's pull on its mounting feet, a key in its lock, a mirror
 * in its surround): touching one of them, within the part's outline, in front of its back face, and small next to
 * it. Repeated until nothing more joins. Structural parts never join. */
export function chainedTo(box: Box3, on: string[], boxes: Map<string, Box3>, skip: Set<string>, names: Map<string, string> = new Map()): string[] {
  const s = size(box);
  const gap = 0.004 * Math.max(...s.toArray()) + 1e-4;
  const out = [...on];
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, b] of boxes) {
      if (skip.has(id) || out.includes(id) || structural(words(names.get(id) ?? ""))) continue;
      const f = size(b);
      const within = overlap(b.min.x, b.max.x, box.min.x, box.max.x) >= 0.8 * f.x && overlap(b.min.y, b.max.y, box.min.y, box.max.y) >= 0.8 * f.y;
      const small = f.x * f.y <= 0.25 * s.x * s.y && b.min.z >= box.min.z - gap;
      if (!within || !small) continue;
      const near = b.clone().expandByScalar(gap);
      if (out.some((o) => boxes.get(o)!.intersectsBox(near))) {
        out.push(id);
        grew = true;
      }
    }
  }
  return out.slice(on.length);
}

/** Is `child` within `host`'s face outline (at least 80% of it on both of the host's two largest axes)? Orientation
 * free: a door facing any way is a sheet, and what is mounted on it lies over it. A part beside it (on the next door)
 * is not, whatever a vision relation or its name says. Catalogue model 363f2fbd: the reading drew door 1's grip on the
 * line between doors 1 and 2 and tied it to door 2, which then carried two handles while door 1 hit its own grip and
 * opened 0°. */
export function withinFace(host: Box3, child: Box3): boolean {
  const hs = size(host), cs = size(child);
  const axes = (["x", "y", "z"] as const).slice().sort((a, b) => hs[b] - hs[a]).slice(0, 2);
  return axes.every((k) => overlap(child.min[k], child.max[k], host.min[k], host.max[k]) >= 0.8 * Math.max(cs[k], 1e-6));
}

/** Vision analysis relations (child part id → the part it is attached to), by the generated meshes' part ids. */
export function attachmentsFrom(doc: { components?: { id: string; analysisId?: string }[]; analysis?: { components?: Record<string, unknown>[] } } | null | undefined): Record<string, string> {
  const byAnalysis = new Map((doc?.components ?? []).filter((c) => c.analysisId).map((c) => [c.analysisId!, c.id]));
  const out: Record<string, string> = {};
  for (const c of doc?.analysis?.components ?? []) {
    const child = byAnalysis.get(String(c.id));
    const rel = ((c.relations as { type: string; target: string }[] | undefined) ?? []).find((r) => r.type === "attached_to" || r.type === "on");
    const parent = rel && byAnalysis.get(rel.target);
    if (child && parent) out[child] = parent;
  }
  return out;
}

const HANDLE = /\b(handles?|knobs?|pulls?)\b|(?:^|[\s\d_])(?:ال)?(?:مقبض|مقابض)(?=$|[\s\d_])/i;
const HINGE_PART = /\bhinges?\b|(?:^|[\s\d_])(?:ال)?(?:مفصلة|مفصلات)(?=$|[\s\d_])/i;

/** Which side edge a door turns on (left / right as seen facing it; `R` its right in model coordinates), from the best
 * evidence there is: hinge hardware on it; else its handle (named, or the small parts clearly off its centre: a centred
 * moulding or mirror frame says nothing), the hinge being opposite; else the vision analysis' side (`prior`); else the
 * outer side of a pair of doors; else the side nearer the model's edge, which is a guess (`sure` false: the vendor
 * should check it). */
export function hingeFromGeometry(box: Box3, on: { box: Box3; name: string }[], doors: Box3[], whole: Box3, R: Vector3 = new Vector3(1, 0, 0), prior?: Hinge): [Hinge, string, boolean] {
  const along = (b: Box3) => b.getCenter(new Vector3()).dot(R);
  const cx = along(box);
  const width = Math.abs(size(box).dot(R)) || 1e-6;
  const mean = (list: { box: Box3 }[]) => list.reduce((sum, p) => sum + along(p.box) - cx, 0) / list.length;
  const side = (offset: number): Hinge => (offset > 0 ? "right" : "left");
  const opposite = (offset: number): Hinge => (offset > 0 ? "left" : "right");
  const hinges = on.filter((p) => HINGE_PART.test(words(p.name)));
  if (hinges.length && Math.abs(mean(hinges)) > 0.15 * width) return [side(mean(hinges)), "on its hinges", true];
  const named = on.filter((p) => HANDLE.test(words(p.name)));
  if (named.length) {
    const off = mean(named);
    if (Math.abs(off) > 0.05 * width) return [opposite(off), "hinge opposite the handle", true];
  } else {
    const big = Math.max(...size(box).toArray());
    const offs = on.filter((p) => Math.max(...size(p.box).toArray()) < 0.3 * big).map((p) => along(p.box) - cx).filter((o) => Math.abs(o) >= 0.1 * width);
    const plus = offs.filter((o) => o > 0).length;
    if (offs.length && (plus >= (2 / 3) * offs.length || plus <= offs.length / 3)) return [opposite(plus > offs.length / 2 ? 1 : -1), "hinge opposite the handle", true];
  }
  if (prior === "left" || prior === "right") return [prior, "the photo analysis", true];
  const gap = 0.03 * Math.abs(size(whole).dot(R));
  const level = (d: Box3) => overlap(d.min.y, d.max.y, box.min.y, box.max.y) > 0.5 * size(box).y || overlap(d.min.z, d.max.z, box.min.z, box.max.z) > 0.5 * size(box).z;
  const lo = (b: Box3) => along(b) - Math.abs(size(b).dot(R)) / 2, hi = (b: Box3) => along(b) + Math.abs(size(b).dot(R)) / 2;
  const right = doors.some((d) => level(d) && Math.abs(lo(d) - hi(box)) < gap);
  const left = doors.some((d) => level(d) && Math.abs(hi(d) - lo(box)) < gap);
  if (right !== left) return [right ? "left" : "right", "outer side of a pair of doors", true];
  return [cx <= along(whole) ? "left" : "right", "a guess (the side nearer the model's edge): check it", false];
}

/** The model's own up and front (its file may be z-up or face sideways): from the viewer's orientation (the "fit"
 * group of lib/plan/modelNormalization.ts above `modelRoot`); y up, +z front without one. */
export function modelFrame(modelRoot: Object3D): { up: Direction; front: Direction } {
  let fit: Object3D | null = modelRoot.parent;
  while (fit && fit.name !== "fit") fit = fit.parent;
  if (!fit) return { up: "up", front: "front" };
  modelRoot.updateWorldMatrix(true, false);
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(fit.matrixWorld);
  return { up: directionOf(new Vector3(0, 1, 0).transformDirection(toModel)), front: directionOf(new Vector3(0, 0, 1).transformDirection(toModel)) };
}

/** Where a moving part faces out: the outer side of the fixed structure (`whole`: without moving parts, what they
 * carry or small fittings) it sits flush with or stands out from (a door on the back faces back, a
 * lid on top faces up). Flush with several (a full-width drawer): the one across its thinnest side, else the model's
 * front. Flush with none (a part inside): the model's front. */
export function faceOf(box: Box3, whole: Box3, frame: { up: Direction; front: Direction }): Direction {
  const s = size(box);
  const thin = s.x <= s.y && s.x <= s.z ? 0 : s.y <= s.z ? 1 : 2;
  const ways = (Object.keys(VEC) as Direction[]).filter((d) => VEC[d].dot(VEC[frame.up]) > -0.5); // never down
  const gap = (d: Direction) => {
    const v = VEC[d], i = Math.abs(v.x) > 0.5 ? 0 : Math.abs(v.y) > 0.5 ? 1 : 2;
    return v.getComponent(i) > 0 ? whole.max.getComponent(i) - box.max.getComponent(i) : box.min.getComponent(i) - whole.min.getComponent(i);
  };
  const flush = ways.filter((d) => gap(d) <= 0.03 * Math.abs(size(whole).dot(VEC[d])) + 1e-4); // or beyond it
  // Only a side across the thin axis is the face. A tall door whose top touches the cabinet is not a lid.
  const alongThin = flush.filter((d) => Math.abs(VEC[d].getComponent(thin)) > 0.5);
  return alongThin.find((d) => d === frame.front) ?? alongThin[0] ?? frame.front;
}

/** Model → the part's own sheet: +z along its thin axis (whichever way it is swung), +y up the sheet. */
function sheetFrame(mesh: Mesh, modelRoot: Object3D): Matrix4 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const s = mesh.geometry.boundingBox!.getSize(new Vector3());
  const thin = s.x <= s.y && s.x <= s.z ? new Vector3(1, 0, 0) : s.y <= s.z ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const normal = thin.transformDirection(toModel).normalize();
  let up = new Vector3(0, 1, 0);
  if (Math.abs(up.dot(normal)) > 0.85) up = new Vector3(1, 0, 0);
  const x = new Vector3().crossVectors(up, normal).normalize();
  const y = new Vector3().crossVectors(normal, x).normalize();
  return new Matrix4().makeBasis(x, y, normal).transpose();
}

/** The sheet's thin axis in model space. */
function sheetNormal(mesh: Mesh, modelRoot: Object3D): Vector3 {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const s = mesh.geometry.boundingBox!.getSize(new Vector3());
  const thin = s.x <= s.y && s.x <= s.z ? new Vector3(1, 0, 0) : s.y <= s.z ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  return thin.transformDirection(modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld)).normalize();
}

/** Glass or a mirror lying on a door's sheet (the door may already be swung, so a world box is the wrong test). */
function onSheet(host: Mesh, child: Mesh, modelRoot: Object3D): boolean {
  // A door swung open is not on the closed door beside it: their sheets point different ways.
  if (Math.abs(sheetNormal(host, modelRoot).dot(sheetNormal(child, modelRoot))) < 0.98) return false;
  const frame = sheetFrame(host, modelRoot);
  const hb = inFrame(boxInModel(host, modelRoot), frame);
  const cb = inFrame(boxInModel(child, modelRoot), frame);
  const f = size(cb);
  const within = overlap(cb.min.x, cb.max.x, hb.min.x, hb.max.x) >= 0.8 * f.x && overlap(cb.min.y, cb.max.y, hb.min.y, hb.max.y) >= 0.8 * f.y;
  const near = Math.abs(cb.getCenter(new Vector3()).z - hb.getCenter(new Vector3()).z) <= Math.max(size(hb).z, 0.03) + 0.04;
  return within && near && sheetArea(child) <= 1.05 * sheetArea(host);
}

/** The hinge point on the real sheet, not on the box of a door that is already swung open. */
function pivotOnMesh(mesh: Mesh, modelRoot: Object3D, anim: PartAnimation): [number, number, number] {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const bb = mesh.geometry.boundingBox!;
  const corners = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => new Vector3(x ? bb.max.x : bb.min.x, y ? bb.max.y : bb.min.y, z ? bb.max.z : bb.min.z).applyMatrix4(toModel))));
  const center = corners.reduce((sum, c) => sum.add(c), new Vector3()).multiplyScalar(1 / corners.length);
  const { U, F, O, R } = partFrame(anim, anim.hinge ?? "left");
  const E = { left: R.clone().negate(), right: R.clone(), top: U.clone(), bottom: U.clone().negate(), back: F.clone().negate(), front: F.clone() }[anim.hinge ?? "left"];
  const dir = E.clone().normalize().add(O.clone().normalize());
  const axis = new Vector3().crossVectors(O, E);
  if (axis.lengthSq() < 1e-8) axis.copy(U);
  axis.normalize();
  const corner = corners.reduce((best, c) => (c.dot(dir) > best.dot(dir) ? c : best));
  // Midpoint of the hinge edge: the corner nearest the hinge, then centred along that edge.
  const pivot = corner.clone().addScaledVector(axis, center.dot(axis) - corner.dot(axis));
  return pivot.toArray().map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number];
}

/** The two upright edges of a door's sheet (model coordinates, mid-height, mid-thickness), wherever it is turned: the
 * hinge is on one of them. */
export function sheetEdges(mesh: Mesh, modelRoot: Object3D, up: Vector3): [Vector3, Vector3] {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox!;
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const s = bb.getSize(new Vector3()), c = bb.getCenter(new Vector3());
  const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  const along = axes.map((a) => Math.abs(a.clone().transformDirection(toModel).dot(up)));
  const upright = along.indexOf(Math.max(...along));
  const rest = [0, 1, 2].filter((i) => i !== upright);
  const width = s.getComponent(rest[0]) >= s.getComponent(rest[1]) ? rest[0] : rest[1];
  const half = axes[width].clone().multiplyScalar(s.getComponent(width) / 2);
  return [c.clone().sub(half).applyMatrix4(toModel), c.clone().add(half).applyMatrix4(toModel)];
}

/** Degrees this sheet is swung out from the closed face, about the hinge axis. 0: it is already shut. */
export function authoredSwing(mesh: Mesh, modelRoot: Object3D, anim: Pick<PartAnimation, "face" | "axis">): number {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const s = mesh.geometry.boundingBox!.getSize(new Vector3());
  const thin = s.x <= s.y && s.x <= s.z ? new Vector3(1, 0, 0) : s.y <= s.z ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
  const toModel = modelRoot.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const normal = thin.transformDirection(toModel).normalize();
  const face = VEC[anim.face ?? "front"];
  if (normal.dot(face) < 0) normal.negate();
  const axis = UNIT[anim.axis];
  const n = normal.addScaledVector(axis, -normal.dot(axis));
  const f = face.clone().addScaledVector(axis, -face.dot(axis));
  if (n.lengthSq() < 1e-8 || f.lengthSq() < 1e-8) return 0;
  n.normalize();
  f.normalize();
  return Math.atan2(new Vector3().crossVectors(f, n).dot(axis), f.dot(n)) * 180 / Math.PI;
}

/** A door modelled open: its hinge edge, side and pivot, from the file itself. The edge with the door's hinge hardware
 * when it has some; else the edge that stayed at the cabinet (the free edge swings out, away from it). The side is
 * where that edge is, seen from the front, against where the free edge would close to. Null when the door is shut. */
function hingeOfOpen(leaf: Mesh, modelRoot: Object3D, anim: PartAnimation, carried: { box: Box3; name: string }[], up: Vector3, R: Vector3): { hinge: Hinge; why: string; pivot: [number, number, number] } | null {
  const face = anim.face ?? "front";
  const swung = authoredSwing(leaf, modelRoot, { face, axis: axisOfVec(up) });
  if (Math.abs(swung) <= 12) return null;
  const [a, b] = sheetEdges(leaf, modelRoot, up);
  const flat = (v: Vector3) => v.clone().addScaledVector(up, -v.dot(up));
  const hardware = carried.filter((p) => HINGE_PART.test(words(p.name))).map((p) => p.box.getCenter(new Vector3()));
  let edge: Vector3, why: string;
  if (hardware.length) {
    const at = hardware.reduce((sum, h) => sum.add(h), new Vector3()).multiplyScalar(1 / hardware.length);
    edge = flat(a).distanceTo(flat(at)) <= flat(b).distanceTo(flat(at)) ? a : b;
    why = "on its hinges (modelled open)";
  } else {
    const O = VEC[face];
    edge = a.dot(O) <= b.dot(O) ? a : b; // the free edge stands out in front; the hinge edge stays at the cabinet
    why = "the edge that stays at the cabinet (modelled open)";
  }
  const free = edge === a ? b : a;
  // Closed, the free edge lies beside the hinge across the front: its side of the hinge is where the door is.
  const axisUp = up.clone().normalize();
  const closedFree = free.clone().sub(edge).applyAxisAngle(axisUp, -swung * Math.PI / 180);
  const hinge: Hinge = closedFree.dot(R) > 0 ? "left" : "right";
  const pivot = edge.toArray().map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number];
  return { hinge, why, pivot };
}

/** The hinge line a saved file records on its door (exportGlb writes `hingeLine`, model coordinates): the door turns
 * on exactly the line it turned on before it was saved; its side is where that line is across the door. */
function recordedHinge(leaf: Mesh, box: Box3, R: Vector3): { hinge: Hinge; why: string; pivot: [number, number, number] } | null {
  const line = leaf.userData?.hingeLine as [number, number, number] | undefined;
  if (!Array.isArray(line) || line.length !== 3 || !line.every(Number.isFinite)) return null;
  const hinge: Hinge = new Vector3(...line).sub(box.getCenter(new Vector3())).dot(R) < 0 ? "left" : "right";
  return { hinge, why: "the hinge recorded in the file", pivot: line };
}

/** The animations checked against the real meshes, at rest: pivots on each part's real box, side hinges from the
 * geometry, the parts on each front moving with it, every door / drawer / flap / lid found by name added, and each
 * one enabled when it can really move on its own. The vendor's own changes ("manual") are kept as they are. */
export function refine(
  config: AnimationConfig | null | undefined,
  slots: (SlotLike & { name?: string; nameAr?: string | null })[],
  modelRoot: Object3D,
  /** The vision analysis' "attached to" relations (attachmentsFrom): child part → parent part. */
  attached: Record<string, string> = {},
): AnimationConfig | null {
  const parts = [...new Map(slots.map((s) => [s.id, s])).values()];
  if (parts.length < 2 && !config) return null;
  const frame = modelFrame(modelRoot);
  const boxes = new Map(parts.map((p) => [p.id, boxInModel(p.mesh, modelRoot)]));
  const whole = [...boxes.values()].reduce((all, b) => all.union(b), new Box3());
  const names = new Map(parts.map((p) => [p.id, `${p.id} ${p.name ?? ""} ${p.nameAr ?? ""}`]));
  const depth = size(whole).z;
  // A saved name guess that is an accessory ("door lock key ring") is no moving part: it rides on its door instead.
  const partOf = new Map(parts.map((p) => [p.id, p]));
  // A frame around a separate door leaf (a doorway's frame) stays put; a frame holding glass or a mirror is the door.
  const surroundsLeaf = (id: string, box: Box3) => parts.some((o) => {
    if (o.id === id || !moverKind(o.id, o.name, o.nameAr) || ACCESSORY_WORDS.test(words(names.get(o.id) ?? ""))) return false;
    const b = boxes.get(o.id)!;
    return outlineShare(b, box) >= 0.5 * area(box);
  });
  let anims = (config?.animations ?? [])
    .filter((a) => {
      const part = partOf.get(a.component);
      if (a.source !== "manual" && RUNNER.test(words(names.get(a.component) ?? ""))) return false;
      // Kept while it is still a mover: by name, or the front-sized panel it was found as (refound shut, a door's hinges
      // would no longer be seen on it).
      return a.source !== "names" || moverKind(a.component, part?.name, part?.nameAr) || (part && frontPanel(part.mesh, whole) && !DRAWER_FITTING.test(words(names.get(a.component) ?? "")));
    })
    .map((a) => ({ ...a, follow: [...a.follow] }));
  // A saved assembly can pin an open door to the closed door beside it. Keep a follower only while it still sits on
  // its host; the door then gets its own swing below. A hand-built assembly is left as the vendor set it.
  for (const a of anims) {
    if (a.source === "manual") continue;
    const box = boxes.get(a.component);
    // Its hinge hardware stays on it too: a hinge sits on the door's edge, partly past it.
    const onEdge = (id: string) => HINGE_PART.test(words(names.get(id) ?? "")) && box!.clone().expandByScalar(0.03).intersectsBox(boxes.get(id)!);
    a.follow = box ? a.follow.filter((id) => id !== a.component && boxes.has(id) && (attachedTo(box, boxes.get(id)!, depth) || onEdge(id))) : [];
  }
  for (const p of parts) {
    if (anims.some((a) => a.component === p.id || a.follow.includes(p.id))) continue;
    const box = boxes.get(p.id)!;
    // A front-sized panel named as a door is the door even with an accessory word ("Mirror door backing", "Glazed door
    // frame"); a small one ("door lock key ring") is not. A runner is the drawer's rail, not its own drawer.
    // Parts on a bigger moving part are sorted out below.
    const kind = moverKind(p.id, p.name, p.nameAr) ?? (frontPanel(p.mesh, whole) && !surroundsLeaf(p.id, box) && !RUNNER.test(words(names.get(p.id) ?? "")) && !DRAWER_FITTING.test(words(names.get(p.id) ?? "")) ? namedMover(p.id, p.name, p.nameAr) : null);
    if (!kind) continue;
    const base: PartAnimation = { id: `anim_${p.id}`, component: p.id, follow: [], label: p.name ?? p.id, labelAr: p.nameAr ?? null, motion: kind.motion, type: "rotation", axis: "y", unit: "degrees", duration: kind.motion === "slide" ? 0.6 : 0.8, enabled: true, confidence: 0.7, source: "names", issues: [], reason: "named a movable part" };
    anims.push(kind.build(base, box, whole));
  }
  // An accessory taken for a movable part (a handle or a moulding named "door…", a vision "door" that is the panel
  // on a door, the glass or mirror held by a door's frame): it rides on a bigger moving part's front, so it joins that
  // part's assembly instead of moving alone.
  for (const a of [...anims]) {
    const box = boxes.get(a.component);
    if (!box || a.source === "manual") continue;
    const insert = ACCESSORY_WORDS.test(words(names.get(a.component) ?? ""));
    const child = partOf.get(a.component)?.mesh;
    const host = anims.find((o) => {
      const hostBox = boxes.get(o.component);
      const hostMesh = partOf.get(o.component)?.mesh;
      if (o === a || !hostBox || !hostMesh || !child) return false;
      if (sheetArea(child) >= (insert ? 1.05 : 0.4) * sheetArea(hostMesh)) return false;
      return attachedTo(hostBox, box, depth) || (insert && onSheet(hostMesh, child, modelRoot));
    });
    if (host) {
      host.follow.push(a.component, ...a.follow);
      anims = anims.filter((x) => x !== a);
    }
  }
  // A runner travels with the drawer front in the same column, instead of being its own control.
  for (const p of parts) {
    if (!RUNNER.test(words(names.get(p.id) ?? "")) || anims.some((a) => a.component === p.id || a.follow.includes(p.id))) continue;
    const b = boxes.get(p.id);
    const host = b && anims.find((a) => a.type === "translation" && boxes.has(a.component) && outlineShare(b, boxes.get(a.component)!) >= 0.5 * area(b));
    if (host) host.follow.push(p.id);
  }
  // The vision analysis says what is attached to what: those parts join their moving parent, when the geometry agrees.
  // Its boxes are drawn on the photo, so a handle by the line between two doors can be given to the wrong one
  // (withinFace). A relation the geometry contradicts is dropped; the part is then found on its real door below.
  for (const [child, parent] of Object.entries(attached)) {
    const host = anims.find((a) => a.component === parent);
    const [hostBox, childBox] = [boxes.get(parent), boxes.get(child)];
    if (!host || host.source === "manual" || anims.some((a) => a.component === child) || structural(words(names.get(child) ?? ""))) continue;
    if (!hostBox || !childBox || !withinFace(hostBox, childBox) || host.follow.includes(child)) continue;
    host.follow.push(child);
  }
  const movers = new Set(anims.map((a) => a.component));
  const taken = new Set<string>([...movers, ...anims.flatMap((a) => a.follow)]);
  // The body: the biggest part that is not a drawer's own box or a part added here (a reloaded drawer box can be big).
  const body = [...boxes].filter(([id]) => !DRAWER_BOX.test(words(names.get(id) ?? "")) && !partOf.get(id)?.mesh.userData?.estimated)
    .sort(([, a], [, b]) => size(b).x * size(b).y * size(b).z - size(a).x * size(a).y * size(a).z)[0]?.[0];
  if (body) taken.add(body);
  // The fixed structure (no moving part, nothing on one, no small fittings): what a part faces out of.
  const carriedIds = new Set([...movers, ...anims.flatMap((a) => a.follow)]);
  const biggest = Math.max(...size(whole).toArray());
  const fixed = [...boxes].filter(([id, b]) => !carriedIds.has(id) && Math.max(...size(b).toArray()) >= 0.3 * biggest).reduce((all, [, b]) => all.union(b), new Box3());
  const structure = fixed.isEmpty() ? whole : fixed;
  // A door modelled open is not a closed neighbour of the door beside it: its swung box would make the pair rule see
  // a neighbour on both sides and fall back to a guess.
  const upAxis = axisOfVec(VEC[frame.up]);
  const openIn = (id: string) => {
    const leaf = partOf.get(id)?.mesh;
    return Boolean(leaf) && Math.abs(authoredSwing(leaf!, modelRoot, { face: frame.front, axis: upAxis })) > 12;
  };
  const doorBoxes = anims.filter((a) => a.type === "rotation" && (a.axis === "y") && !openIn(a.component)).map((a) => boxes.get(a.component)).filter((b): b is Box3 => Boolean(b));
  const out = anims.map((a) => {
    const box = boxes.get(a.component);
    if (!box) return { ...a, issues: problems(a, parts) };
    if (a.source === "manual") {
      // The vendor's own choice of hinge is kept; saved before parts knew their frame, it is set out in it now (a
      // model whose file is not y-up / +z-front turned its doors about the wrong axis).
      const framed = !a.up && a.type === "rotation" ? withHinge({ ...a, face: faceOf(box, structure, frame), up: frame.up, front: frame.front }, a.hinge ?? "left", box) : a;
      return { ...framed, issues: problems(framed, parts) };
    }
    // The part's own frame first (where it faces out, the model's up and front: saved with it); what is mounted on it is
    // found in that frame, so a model whose file faces sideways keeps its handles, glass and trims on their door.
    const face = faceOf(box, structure, frame);
    const own = localFrame({ face, up: frame.up, front: frame.front });
    const local = new Map([...boxes].map(([id, b]) => [id, inFrame(b, own)]));
    const lbox = local.get(a.component)!;
    const direct = partsOn(lbox, local, taken, names, size(inFrame(whole, own)).z);
    const on = [...direct, ...chainedTo(lbox, [...direct, ...a.follow].filter((id) => local.has(id)), local, new Set([...taken, ...direct]), names)];
    on.forEach((id) => taken.add(id));
    let next: PartAnimation = { ...a, follow: [...new Set([...a.follow, ...on])].filter((id) => id !== a.component), face, up: frame.up, front: frame.front };
    let reach = 0; // how deep the drawer's own box reaches behind its front
    if (next.type === "translation") {
      // The drawer's own box (bottom, sides, back), when the file has one: behind the front, within its outline. It
      // slides with it; no second box is made (reconstruct.openCavities).
      // Behind the front within its outline, or a frame-and-box around a front inlaid in it (a glass front): reaching
      // back behind the front, standing at most a few centimetres proud of it.
      const m = localFrame(next), f = inFrame(box, m), fs = size(f);
      const own = [...boxes].filter(([id]) => !taken.has(id) && id !== a.component && (DRAWER_BOX.test(words(names.get(id) ?? "")) || partOf.get(id)?.mesh.userData?.drawerBoxFor === a.component)).filter(([, b]) => {
        const l = inFrame(b, m), s3 = size(l);
        const within = overlap(l.min.x, l.max.x, f.min.x, f.max.x) >= 0.8 * s3.x && overlap(l.min.y, l.max.y, f.min.y, f.max.y) >= 0.8 * s3.y;
        const around = overlap(l.min.x, l.max.x, f.min.x, f.max.x) >= 0.95 * fs.x && overlap(l.min.y, l.max.y, f.min.y, f.max.y) >= 0.95 * fs.y && s3.x <= 1.6 * fs.x && s3.y <= 1.6 * fs.y;
        return (within || around) && l.max.z <= f.max.z + 0.03 && l.min.z < f.min.z;
      }).map(([id]) => id);
      own.forEach((id) => taken.add(id));
      reach = Math.max(0, ...own.map((id) => f.max.z - local.get(id)!.min.z));
      // What is held on its own box (a pull on the frame round a glass front) slides with it too.
      const face = own.reduce((all, id) => all.union(local.get(id)!), lbox.clone());
      face.min.z = Math.max(face.min.z, lbox.min.z - 0.05); // the drawer's front: its face and frame, not its depth
      const held = own.length ? chainedTo(face, own, local, taken, names).filter((id) => !RUNNER.test(words(names.get(id) ?? ""))) : [];
      held.forEach((id) => taken.add(id));
      next = { ...next, follow: [...new Set([...next.follow, ...own, ...held])] };
    }
    if (next.type === "rotation") {
      const side = !next.hinge || next.hinge === "left" || next.hinge === "right";
      if (side) {
        const R = new Vector3().crossVectors(VEC[frame.up], VEC[next.face!]);
        const carried = [...next.follow].filter((id) => boxes.has(id)).map((id) => ({ box: boxes.get(id)!, name: names.get(id) ?? "" }));
        const across = R.lengthSq() > 0.5 ? R : new Vector3(1, 0, 0);
        const leaf = partOf.get(next.component)?.mesh;
        const open = leaf ? recordedHinge(leaf, box, across) ?? hingeOfOpen(leaf, modelRoot, next, carried, VEC[frame.up], across) : null;
        // A door the file shows open says where its hinge is: the edge on its hinge hardware, else the edge that stayed
        // at the cabinet. Otherwise: hardware, handle, the photo, a pair, and only then a flagged guess.
        const [hinge, why, sure] = open ? [open.hinge, open.why, true] as const
          : hingeFromGeometry(box, carried, doorBoxes.filter((d) => d !== box), whole, across, a.source === "vision" ? a.hinge : undefined);
        next = { ...withHinge(next, hinge, box), reason: sure ? why : `Hinge side: ${why}`, hingeUnsure: !sure || undefined, ...(sure ? {} : { confidence: Math.min(next.confidence ?? 0.7, 0.5) }) };
        if (open) next = { ...next, pivot: open.pivot };
        else if (leaf) next = { ...next, pivot: pivotOnMesh(leaf, modelRoot, next) };
      } else {
        next = withHinge(next, next.hinge!, box);
        const leaf = partOf.get(next.component)?.mesh;
        if (leaf && next.hinge) next = { ...next, pivot: pivotOnMesh(leaf, modelRoot, next) };
      }
    } else if (!next.distance || next.source === "names") {
      // Out the way it faces, half the model's depth that way (a drawer in a sideways model slides sideways).
      const way = next.source === "vision" && next.direction ? next.direction : next.face!;
      next = withDirection(next, way, 0.5 * Math.abs(size(whole).dot(VEC[way])));
    }
    if (next.type === "translation" && next.source !== "manual" && reach > 0 && Math.abs(next.distance ?? 0) > 0.75 * reach) {
      next = { ...next, distance: Math.sign(next.distance ?? 1) * 0.75 * reach }; // out three quarters of its own box, as on runners
    }
    const s = size(box), w = size(whole);
    const issues = [...problems(next, parts), ...(s.x >= 0.9 * w.x && s.y >= 0.9 * w.y && s.z >= 0.9 * w.z ? ["This mesh is (almost) the whole model: moving it would move everything."] : [])];
    return { ...next, issues, enabled: !issues.length && (next.confidence ?? 0.7) >= 0.3 };
  });
  const playing = new Set(out.filter((a) => a.enabled).map((a) => a.component));
  return {
    version: 1,
    ...(config ?? {}),
    movable: playing.size > 0,
    animations: out,
    flagged: (config?.flagged ?? []).filter((f) => !f.component || !playing.has(f.component)),
    source: config?.source ?? "names",
  } as AnimationConfig;
}

/** The enabled animation a clicked part belongs to: the moving part itself or a part on it (a handle). */
export function animationOf(config: AnimationConfig | null | undefined, partId: string): PartAnimation | null {
  return enabledAnimations(config).find((a) => a.component === partId || a.follow.includes(partId)) ?? null;
}

export type Pose = { position: Vector3; quaternion: Quaternion; scale: Vector3 };

/** Where an attached part goes when the part it is on is moved, turned or resized (rest → now, both in the part's
 * parent space; `outer`: that parent's world matrix, `frame`: the attached part's parent world matrix). It keeps its
 * place on the part (moved, turned and stretched with it), its own orientation relative to the part, and its own
 * size: a handle stays a handle on a resized door. */
export function carried(partRest: Pose, partNow: Pose, outer: Matrix4, childRest: Pose, frame: Matrix4): Pose {
  const was = outer.clone().multiply(new Matrix4().compose(partRest.position, partRest.quaternion, partRest.scale));
  const now = outer.clone().multiply(new Matrix4().compose(partNow.position, partNow.quaternion, partNow.scale));
  const move = now.multiply(was.invert());
  const position = childRest.position.clone().applyMatrix4(frame).applyMatrix4(move).applyMatrix4(frame.clone().invert());
  const quaternion = partNow.quaternion.clone().multiply(partRest.quaternion.clone().invert()).multiply(childRest.quaternion);
  return { position, quaternion, scale: childRest.scale.clone() };
}

/** The handle of a movable part, found from the geometry: among the parts on it (`candidates`: its `follow`, attached
 * to it by position, not by name), the small one that stands out furthest from the part's face, weighted by its length
 * (a pull bar beats its mounting feet, a lock or a hanging key). Measured in the part's own frame, so it holds open or
 * closed. A name saying handle / knob / pull only adds weight. Null when nothing stands out from the face: the part
 * then gets its icon on itself, never on a wrong mesh. */
export function handleOf(part: Mesh, candidates: { id: string; mesh: Mesh; name?: string }[]): { id: string; mesh: Mesh } | null {
  part.updateWorldMatrix(true, false);
  if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
  const own = part.geometry.boundingBox!;
  const ownSize = own.getSize(new Vector3());
  const toPart = part.matrixWorld.clone().invert();
  // Standing out: past the part's box on any side (a door's face, a drawer box's front), by more than a quarter of its
  // thickness or a hundredth of its length, whichever is less (flush trim and inlays do not).
  const margin = Math.min(0.25 * Math.min(ownSize.x, ownSize.y, ownSize.z), 0.01 * Math.max(ownSize.x, ownSize.y, ownSize.z));
  let best: { id: string; mesh: Mesh; score: number } | null = null;
  for (const c of candidates) {
    c.mesh.updateWorldMatrix(true, false);
    if (!c.mesh.geometry.boundingBox) c.mesh.geometry.computeBoundingBox();
    const box = c.mesh.geometry.boundingBox!.clone().applyMatrix4(toPart.clone().multiply(c.mesh.matrixWorld));
    const s = box.getSize(new Vector3());
    const longest = Math.max(s.x, s.y, s.z);
    if (longest > 0.45 * Math.max(ownSize.x, ownSize.y, ownSize.z)) continue; // a panel or a mirror: not a handle
    const proud = Math.max(...[0, 1, 2].flatMap((i) => [box.max.getComponent(i) - own.max.getComponent(i), own.min.getComponent(i) - box.min.getComponent(i)]));
    if (proud <= margin) continue; // flush with the part: trim, an inlay
    const named = HANDLE_WORDS.test(words(`${c.name ?? ""} ${c.id}`)) ? 3 : 1;
    const score = proud * longest * named;
    if (!best || score > best.score) best = { id: c.id, mesh: c.mesh, score };
  }
  return best && { id: best.id, mesh: best.mesh };
}
const HANDLE_WORDS = /\b(handles?|knobs?|pulls?)\b|(?:^|[\s\d_])(?:ال)?(?:مقبض|مقابض)(?=$|[\s\d_])/i;
