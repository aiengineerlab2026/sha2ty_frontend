import type { CarpenterModel, MaterialEdit, PartDocument, PartInfo } from "../vendor/parts";

/** The two representations of one generated product (backend app/api/vendor.py): the visual model matches the photo;
 * the structural one is built from the same photo reading (its spec) as separate, editable boards. They are separate
 * meshes with different topology and ids: they are linked only through the spec's component id (visual parts carry it
 * as `analysisId`, structural parts as `specId`). */
export type ModelMode = "visual" | "structural";

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

/** The structural model's saved edits, and nothing else: the file's own materials (the shared material spec's colours)
 * show until the vendor changes one. No texture is laid on by default. */
export function structuralEdits(carpenter: CarpenterModel): Record<string, MaterialEdit> {
  return { ...(carpenter.material_edits ?? {}) };
}

/** Whether the visual model really is several meshes, and why not when it is not (one fused mesh, or an Auto Split
 * result that was refused). Never counted from the structural model. */
export function visualModularity(doc: PartDocument | null | undefined): { modular: boolean; meshes: number; splitRefused: string | null } {
  const meshes = doc?.components?.length ?? 0;
  const modular = Boolean(doc?.separated) && meshes > 1;
  const split = doc?.split;
  return { modular, meshes, splitRefused: split && split.accepted === false ? split.issues?.[0] ?? split.status ?? "refused" : null };
}

/** What to tell the vendor about the visual model's checks: the stage where it lost fidelity and why (null: fine). */
export function fidelityProblem(doc: PartDocument | null | undefined): { stage: string; issues: string[] } | null {
  const report = doc?.fidelity;
  if (!report || report.ok !== false) return null;
  const stage = report.stages.find((s) => s.stage === report.lostAt);
  return { stage: report.lostAt ?? "", issues: stage?.issues ?? [] };
}
