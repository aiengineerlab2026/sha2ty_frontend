import type { CarpenterModel, CarpenterPart, MaterialEdit, MaterialSpec, PartDocument, PartInfo } from "../vendor/parts";

/** The two representations of one generated product (backend app/api/vendor.py): the visual model matches the photo;
 * the structural one is built from the same photo reading (its spec) as separate, editable boards. They are separate
 * meshes with different topology and ids: they are linked only through the spec's component id (visual parts carry it
 * as `analysisId`, structural parts as `specId`). */
export type ModelMode = "visual" | "structural";

/** Built-in wood maps (public/woods/<name>.jpg) the material spec can name. */
const WOODS = new Set(["oak", "walnut", "beech", "ash", "pine", "teak", "mahogany", "mdf", "laminate", "veneer"]);

/** The structural model's parts as editor parts: every board selectable, recolourable and resizable on its own. */
export function structuralParts(carpenter: CarpenterModel): PartDocument {
  return {
    separated: true,
    components: carpenter.components.map((part): PartInfo => ({
      id: part.id,
      name: part.name,
      editable: true,
      estimated: part.source === "inferred",
      ...(part.specId ? { analysisId: part.specId } : {}),
    })),
  };
}

/** For each structural part, the visual parts made from the same spec component (none: the photo shows it only in
 * the structural model, e.g. an inferred back panel). */
export function linkedVisual(carpenter: CarpenterModel, visual: PartDocument | null | undefined): Record<string, string[]> {
  const bySpec = new Map<string, string[]>();
  for (const part of visual?.components ?? []) {
    if (!part.analysisId) continue;
    bySpec.set(part.analysisId, [...(bySpec.get(part.analysisId) ?? []), part.name]);
  }
  return Object.fromEntries(carpenter.components.map((part) => [part.id, part.specId ? bySpec.get(part.specId) ?? [] : []]));
}

/** Starting looks for structural parts the vendor has not edited: the spec's wood as its built-in map (laid by box
 * projection: generated boards have no UVs). Saved edits always win; non-wood parts keep the colour in the file. */
export function structuralEdits(carpenter: CarpenterModel, materials?: Record<string, MaterialSpec> | null): Record<string, MaterialEdit> {
  const saved = carpenter.material_edits ?? {};
  const out: Record<string, MaterialEdit> = { ...saved };
  for (const part of carpenter.components) {
    if (out[part.id]) continue;
    const wood = woodOf(part, materials ?? carpenter.materials);
    if (wood) out[part.id] = { mapUrl: `/woods/${wood}.jpg`, mapping: "box", tile: 0.6 };
  }
  return out;
}

function woodOf(part: CarpenterPart, materials: Record<string, MaterialSpec> | undefined): string | null {
  const spec = part.specId ? materials?.[part.specId] : undefined;
  const wood = spec?.woodType ?? null;
  return wood && WOODS.has(wood) ? wood : null;
}

/** What to tell the vendor about the visual model's checks: the stage where it lost fidelity and why (null: fine). */
export function fidelityProblem(doc: PartDocument | null | undefined): { stage: string; issues: string[] } | null {
  const report = doc?.fidelity;
  if (!report || report.ok !== false) return null;
  const stage = report.stages.find((s) => s.stage === report.lostAt);
  return { stage: report.lostAt ?? "", issues: stage?.issues ?? [] };
}
