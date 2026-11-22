import type { MaterialEdit, PartDocument } from "../vendor/parts";

/** What a part's material is, as loaded from its file (three.js material fields and glTF extras). */
export type FileLook = {
  name?: string;
  /** glTF material extras.materialClass (the structural model writes the shared material spec into its file). */
  materialClass?: string | null;
  metalness?: number;
  opacity?: number;
  transparent?: boolean;
  transmission?: number;
  sheen?: number;
};

/** Material classes a wood choice may cover (backend services/material_spec.py). Unknown ("other") is not blocked. */
const WOODEN = new Set(["solid_wood", "wood_veneer", "mdf", "laminate", "other"]);
const NAMED = /paint|lacquer|glass|mirror|metal|steel|chrome|brass|alumin|fabric|velvet|linen|leather|marble|stone|ceramic|plastic|acrylic|دهان|لاكيه|زجاج|مرآة|معدن|قماش|جلد|رخام/i;
/** Parts this small (share of the front box) do not decide a fused mesh's finish: handles, knobs, trims. */
const MINOR = 0.05;

/** The photo reading's material classes behind one visual part: its own component when it is linked (analysisId);
 * for one fused mesh (the whole model), every major non-decorative component of the reading. */
export function specClasses(doc: PartDocument | null | undefined, analysisId: string | undefined, fused: boolean): string[] {
  const parts = doc?.materials?.parts ?? {};
  if (analysisId) return parts[analysisId] ? [parts[analysisId].class] : [];
  if (!fused) return [];
  const components = (doc?.analysis?.components ?? []) as { id?: string; role?: string; box?: number[] | null; name?: string }[];
  return components
    .filter((c) => c.id && c.role !== "decorative" && !/handle|knob|pull/i.test(c.name ?? "") && c.box && (c.box[2] - c.box[0]) * (c.box[3] - c.box[1]) >= MINOR)
    .map((c) => parts[c.id!]?.class)
    .filter((cls): cls is string => Boolean(cls));
}

/** Why a wood choice must not be laid on this part (null: it may). Wood never replaces a paint or colour the vendor or
 * customer chose, nor a part whose own material is painted, glass, mirror, metal, fabric or stone, by its file or by
 * the photo reading. */
export function woodBlocked(look: FileLook, edit: MaterialEdit | undefined, classes: string[]): string | null {
  const kind = edit?.material?.kind;
  if (kind === "fabric" || kind === "paint") return kind;
  if (edit?.material?.paint) return "paint"; // a painted board: its paint is what shows
  if (edit?.color && kind !== "wood") return "colour";
  const own = look.materialClass && !WOODEN.has(look.materialClass) ? look.materialClass : null;
  if (own) return own;
  const read = classes.find((cls) => !WOODEN.has(cls));
  if (read) return read;
  if ((look.transmission ?? 0) > 0 || (look.transparent && (look.opacity ?? 1) < 0.95)) return "glass";
  if ((look.metalness ?? 0) >= 0.5) return "metal";
  if ((look.sheen ?? 0) > 0) return "fabric";
  if (look.name && PAINTED.test(look.name)) return "painted_wood";
  if (look.name && NAMED.test(look.name)) return "named";
  return null;
}

const PAINTED = /paint|lacquer|دهان|لاكيه/i;
/** Painted or coloured parts are still made of the wood chosen: their BOARD changes (manufacturing and price), their
 * look does not (withBoard). Glass, metal, fabric and stone parts are not made of wood at all. */
const BOARD_ONLY = new Set(["paint", "colour", "painted_wood"]);
export const boardOnly = (reason: string | null) => Boolean(reason && BOARD_ONLY.has(reason));
