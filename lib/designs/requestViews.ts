import { captureViews } from "@/lib/designs/captureViews";
import type { ItemDesign, SourceModel } from "@/lib/designs/schema";
import { PARTS_SHEET, VIEWS_VERSION } from "@/lib/designs/viewParts";
import { apiFetch } from "@/lib/api";
import type { DesignSpec, RequestViews } from "@/lib/tasks";
import { uploadPublicFile } from "@/lib/vendor/storage";
import type { MaterialEdit } from "@/lib/vendor/parts";

/** The request report's pictures of a saved model (closed with its size; opened, and close-ups, with each part's
 * dimensions written beside it) and its parts table: rendered from the model's file and uploaded under `folder`. */
export async function makeRequestViews(glbUrl: string, item: ItemDesign, lang: "ar" | "en", folder: string): Promise<RequestViews> {
  const views = await captureViews({ glbUrl, item, lang });
  const up = (blob: Blob, name: string) => uploadPublicFile("", new File([blob], name, { type: blob.type || "image/png" }), folder);
  const [closed_url, open_url, pictures_url, ...detail_urls] = await Promise.all([up(views.closed, "closed.png"), up(views.open, "open.png"), up(views.pictures, "parts.jpg"), ...views.details.map((d, i) => up(d, `detail-${i + 1}.png`))]);
  return { overall: views.overall, detail_groups: views.detailGroups, closed_url, open_url, pictures_url, pic_size: PARTS_SHEET.size, pic_cols: PARTS_SHEET.cols, detail_urls, scale_known: views.scaleKnown, opened: views.opened, parts: views.parts, version: views.version };
}

/** Pictures to make again: none, older than this app's, or without the parts' pictures (whatever version they claim:
 * a save to a server that did not know the parts' pictures yet dropped them). */
export const outdatedViews = (spec: DesignSpec | undefined) =>
  Boolean(spec?.glb_url) && (!spec?.views || (spec.views.version ?? 1) < VIEWS_VERSION || !spec.views.pictures_url);

/** The model as the request froze it, in the shape the pictures are made from (the editor's saved item). */
export function itemOfSpec(spec: DesignSpec): ItemDesign {
  const s = spec.source;
  return {
    source: { model_id: s.model_id, title: s.title, vendor_id: s.vendor_id ?? null, width_m: s.width_m ?? null, height_m: s.height_m ?? null, depth_m: s.depth_m ?? null, glb_url: spec.catalogue_glb_url ?? spec.glb_url } as SourceModel,
    dimensions: spec.dimensions ?? undefined,
    components: spec.part_document ?? { components: spec.parts.map((p) => ({ id: p.id, name: p.name, editable: false })) },
    material_edits: Object.fromEntries(spec.materials.map(({ part_id, ...edit }) => [part_id, edit as MaterialEdit])),
  };
}

/** The customer's own request: its pictures made again from the request's frozen model and stored with it. */
export async function refreshTaskViews(taskId: string, spec: DesignSpec, lang: "ar" | "en"): Promise<RequestViews> {
  const views = await makeRequestViews(spec.glb_url!, itemOfSpec(spec), lang, `tasks/${taskId}/views`);
  const res = await apiFetch(`/api/tasks/${taskId}/views`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(views) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { detail?: string }).detail || `Could not update the request's pictures (${res.status}).`);
  return views;
}
