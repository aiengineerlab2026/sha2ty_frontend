import { Box3, Group, Matrix4, Object3D, Vector3 } from "three";

/** Physical size in metres. X = width, Y = height, Z = depth; 1 world unit = 1 m. */
export type Dimensions = { width: number; height: number; depth: number };
/** Catalogue size: width and height are required, depth is optional (the GLB's own depth is used). */
export type CatalogSize = { width: number; height: number; depth?: number };

export type Orientation = "as-authored" | "z-up→y-up" | "yaw-90" | "z-up→y-up+yaw-90";

export interface NormalizationReport {
  modelId?: string;
  /** World-space size of the authored model, including every nested node transform. */
  originalSize: Dimensions;
  /** Size after orientation normalisation, before scaling. */
  orientedSize: Dimensions;
  orientation: Orientation;
  target: CatalogSize | null;
  scale: [number, number, number];
  finalSize: Dimensions;
  /** max/min of the per-axis catalogue/model ratios: 1 = GLB proportions match the catalogue. */
  distortion: number;
  /** Rendered height/depth vs the database values (fractions; 0.12 = 12% off). Validation only. */
  heightError: number;
  depthError: number;
  rootTransform: { position: number[]; rotation: number[]; scale: number[] };
  nestedTransforms: number;
  warnings: string[];
}

/** Per-axis stretch (max/min factor − 1) beyond which the GLB's own shape is reported as off. */
export const STRETCH_TOLERANCE = 0.25;
const ORIENTATIONS: { name: Orientation; matrix: Matrix4 }[] = [
  { name: "as-authored", matrix: new Matrix4() },
  { name: "z-up→y-up", matrix: new Matrix4().makeRotationX(-Math.PI / 2) },
  { name: "yaw-90", matrix: new Matrix4().makeRotationY(Math.PI / 2) },
  { name: "z-up→y-up+yaw-90", matrix: new Matrix4().makeRotationY(Math.PI / 2).multiply(new Matrix4().makeRotationX(-Math.PI / 2)) },
];

/** One scale for every axis: the geometric mean of the per-axis ratios. Never a different factor per axis. */
export function uniformFactor(ratios: number[]): number {
  const usable = ratios.filter((r) => r > 0 && Number.isFinite(r));
  if (!usable.length) return 1;
  return Math.exp(usable.reduce((sum, r) => sum + Math.log(r), 0) / usable.length);
}

/**
 * Wrap a loaded model at its real size, Y-up, standing on Y = 0 and centred on X/Z. When the
 * catalogue size matches the model's proportions, one factor makes it that size. When it does not,
 * the same factor is still used (the geometric mean), so the mesh is never stretched, and the
 * difference is reported for review. Orientation is corrected first, as its own step, so scaling
 * never compensates for a rotated model. The result is a fresh hierarchy:
 *
 *   wrapper (identity — the caller positions/rotates this)
 *    └─ fit    (position: centring offset, scale: one factor per axis, world-aligned)
 *        └─ orient (rotation: authored axes → X width, Y up, Z depth)
 *            └─ clone of source (its own node transforms untouched)
 *
 * The source is never modified (cached GLTF scenes stay pristine), so normalising the same source
 * again yields the same result — the database scale can never be applied twice.
 *
 * With `target = null` (size unknown) only orientation and placement are normalised: the model
 * keeps its authored size, read as metres per the glTF spec.
 */
export function normalizeModel(source: Object3D, target: CatalogSize | null, modelId?: string): { object: Group; report: NormalizationReport } {
  const model = source.clone(true); // geometry/materials shared, transforms copied — source untouched
  const orient = new Group();
  orient.name = "orient";
  const fit = new Group();
  fit.name = "fit";
  const wrapper = new Group();
  wrapper.name = "normalized-model";
  orient.add(model);
  fit.add(orient);
  wrapper.add(fit);

  const originalSize = measure(wrapper);
  const orientation = chooseOrientation(model, target);
  orient.quaternion.setFromRotationMatrix(orientation.matrix);
  const orientedSize = measure(wrapper);
  assertFinite(orientedSize);

  const perAxis = target
    ? [target.width / orientedSize.width, target.height / orientedSize.height, ...(target.depth ? [target.depth / orientedSize.depth] : [])]
    : [1, 1, 1];
  // One factor on every axis. A catalogue size with different proportions is flagged, not stretched into.
  const k = uniformFactor(perAxis);
  const scale: [number, number, number] = [k, k, k];
  fit.scale.set(k, k, k);

  // Centre on X/Z, bottom on the floor.
  const box = worldBox(wrapper);
  const center = box.getCenter(new Vector3());
  fit.position.set(-center.x, -box.min.y, -center.z);
  const finalSize = measure(wrapper);

  const warnings: string[] = [];
  const distortion = Math.max(...perAxis) / Math.min(...perAxis);
  const heightError = target ? Math.abs(finalSize.height - target.height) / target.height : 0;
  const depthError = target?.depth ? Math.abs(finalSize.depth - target.depth) / target.depth : 0;
  if (target && distortion > 1 + STRETCH_TOLERANCE) {
    const listed = [target.width, target.height, target.depth].filter((v): v is number => Boolean(v)).map((v) => Number(v).toFixed(2)).join(" × ");
    warnings.push(`The model's proportions differ from the catalogue size ${listed} m by ${((distortion - 1) * 100).toFixed(0)}%. It was scaled uniformly; review the dimensions.`);
  }

  let nestedTransforms = 0;
  source.traverse((node) => {
    // node.matrix is stale until updateMatrix(); compose from the live TRS instead.
    if (node !== source && !new Matrix4().compose(node.position, node.quaternion, node.scale).equals(IDENTITY)) nestedTransforms += 1;
  });

  const report: NormalizationReport = {
    modelId,
    originalSize,
    orientedSize,
    orientation: orientation.name,
    target,
    scale,
    finalSize,
    distortion,
    heightError,
    depthError,
    rootTransform: {
      position: source.position.toArray(),
      rotation: [source.rotation.x, source.rotation.y, source.rotation.z],
      scale: source.scale.toArray(),
    },
    nestedTransforms,
    warnings,
  };
  wrapper.userData.normalization = report;
  return { object: wrapper, report };
}

