import type { ModelProvider } from "./types";

import { API } from "@/lib/plan/api"; // same-origin proxy: the JWT comes from the httpOnly cookie

export type GenerateProgress = { percent: number; status: string };

export async function generateFromPhoto(
  file: File,
  provider: ModelProvider,
  modelId: string,
  onProgress?: (progress: GenerateProgress) => void,
  imageUrl?: string,
  /** What to extract (catalogue category + product title); the backend builds the Meshy / Astra prompt. */
  subject?: { category: string; title: string },
): Promise<string> {
  const body = new FormData();
  body.append("image", file);
  body.append("provider", provider);
  body.append("model_id", modelId);
  body.append("should_texture", "true");
  if (imageUrl) body.append("image_url", imageUrl);
  if (subject) {
    body.append("category", subject.category);
    body.append("title", subject.title);
  }

  onProgress?.({ percent: 4, status: "Uploading photo…" });
  const stopPulse = provider === "astra" ? pulseProgress(onProgress) : null;

  const created = await fetch(`${API}/api/vendor/generate`, {
    method: "POST",
    body,
  });
  stopPulse?.();
  const json = await created.json().catch(() => ({}));
  if (!created.ok) throw new Error(detail(json) || `Generate failed (${created.status}).`);
  if (json.glb_url) {
    onProgress?.({ percent: 100, status: "Conversion complete" });
    return json.glb_url as string;
  }

  const taskId = json.task_id as string;
  let last = 8;
  onProgress?.({ percent: last, status: "Queued for conversion…" });

  for (let i = 0; i < 180; i++) {
    const polled = await fetch(`${API}/api/vendor/tasks/${taskId}`);
    const task = await polled.json().catch(() => ({}));
    if (!polled.ok) throw new Error(detail(task) || "Could not check generation status.");
    const reported = Number(task.progress);
    last = Number.isFinite(reported) ? Math.max(last, Math.min(99, reported)) : last;
    onProgress?.({ percent: last, status: conversionLabel(String(task.status || ""), last) });
    if (task.status === "SUCCEEDED" && task.glb_url) {
      onProgress?.({ percent: 100, status: "Saving model to CDN…" });
      return task.glb_url as string;
    }
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(task.error || "Generation failed.");
    }
    await wait(task.retry_after_seconds ? Number(task.retry_after_seconds) * 1000 : 4000);
  }
  throw new Error("Generation timed out. Try again.");
}

/** Generation tries left per provider for the signed-in vendor, or null when unavailable. */
export async function fetchGenerationQuota(): Promise<Record<ModelProvider, number> | null> {
  const res = await fetch(`${API}/api/vendor/generation-quota`).catch(() => null);
  if (!res?.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.remaining ?? null;
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
