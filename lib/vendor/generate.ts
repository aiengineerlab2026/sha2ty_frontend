import { apiFetch } from "@/lib/api";
import type { PartDocument } from "./parts";
import type { ModelProvider, ModelStates } from "./types";

import { publish } from "@/lib/events";

import { progressFrom, type GenerateProgress } from "./meshyPhases";

export { AWAITING_APPROVAL, MESHY_PHASES, type GenerateProgress, type GenerateStep } from "./meshyPhases";

/** How the model is made (backend services/hybrid.py): rebuilt part by part from the photo ("hybrid", the default;
 * "deterministic" the same engine), or by the 3D generator ("meshy": the admin's Meshy / GPT Astra / Sol). */
export type GenerationMode = "hybrid" | "deterministic" | "meshy";
export const GENERATION_MODES: { id: GenerationMode; label: string; hint: string }[] = [
  { id: "hybrid", label: "Rebuilt part by part (recommended)", hint: "Straight panels, separate doors and handles, the photo's own colours. Mostly upholstered or carved pieces go to the 3D generator." },
  { id: "meshy", label: "3D generator", hint: "A sculpted mesh from the photo: better for sofas, carvings and organic shapes; parts may be fused." },
];
/** The steps of a part-by-part rebuild, shown while it runs (it answers in one request: the step is estimated). */
export const HYBRID_STAGES = ["Image analysis", "Component detection", "Structural reconstruction", "Decorative reconstruction", "Material processing", "Model assembly", "Validation", "Export"];

/** A finished conversion. taskId: the backend task (Meshy), for "Retry Auto Split" while it is kept (about an hour). */
type Generated = { glbUrl: string; reading: PhotoReading | null; components: PartDocument | null; sourceGlbUrl: string | null; states: ModelStates | null; taskId?: string };

/** The vision model's reading of the photo: size estimate (metres; null when it could not tell) and a listing. */
export type PhotoReading = {
  width_m: number | null;
  height_m: number | null;
  depth_m: number | null;
  /** What it is ("three-seat sofa"), a short catalogue name and a plain one-or-two sentence description. */
  object_type: string;
  name: string;
  description: string;
};

export async function generateFromPhoto(
  file: File,
  provider: ModelProvider,
  modelId: string,
  onProgress?: (progress: GenerateProgress) => void,
  imageUrl?: string,
  /** What to extract (catalogue category, product title, furniture type); the backend builds the Meshy / Astra prompt. */
  subject?: { category: string; title: string; kind?: string; lang?: "ar" | "en"; mode?: GenerationMode; size?: { width?: number | null; height?: number | null; depth?: number | null } },
  /** A wardrobe with open and closed states: the photo of it open (`file` is the closed one). */
  openFile?: File,
): Promise<Generated> {
  const body = new FormData();
  body.append("image", file);
  body.append("provider", provider);
  body.append("model_id", modelId);
  body.append("should_texture", "true");
  if (imageUrl) body.append("image_url", imageUrl);
  if (openFile) body.append("open_image", openFile);
  if (subject) {
    body.append("category", subject.category);
    body.append("title", subject.title);
    if (subject.kind) body.append("kind", subject.kind);
    // The generated name and description come back in the interface language.
    if (subject.lang) body.append("lang", subject.lang);
    if (subject.mode) body.append("mode", subject.mode);
    // The vendor's own measurements (metres) win over the photo's estimate.
    for (const [key, value] of [["width_m", subject.size?.width], ["height_m", subject.size?.height], ["depth_m", subject.size?.depth]] as const) {
      if (value && value > 0) body.append(key, String(value));
    }
  }

  const rebuilt = subject?.mode !== undefined && subject.mode !== "meshy";
  onProgress?.(rebuilt ? { percent: 4, status: `${HYBRID_STAGES[0]}…` } : provider === "meshy" ? { percent: 4, status: "Preparing furniture image…", phase: "preparing" } : { percent: 4, status: "Uploading photo…" });
  const stopPulse = rebuilt ? stagePulse(onProgress) : provider !== "meshy" ? pulseProgress(onProgress) : null;

  const created = await apiFetch(`/api/vendor/generate`, {
    method: "POST",
    body,
  });
  stopPulse?.();
  const json = await created.json().catch(() => ({}));
  if (!created.ok) {
    publish("generation.finished", { provider, ok: false });
    throw new Error(detail(json) || `Generate failed (${created.status}).`);
  }
  if (typeof json.remaining === "number") publish("generation.started", { provider, remaining: json.remaining });
  // The backend reads the photo before generating (Meshy or Astra alike): its size estimate and listing fill
  // what the vendor left empty.
  const d = json.details;
  const reading: PhotoReading | null = d
    ? { width_m: d.width_m ?? null, height_m: d.height_m ?? null, depth_m: d.depth_m ?? null, object_type: d.object_type ?? "", name: d.name ?? "", description: d.description ?? "" }
    : null;
  if (json.glb_url) {
    onProgress?.({ percent: 100, status: "Conversion complete" });
    return { glbUrl: json.glb_url as string, reading, components: (json.components as PartDocument) ?? null, sourceGlbUrl: (json.source_glb_url as string) ?? null, states: statesFrom(json.states) };
  }

  const taskId = json.task_id as string;
  onProgress?.({ percent: 8, status: "Queued for conversion…" });
  return { ...(await pollTask(taskId, 8, onProgress)), reading };
}

