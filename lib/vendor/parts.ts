import { supabase } from "@/lib/supabase/client";
import { uploadPublicFile } from "./storage";
import type { PartMaterial } from "@/lib/designs/materials";

/** Meshes that exist in the GLB. A one-mesh model has a single editable entry, not invented cushions. */
/** `id` is stable; `name` is what the vendor sees (renamable). `naming`: how the name was found (part_names.py). */
/** Another shape a vendor offers for one part (other legs, another headboard): its own GLB, fitted into the part's
 * space when a customer picks it. `price_delta`: what it adds to (or takes off) the price, in EGP. */
/** `offered`: false hides it from customers (the vendor keeps it); absent = offered. */
export type PartVariant = { id: string; name: string; glb_url: string; price_delta?: number | null; offered?: boolean };
/** A part type (lib/vendor/parts3d library: shelf, drawer, leg…) the vendor lets customers add to this model, with
 * what each one adds to the price (EGP; null: priced in the vendor's bid). Nothing listed: customers add nothing. */
export type AddablePart = { type: string; price_delta?: number | null };
/** `nameAr`: the Arabic name the vision analysis gave the part (naming "vision"); `analysisId`: its component there. */
export type PartInfo = { id: string; name: string; nameAr?: string | null; analysisId?: string; editable: boolean; naming?: "file" | "geometry" | "ai" | "unidentified" | "vendor" | "vision" | "estimated"; estimated?: boolean; variants?: PartVariant[];
  /** What it is for the carpenter (backend services/geometry_quality.py): decorative parts are not in the parts list by default. */
  class?: "structural" | "upholstery" | "decorative" | "other" };
/** The generated model's geometry report (backend services/geometry_quality.py): measured, repaired and left as is. */
export type GeometryQuality = { triangles?: { original: number; afterRepair: number; ar: number | null }; repairs?: string[]; warnings?: string[]; unresolved?: string[]; manufacturing?: string };
/** The backend's check before saving (services/model_check.py): errors are visible damage, warnings worth a look. */
export type Swatch = { hex: string; share: number };
/** `appearance`: the model's front view against the photo's colours (the main colours of each, largest share first). */
export type ModelValidation = { ok: boolean; errors: string[]; warnings: string[]; parts: number; appearance?: { ok: boolean; issues: string[]; reference?: Swatch[]; model?: Swatch[] } };
/** The backend's vision analysis of the photo (services/mesh_analysis.py), kept with the model for later editing and
 * regeneration; `modularity`: how many of its components the generated meshes turned out to be. */
