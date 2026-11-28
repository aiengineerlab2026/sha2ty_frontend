// Pure (no network imports): used by the review UI, the save, and their tests.
import type { ModelValidation } from "./parts";

/** What stops a model from being saved as ready and published: only a missing 3D file. Its technical quality never
 * does: geometry issues (intersections, coplanar faces, UVs), colour or likeness differences, estimates and
 * uncertain movements are repaired and recorded automatically by the backend (for admins), whatever the document's
 * status says — including older saves marked needs_repair, needs_confirmation, publishable false or ok false. */
export function publishBlockers(model: { glbUrl?: string | null }): string[] {
  return model.glbUrl ? [] : ["The 3D file is missing."];
}

export type NoteKind = "movement" | "material" | "dimension" | "estimate";
const PERSON_FACING: NoteKind[] = ["movement", "material", "dimension", "estimate"];

/** What a person may want to adjust, as categories only (never the technical messages behind them): which kinds of
 * details were estimated from the photo. Empty when there is nothing worth saying. */
export function modelNotes(doc: { validation?: ModelValidation; sizeSource?: string } | null | undefined): NoteKind[] {
  const v = doc?.validation;
  const kinds = new Set<NoteKind>();
  for (const n of v?.notes ?? []) if (PERSON_FACING.includes(n.kind as NoteKind)) kinds.add(n.kind as NoteKind);
  if ((v?.confirm ?? []).some((line) => line.startsWith("How "))) kinds.add("movement"); // older saves
  if (doc?.sizeSource && doc.sizeSource !== "vendor") kinds.add("dimension");
  return PERSON_FACING.filter((k) => kinds.has(k));
}
