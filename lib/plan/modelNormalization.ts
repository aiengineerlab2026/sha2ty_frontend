import { Box3, Group, Matrix4, Object3D, Vector3 } from "three";

/** Physical size in metres. X = width, Y = height, Z = depth; 1 world unit = 1 m. */
export type Dimensions = { width: number; height: number; depth: number };

export type Orientation = "as-authored" | "z-up→y-up" | "yaw-90" | "z-up→y-up+yaw-90";

export interface NormalizationReport {
  modelId?: string;
  /** World-space size of the authored model, including every nested node transform. */
  originalSize: Dimensions;
  /** Size after orientation normalisation, before scaling. */
  orientedSize: Dimensions;
  orientation: Orientation;
  target: Dimensions | null;
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

/** Height/depth may differ from the database by this fraction before the user is warned. */
const SIZE_TOLERANCE = 0.1;
const ORIENTATIONS: { name: Orientation; matrix: Matrix4 }[] = [
  { name: "as-authored", matrix: new Matrix4() },
  { name: "z-up→y-up", matrix: new Matrix4().makeRotationX(-Math.PI / 2) },
  { name: "yaw-90", matrix: new Matrix4().makeRotationY(Math.PI / 2) },
  { name: "z-up→y-up+yaw-90", matrix: new Matrix4().makeRotationY(Math.PI / 2).multiply(new Matrix4().makeRotationX(-Math.PI / 2)) },
];

/**
 * Wrap a loaded model at its real size, Y-up, standing on Y = 0 and centred on X/Z. The model's
 * own proportions are always preserved: ONE uniform factor, `dbWidth / modelWidth`, makes the
 * width exactly the database width; height and depth follow the GLB's proportions. Database
 * height/depth are used only to warn (> 10% off), never to scale. Orientation is corrected first,
 * as its own step, so scaling never compensates for a rotated model. The result is a fresh
 * hierarchy:
 *
 *   wrapper (identity — the caller positions/rotates this)
 *    └─ fit    (position: centring offset, scale: one uniform factor)
 *        └─ orient (rotation: authored axes → X width, Y up, Z depth)
 *            └─ clone of source (its own node transforms untouched)
 *
 * The source is never modified (cached GLTF scenes stay pristine), so normalising the same source
 * again yields the same result — the database scale can never be applied twice.
 *
 * With `target = null` (size unknown) only orientation and placement are normalised: the model
 * keeps its authored size, read as metres per the glTF spec.
 */
export function normalizeModel(source: Object3D, target: Dimensions | null, modelId?: string): { object: Group; report: NormalizationReport } {
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
    ? [target.width / orientedSize.width, target.height / orientedSize.height, target.depth / orientedSize.depth]
    : [1, 1, 1];
  // Width drives the scale; the same factor on all axes keeps the GLB's shape.
  const scaleFactor = target ? target.width / orientedSize.width : 1;
  const scale: [number, number, number] = [scaleFactor, scaleFactor, scaleFactor];
  fit.scale.setScalar(scaleFactor);

  // Centre on X/Z, bottom on the floor.
  const box = worldBox(wrapper);
  const center = box.getCenter(new Vector3());
  fit.position.set(-center.x, -box.min.y, -center.z);
  const finalSize = measure(wrapper);

  const warnings: string[] = [];
  const distortion = Math.max(...perAxis) / Math.min(...perAxis);
  const heightError = target ? Math.abs(finalSize.height - target.height) / target.height : 0;
  const depthError = target ? Math.abs(finalSize.depth - target.depth) / target.depth : 0;
  if (target && heightError > SIZE_TOLERANCE) {
    warnings.push(`At ${target.width.toFixed(2)} m wide the model is ${finalSize.height.toFixed(2)} m high, but the catalogue says ${target.height.toFixed(2)} m (${(heightError * 100).toFixed(0)}% off).`);
  }
  if (target && depthError > SIZE_TOLERANCE) {
    warnings.push(`At ${target.width.toFixed(2)} m wide the model is ${finalSize.depth.toFixed(2)} m deep, but the catalogue says ${target.depth.toFixed(2)} m (${(depthError * 100).toFixed(0)}% off).`);
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
function chooseOrientation(model: Object3D, target: Dimensions | null) {
  const probe = new Group();
  const inner = new Group();
  probe.add(inner);
  inner.add(model.clone(true));
  const score = (matrix: Matrix4) => {
    inner.quaternion.setFromRotationMatrix(matrix);
    const s = measure(probe);
    if (!target) return 0;
    // Log-ratio error per axis, invariant to overall scale.
    const k = Math.cbrt((target.width * target.height * target.depth) / Math.max(s.width * s.height * s.depth, 1e-12));
    return (
      Math.abs(Math.log((s.width * k) / target.width)) +
      2 * Math.abs(Math.log((s.height * k) / target.height)) +
      Math.abs(Math.log((s.depth * k) / target.depth))
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
export function catalogDimensions(model: { width_m: number | null; height_m: number | null; depth_m: number | null; shape?: string | null; length2_m?: number | null }): Dimensions | null {
  const { width_m, height_m, depth_m } = model;
  if (!width_m || !height_m || !depth_m || width_m <= 0 || height_m <= 0 || depth_m <= 0) return null;
  // L-shaped corner unit: its bounding box is wall-A length × wall-B length (depth_m is the arm depth).
  const l = model.shape === "l_left" || model.shape === "l_right";
  if (l && !(Number(model.length2_m) > 0)) return null;
  return { width: Number(width_m), height: Number(height_m), depth: l ? Number(model.length2_m) : Number(depth_m) };
}