export type MeshAnalysis = { objectType: string; summary?: string; components: Record<string, unknown>[] };
/** The cleaned image's check (backend fidelity._compare_removal): an inconclusive check is never a pass. */
export type CleaningCheck = { status?: "passed" | "failed" | "inconclusive"; issues?: string[]; notes?: string[]; checked?: string[]; decision?: "cleaned" | "original" };
export type Modularity = { level: "full" | "partial" | "none"; matched: string[]; missing: string[]; unmatchedMeshes: string[]; note?: string | null };
export type CarpenterPart = {
  id: string; name: string; source: "observed" | "inferred"; materialCategory: string; classification: string; role?: string;
  /** The photo-reading component it was built from: the link to the visual part with the same `analysisId`. */
  specId?: string; materialClass?: string;
  sizeCm: { width: number; height: number; depth: number }; positionCm: { x: number; y: number; z: number }; orientation: number[]; estimated: boolean;
};
/** One part's material, read from the photo (backend services/material_spec.py): shared by both models. */
export type MaterialSpec = { class: string; color?: string | null; finish?: string; woodType?: string | null; roughness?: number; metallic?: number; confidence?: number; source?: string };
export type CarpenterModel = {
  url?: string; fabricationReady: boolean; estimated: boolean; note: string; furnitureType?: string;
  /** Built from the photo's spec (backend services/structural.py); what it could not tell. */
  source?: string; uncertain?: string[]; sizeM?: { width: number; height: number; depth: number }; scaleKnown?: boolean;
  /** The vendor's edits to the structural model (its own file; the visual model is never changed by them). */
  material_edits?: Record<string, MaterialEdit>;
  materials?: Record<string, MaterialSpec>;
  components: CarpenterPart[]; excluded: { name: string; reason: string }[];
  checks?: { closed?: boolean; triangles?: number; warnings?: string[] };
  hierarchy?: { name: string; children: { name: string; components: string[] }[] };
};
/** Where the visual model lost fidelity (backend services/fidelity.py): each stage against the one before it. */
export type FidelityStage = { stage: "cleaning" | "provider" | "processing" | "materials" | "structural" | "split"; ok: boolean | null; issues: string[]; notes?: string[]; rejected?: boolean };
export type FidelityReport = { ok: boolean; quality: "ok" | "low"; lostAt: string | null; structuralOk?: boolean | null; stages: FidelityStage[] };
export type PartDocument = {
  modelType?: string; separated?: boolean; components: PartInfo[]; limits?: string | null; method?: string; validation?: ModelValidation;
  fidelity?: FidelityReport;
  /** The provider's GLB exactly as it arrived, before any processing. */
  raw_glb_url?: string;
  /** The structural model's status (built or not, and what it could not tell). */
  structural?: { built: boolean; uncertain?: string[]; source?: string };
  /** Meshy Auto Split's actual result (backend services/fidelity.split_check): used only when `accepted`. */
  split?: { accepted: boolean; status?: string | null; issues?: string[]; meshesBefore?: number | null; meshesAfter?: number | null; partCount?: number | null; promptIgnored?: boolean | null; error?: string | null; taskId?: string | null; prompt?: string | null; triangles?: number[] | null; shape?: { silhouette?: number; colourDE?: number | null } | null };
  /** Exactly what Meshy meshed: the original photo or a cleaned one that passed validation, and its texture guide. */
  meshyInput?: { source: "original" | "cleaned"; url?: string | null; sha256?: string | null; texture?: string };
  /** The cleaning step: its check against the original, and whether the cleaned photo was refused. */
  cleaning?: { cleaned?: boolean; rejected?: boolean; used?: "cleaned" | "original"; image_url?: string; imageTaskId?: string | null; fallback?: { what: string; reason: string };
    check?: CleaningCheck };
  /** The shared material spec, per photo-reading component id. */
  materials?: { parts: Record<string, MaterialSpec>; estimated?: boolean; note?: string };
  quality?: GeometryQuality;
  /** A lighter copy for mobile AR, made in the background (the full model is used until it exists). */
  ar?: { url: string; status: string };
  /** Closed wooden solids for review (backend services/carpenter.py). Never the visual file. */
  carpenter?: CarpenterModel;
  analysis?: MeshAnalysis; modularity?: Modularity; conditioning?: Record<string, unknown>;
  /** Movable parts (lib/vendor/animation.ts), detected at generation and corrected by the vendor. */
  animation?: import("./animation").AnimationConfig;
  /** Parts added in the editor (lib/vendor/parts3d.ts): regenerated from these when resized, never stretched. */
  added?: import("./parts3d").AddedSpec[];
  /** What customers may add (the vendor's choice; backend app/services/shopper_choices.py enforces it on save). */
  addable?: AddablePart[];
};
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
  /** The variant picked for each part (part id → variant id); parts left as in the file are not listed. */
  partVariants?: () => Record<string, string>;
  /** Parts shown in the view (the customer's choice of what to have made). */
  visibleParts?: () => string[];
  /** After a save: nothing unsaved until the next change. */
  markClean?: () => void;
  /** Vendors, before publishing: every part variant opens, and no two choices of a part look the same. Problems in
   * words (empty: fine). */
  checkVariants?: () => Promise<string[]>;
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
  /** false for another state (an open wardrobe): the product's picture is its closed state. */
  thumbnail = true,
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
  if (!thumbnail) return { fields, thumbnailError };
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
