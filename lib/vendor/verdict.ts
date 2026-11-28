// Pure (no network imports): used by the review UI, the save, and their tests.
import type { ModelValidation } from "./parts";

/** Why a rebuilt model cannot be published (empty when it can): only real damage (geometry errors, a failed
 * reconstruction). Estimates (materials, sizes, movements) are notes and never block; an older save marked
 * "needs_confirmation" with no errors publishes. */
export function publishBlockers(doc: { validation?: ModelValidation } | null | undefined): string[] {
  const v = doc?.validation;
  if (!v) return [];
  const errors = v.errors ?? [];
  if (v.status !== "failed" && v.status !== "needs_repair" && !errors.length) return [];
  return errors.length ? errors : [v.status === "failed" ? "The reconstruction failed." : "The model has geometry errors."];
}

/** The informational notes of a rebuilt model (what was estimated), older saves' `confirm` list included. */
export function modelNotes(doc: { validation?: ModelValidation }): string[] {
  const v = doc.validation;
  const lines = [...(v?.notes ?? []).map((n) => n.text), ...(v?.confirm ?? []), ...(v?.warnings ?? [])];
  return [...new Set(lines.filter(Boolean))];
}