/** Another state of the same product (an open wardrobe) placed with exactly the transform `reference` got from
 * normalizeModel: never fitted to its own box, which open doors make wider and deeper, so it keeps the closed
 * model's scale, orientation and origin and lines up with it (both states are built on the same origin). */
export function alignLike(source: Object3D, reference: Group): Group {
  const refOrient = reference.getObjectByName("orient");
  const refFit = reference.getObjectByName("fit");
  const model = source.clone(true);
  const orient = new Group();
  orient.name = "orient";
  const fit = new Group();
  fit.name = "fit";
  const wrapper = new Group();
  wrapper.name = "normalized-model";
  orient.add(model);
  fit.add(orient);
  wrapper.add(fit);
  if (refOrient) orient.quaternion.copy(refOrient.quaternion);
  if (refFit) {
    fit.scale.copy(refFit.scale);
    fit.position.copy(refFit.position);
  }
  wrapper.userData.normalization = reference.userData.normalization;
  return wrapper;
}

/** World-space axis-aligned size of an object, including all nested transforms. */
export function measure(object: Object3D): Dimensions {
  const size = worldBox(object).getSize(new Vector3());
  return { width: size.x, height: size.y, depth: size.z };
}

export function worldBox(object: Object3D): Box3 {
  object.updateMatrixWorld(true);
  // precise: vertex-level box. The default uses each child's local bounding box, which grows when
  // a nested node is rotated and would shrink the model after scaling.
  return new Box3().setFromObject(object, true);
}

/**
 * glTF is Y-up, but CAD conversions often arrive Z-up, and models are not always authored with
 * their long side on X. Keep the authored orientation unless a 90° re-orientation explains the
 * catalogue proportions clearly better (height is the strongest cue, then width ≥ depth).
 */
function chooseOrientation(model: Object3D, target: CatalogSize | null) {
  const probe = new Group();
  const inner = new Group();
  probe.add(inner);
  inner.add(model.clone(true));
  const score = (matrix: Matrix4) => {
    inner.quaternion.setFromRotationMatrix(matrix);
    const s = measure(probe);
    if (!target) return 0;
    // Log-ratio error per axis, invariant to overall scale (depth only when the catalogue has one).
    const k = target.depth
      ? Math.cbrt((target.width * target.height * target.depth) / Math.max(s.width * s.height * s.depth, 1e-12))
      : Math.sqrt((target.width * target.height) / Math.max(s.width * s.height, 1e-12));
    return (
      Math.abs(Math.log((s.width * k) / target.width)) +
      2 * Math.abs(Math.log((s.height * k) / target.height)) +
      (target.depth ? Math.abs(Math.log((s.depth * k) / target.depth)) : 0)
    );
  };
  if (!target) return ORIENTATIONS[0];
  const authored = score(ORIENTATIONS[0].matrix);
  let best = { ...ORIENTATIONS[0], score: authored };
  for (const o of ORIENTATIONS.slice(1)) {
    const s = score(o.matrix);
    if (s < best.score) best = { ...o, score: s };
  }
  // Only re-orient on clear evidence: a near-cube gives no reliable cue.
  return best.name !== "as-authored" && best.score < authored * 0.5 && authored > 0.25 ? best : ORIENTATIONS[0];
}

const IDENTITY = new Matrix4();

function assertFinite(size: Dimensions) {
  const ok = [size.width, size.height, size.depth].every((v) => Number.isFinite(v) && v > 0);
  if (!ok) throw new Error("Invalid model bounding box: the model has no measurable geometry.");
}

export function sameSize(a: Dimensions, b: Dimensions, tolerance = 5e-4) {
  return Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance && Math.abs(a.depth - b.depth) <= tolerance;
}

/** Catalogue dimensions, or null when any is missing (never invent a size). */
export function catalogDimensions(model: { width_m: number | null; height_m: number | null; depth_m: number | null; shape?: string | null; length2_m?: number | null }): CatalogSize | null {
  const { width_m, height_m, depth_m } = model;
  if (!width_m || !height_m || width_m <= 0 || height_m <= 0) return null;
  // L-shaped corner unit: its bounding box is wall-A length × wall-B length; depth_m is the arm depth (needed).
  const l = model.shape === "l_left" || model.shape === "l_right";
  if (l) return Number(model.length2_m) > 0 && Number(depth_m) > 0 ? { width: Number(width_m), height: Number(height_m), depth: Number(model.length2_m) } : null;
  return { width: Number(width_m), height: Number(height_m), ...(Number(depth_m) > 0 ? { depth: Number(depth_m) } : {}) };
}

/** "W × H m", with "× D" when the catalogue has a depth. */
export function sizeLabel(model: { width_m: number | null; height_m: number | null; depth_m?: number | null }): string | null {
  if (!model.width_m || !model.height_m) return null;
  return [model.width_m, model.height_m, model.depth_m].filter((v): v is number => Boolean(v)).map((v) => Number(v).toFixed(2)).join(" × ") + " m";
}
