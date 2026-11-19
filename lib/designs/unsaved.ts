import type { Dimensions } from "./schema";

/** Within half a millimetre: the same size (typed and dragged sizes are whole millimetres at most). */
const same = (a: Dimensions | null, b: Dimensions | null) =>
  a === b || Boolean(a && b && Math.abs(a.width - b.width) < 5e-4 && Math.abs(a.height - b.height) < 5e-4 && Math.abs(a.depth - b.depth) < 5e-4);

/** Whether the editor holds anything a save would keep: a material, variant, added or removed part (the viewer's
 * own dirty flag), a new 3D file, or a size other than the saved one (for a design not saved yet: the catalogue's).
 * A resize alone counts. */
export function hasUnsavedChanges(state: { editorDirty: boolean; newFile: boolean; dims: Dimensions | null; savedDims: Dimensions | null | undefined; sourceDims: Dimensions | null }): boolean {
  if (state.editorDirty || state.newFile) return true;
  const baseline = state.savedDims ?? state.sourceDims;
  return Boolean(state.dims) && !same(state.dims, baseline);
}

/** A draft's temporary name: "Draft · <listing> · 18 Nov" (the customer names it later). */
export function draftName(title: string, t: (s: string, v?: Record<string, string>) => string, now = new Date()) {
  return t("Draft · {title} · {date}", { title: title.trim() || t("Model"), date: now.toLocaleDateString(undefined, { day: "numeric", month: "short" }) }).slice(0, 200);
}