/** Poll a conversion task until it finishes (or fails). */
export async function pollTask(taskId: string, last: number, onProgress?: (progress: GenerateProgress) => void): Promise<Omit<Generated, "reading">> {
  for (let i = 0; i < 360; i++) {
    const polled = await apiFetch(`/api/vendor/tasks/${taskId}`);
    const task = await polled.json().catch(() => ({}));
    if (!polled.ok) throw new Error(detail(task) || "Could not check generation status.");
    const progress = progressFrom(task, last);
    last = progress.percent;
    onProgress?.(progress);
    if (task.status === "SUCCEEDED" && task.glb_url) {
      onProgress?.({ percent: 100, status: "Saving model to CDN…" });
      // glb_url is the split (modular) model when the backend could separate parts; source_glb_url the untouched one.
      return { glbUrl: task.glb_url as string, components: (task.components as PartDocument) ?? null, sourceGlbUrl: (task.source_glb_url as string) ?? null, states: null, taskId };
    }
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(task.error || "Generation failed.");
    }
    await wait(task.retry_after_seconds ? Number(task.retry_after_seconds) * 1000 : 4000);
  }
  throw new Error("Generation timed out. Try again.");
}

/** The answer to an unchecked cleaned image (phase awaiting_approval): mesh it, or mesh the original photo. The
 * conversion's own poll loop then carries on. */
export async function decideCleaning(taskId: string, use: "cleaned" | "original"): Promise<void> {
  const res = await apiFetch(`/api/vendor/tasks/${taskId}/cleaning`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ use }) });
  if (!res.ok) throw new Error(detail(await res.json().catch(() => ({}))) || `Could not send your choice (${res.status}).`);
}

/** Meshy Auto Split again on the same finished 3D model (no new generation, no try used), then the new model. */
export async function retrySplit(taskId: string, onProgress?: (progress: GenerateProgress) => void): Promise<Omit<Generated, "reading">> {
  const res = await apiFetch(`/api/vendor/tasks/${taskId}/retry-split`, { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(detail(json) || `Could not retry Auto Split (${res.status}).`);
  onProgress?.(progressFrom(json, 90));
  return pollTask(taskId, 90, onProgress);
}

function statesFrom(raw: unknown): ModelStates | null {
  const open = (raw as { open?: { glb_url?: string; components?: PartDocument } } | null)?.open;
  return open?.glb_url ? { open: { glb_url: open.glb_url, components: open.components ?? null } } : null;
}

/** One photo showing a wardrobe both closed and open, cut into its two photos by the vision model (no try used). */
export async function splitStates(file: File): Promise<{ closed: File; open: File }> {
  const body = new FormData();
  body.append("image", file);
  const res = await apiFetch(`/api/vendor/split-states`, { method: "POST", body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(detail(json) || `Could not split the photo (${res.status}).`);
  const toFile = async (dataUrl: string, name: string) => new File([await (await fetch(dataUrl)).blob()], name, { type: "image/jpeg" });
  return { closed: await toFile(json.closed, "closed.jpg"), open: await toFile(json.open, "open.jpg") };
}

/** Generation tries left per provider for the signed-in vendor, and the generator in use (the admin's choice), or
 * null when unavailable. */
export async function fetchGenerationQuota(): Promise<{ remaining: Record<ModelProvider, number>; provider: ModelProvider } | null> {
  const res = await apiFetch(`/api/vendor/generation-quota`).catch(() => null);
  if (!res?.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.remaining ? { remaining: body.remaining, provider: body.provider ?? "meshy" } : null;
}

/** A part-by-part rebuild answers in one request: its stages are shown by elapsed time, about 3 s each. */
function stagePulse(onProgress?: (progress: GenerateProgress) => void) {
  let i = 0;
  const timer = setInterval(() => {
    i = Math.min(HYBRID_STAGES.length - 1, i + 1);
    onProgress?.({ percent: Math.round(8 + (i / HYBRID_STAGES.length) * 84), status: `${HYBRID_STAGES[i]}…` });
  }, 3000);
  return () => clearInterval(timer);
}

function pulseProgress(onProgress?: (progress: GenerateProgress) => void) {
  let percent = 8;
  onProgress?.({ percent, status: "Converting photo to 3D…" });
  const timer = setInterval(() => {
    percent = Math.min(90, percent + 4);
    onProgress?.({
      percent,
      status: percent < 40 ? "Sending photo to Astra…" : "Generating 3D model…",
    });
  }, 1500);
  return () => clearInterval(timer);
}

function detail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as { detail?: unknown }).detail;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length) {
    const first = value[0] as { msg?: string };
    if (first?.msg) return first.msg;
  }
  return null;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
