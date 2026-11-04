import { supabase } from "@/lib/supabase/client";
import { uploadPublicFile } from "./storage";
import type { PartMaterial } from "@/lib/designs/materials";

/** Meshes that exist in the GLB. A one-mesh model has a single editable entry, not invented cushions. */
/** `id` is stable; `name` is what the vendor sees (renamable). `naming`: how the name was found (part_names.py). */
export type PartInfo = { id: string; name: string; editable: boolean; naming?: "file" | "geometry" | "ai" | "unidentified" | "vendor" };
export type PartDocument = { modelType?: string; separated?: boolean; components: PartInfo[]; limits?: string | null };
export type MaterialEdit = {
  color?: string;
  mapUrl?: string | null;
  repeat?: [number, number];
  rotation?: number;
  offset?: [number, number];
  roughness?: number;
  metalness?: number;
  /** Metres one pattern tile covers across (its height follows the image's aspect ratio). */
  tile?: number;
  /** "box": projected UVs baked into the part (its own UVs were an atlas or broken); "uv": its UVs kept. */
  mapping?: "uv" | "box";
  /** A vendor's normal map for the pattern (woods); without one, a fine relief is made from the pattern itself. */
  normalUrl?: string;
  /** The fabric or wood chosen from the library, with its estimate (refreshed at the size it is saved at). */
  material?: PartMaterial;
};

export type PartEditorApi = {
  exportGlb: () => Promise<Blob | null>;
  document: () => PartDocument;
  edits: () => Record<string, MaterialEdit>;
  dirty: () => boolean;
  /** Parts removed from the model. */
  removedParts?: () => string[];
  /** Parts shown in the view (the customer's choice of what to have made). */
  visibleParts?: () => string[];
  /** After a save: nothing unsaved until the next change. */
  markClean?: () => void;
  /** PNG/WebP render of the model as it is now, after its textures have loaded. */
  thumbnail: () => Promise<Blob | null>;
};

type ModelFields = {
  components?: PartDocument;
  material_edits: Record<string, MaterialEdit>;
  glb_url?: string;
  source_glb_url?: string;
  thumbnail_url?: string;
  version?: number;
};

/** Component list always; a new GLB only after the vendor changed a material or a name; a new thumbnail on every
 * save, rendered from the same state as that GLB. Both go in one row update with the next `version`. A failed
 * thumbnail keeps the previous one (thumbnailError says why). The first glb_url is kept as source_glb_url. */
export async function customizedModelFields(
  vendorId: string,
  modelId: string,
  glbUrl: string,
  sourceGlbUrl: string | null,
  api: PartEditorApi,
  version = 1,
): Promise<{ fields: ModelFields; thumbnailError: string | null }> {
  const doc = api.document();
  const fields: ModelFields = { material_edits: api.edits(), version: version + 1 };
  // The viewer lists parts after the GLB loads. Saving before that must not wipe the server list.
  if (doc.components.length) fields.components = doc;
  if (api.dirty()) {
    const blob = await api.exportGlb();
    if (blob) {
      fields.glb_url = await uploadPublicFile(vendorId, new File([blob], "edited.glb", { type: "model/gltf-binary" }), `${modelId}/model`);
      fields.source_glb_url = sourceGlbUrl || glbUrl;
    }
  }
  let thumbnailError: string | null = null;
  try {
    const image = await api.thumbnail();
    if (!image) throw new Error("the model is not rendered yet");
    // A new file name per save: listings never show a cached older image.
    fields.thumbnail_url = await uploadPublicFile(vendorId, new File([image], `thumbnail.${image.type === "image/webp" ? "webp" : "png"}`, { type: image.type }), `${modelId}/thumbnail`);
  } catch (caught) {
    thumbnailError = caught instanceof Error ? caught.message : String(caught);
  }
  return { fields, thumbnailError };
}

/** Update a model row. Before supabase/model_thumbnail.sql runs, the thumbnail columns are left out. */
export async function updateModel(id: string, row: Record<string, unknown>) {
  let result = await supabase().from("models").update(row).eq("id", id);
  if (result.error && /thumbnail_url|version/.test(result.error.message)) {
    const rest = { ...row };
    delete rest.thumbnail_url;
    delete rest.version;
    result = await supabase().from("models").update(rest).eq("id", id);
  }
  return result;
}
