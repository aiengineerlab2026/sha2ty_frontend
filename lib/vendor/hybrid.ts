import { apiFetch } from "@/lib/api";
import type { PartDocument } from "./parts";
import { pollTask } from "./generate";

/** A part of a model rebuilt from its photo (backend services/hybrid.py), as the editor reviews it. */
export type HybridPart = {
  id: string;
  name: string;
  nameAr?: string | null;
  generation?: "procedural" | "meshy";
  estimated?: boolean;
  material?: { class?: string; color?: string; fromPhoto?: boolean; confirmed?: boolean };
};
/** A complex part generated on its own by the mesh provider (backend api/hybrid_parts.py). */
export type GeneratedPart = { id: string; name: string; status: "pending" | "done" | "failed"; reason?: string | null; regenerable?: boolean; imageUrl?: string };
export type HybridDocument = PartDocument & {
  method?: string;
  sizeSource?: "vendor" | "photo" | "estimated";
  sizeM?: { width: number; height: number; depth: number };
  pendingComponents?: GeneratedPart[];
  componentFailures?: GeneratedPart[];
  hybrid?: { decorations?: { component: string; decoration: string; method: string; count?: number; reason?: string }[] };
  validation?: PartDocument["validation"] & { repairs?: string[] };
};
type Result = { glbUrl: string; components: HybridDocument };

export const isRebuilt = (doc: PartDocument | null | undefined): doc is HybridDocument =>
  Boolean(doc && ["hybrid", "deterministic"].includes(String((doc as HybridDocument).method)));

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await apiFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.detail === "string" ? json.detail : `Request failed (${res.status}).`);
  return json;
}

/** A finished answer, or a task to poll until it finishes (a generated component is still being made). */
async function settle(json: Record<string, unknown>): Promise<Result> {
  if (json.glb_url) return { glbUrl: json.glb_url as string, components: json.components as HybridDocument };
  const done = await pollTask(json.task_id as string, 40);
  return { glbUrl: done.glbUrl, components: done.components as HybridDocument };
}

/** The model made again at the vendor's confirmed sizes from its stored reading: no vision call, no try used. */
export async function rebuildAtSizes(modelId: string, sourceImageUrl: string, doc: HybridDocument, subject: { category: string; kind?: string },
  size: { width: number; height: number; depth?: number | null }): Promise<Result> {
  return settle(await post("/api/vendor/hybrid/rebuild", { model_id: modelId, source_image_url: sourceImageUrl, components: doc, category: subject.category,
    kind: subject.kind || null, width_m: size.width, height_m: size.height, depth_m: size.depth || null }));
}

/** The safe repairs on one part; every other part is left as it is. */
export async function repairPart(modelId: string, glbUrl: string, doc: HybridDocument, componentId: string): Promise<Result & { repairs: string[] }> {
  const json = await post("/api/vendor/hybrid/components/repair", { model_id: modelId, glb_url: glbUrl, components: doc, component_id: componentId });
  return { glbUrl: json.glb_url as string, components: json.components as HybridDocument, repairs: (json.repairs as string[]) ?? [] };
}

/** One complex part generated again (one generation try); the rest of the model is kept. */
export async function regeneratePart(modelId: string, glbUrl: string, doc: HybridDocument, componentId: string): Promise<Result> {
  return settle(await post("/api/vendor/hybrid/components/regenerate", { model_id: modelId, glb_url: glbUrl, components: doc, component_id: componentId }));
}

/** The vendor confirms (or un-confirms) a part's material as read from the photo; it is saved with the model. */
export function withMaterialConfirmed(doc: HybridDocument, componentId: string, confirmed: boolean): HybridDocument {
  return { ...doc, components: (doc.components as HybridPart[]).map((c) => (c.id === componentId ? { ...c, material: { ...c.material, confirmed } } : c)) } as HybridDocument;
}
