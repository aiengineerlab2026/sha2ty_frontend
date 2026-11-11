import { apiFetch } from "@/lib/api";
import type { PartDocument } from "./parts";
import type { ModelProvider, ModelStates } from "./types";

import { publish } from "@/lib/events";

export type GenerateProgress = { percent: number; status: string };

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
  subject?: { category: string; title: string; kind?: string; lang?: "ar" | "en" },
  /** A wardrobe with open and closed states: the photo of it open (`file` is the closed one). */
  openFile?: File,
): Promise<{ glbUrl: string; reading: PhotoReading | null; components: PartDocument | null; sourceGlbUrl: string | null; states: ModelStates | null }> {
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
  }

  onProgress?.({ percent: 4, status: "Uploading photo…" });
  const stopPulse = provider !== "meshy" ? pulseProgress(onProgress) : null;

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
  let last = 8;
  onProgress?.({ percent: last, status: "Queued for conversion…" });

  for (let i = 0; i < 180; i++) {
    const polled = await apiFetch(`/api/vendor/tasks/${taskId}`);
    const task = await polled.json().catch(() => ({}));
    if (!polled.ok) throw new Error(detail(task) || "Could not check generation status.");
    const reported = Number(task.progress);
    last = Number.isFinite(reported) ? Math.max(last, Math.min(99, reported)) : last;
    onProgress?.({ percent: last, status: conversionLabel(String(task.status || ""), last) });
    if (task.status === "SUCCEEDED" && task.glb_url) {
      onProgress?.({ percent: 100, status: "Saving model to CDN…" });
      // glb_url is the split (modular) model when the backend could separate parts; source_glb_url the untouched one.
      return { glbUrl: task.glb_url as string, reading, components: (task.components as PartDocument) ?? null, sourceGlbUrl: (task.source_glb_url as string) ?? null, states: null };
    }
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(task.error || "Generation failed.");
    }
    await wait(task.retry_after_seconds ? Number(task.retry_after_seconds) * 1000 : 4000);
  }
  throw new Error("Generation timed out. Try again.");
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

function conversionLabel(status: string, percent: number): string {
  if (status === "PENDING") return "Queued for conversion…";
  if (percent < 35) return "Analyzing the photo…";
  if (percent < 75) return "Building the 3D mesh…";
  if (percent < 100) return "Texturing the model…";
  return "Finishing conversion…";
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
