import { splitLines } from "@/lib/match/match";
import type { CompanyGroup, CorrectionState, PlanGeometry, SavedPlan } from "./types";

/** The FastAPI backend, through the same-origin proxy that adds the user's JWT from the httpOnly
 * cookie (app/api/backend). Guests go through it too, without a token. */
export const API = "/api/backend";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: init.headers,
    });
  } catch {
    throw new Error("Cannot reach the API. Is the backend running on port 8000?");
  }
  if (path.includes("/export") && response.ok) {
    return (await response.blob()) as T;
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = json.detail;
    if (detail && typeof detail === "object" && Array.isArray(detail.errors)) {
      throw new PlanValidationError(String(detail.message ?? "Validation failed."), detail.errors.map(String));
    }
    throw new Error(typeof detail === "string" ? detail : `Request failed (${response.status}).`);
  }
  return json as T;
}

export class PlanValidationError extends Error {
  constructor(
    message: string,
    public errors: string[],
  ) {
    super(message);
  }
}

/** Public catalogue read: works signed out (no Authorization header needed). */
async function publicGet<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`);
  } catch {
    throw new Error("Cannot reach the API. Is the backend running on port 8000?");
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json.detail === "string" ? json.detail : `Request failed (${response.status}).`);
  return json as T;
}

/** `require3d: false` also lists photo-only models (the shop); the plan builder needs a GLB. */
export function fetchCatalog(q = "", offset = 0, require3d = true) {
  const params = new URLSearchParams({ q, limit: "40", offset: String(offset), require_3d: String(require3d) });
  return publicGet<{ companies: CompanyGroup[]; count: number }>(`/api/plans/models?${params}`);
}

/** One catalogue model by id (any vendor's), or null when it is not ready / not found. */
export async function fetchCatalogModel(id: string) {
  const data = await publicGet<{ companies: CompanyGroup[] }>(`/api/plans/models?${new URLSearchParams({ id, limit: "1", require_3d: "false" })}`);
  return data.companies[0]?.models[0] ?? null;
}

export function createRoomFromDimensions(body: { width: number; depth: number; height: number; wall_thickness: number; name?: string }) {
  return request<PlanGeometry>("/api/plans/from-dimensions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type PlanProgress = { stage: string; percent: number };

/** Upload → the backend streams {"stage", "progress"} lines (Analyzing → Extracting rooms → Estimating
 * dimensions → Generating 3D), then {"success": true, "plan": …}. Bad uploads come back as plain JSON. */
export async function createRoomFromImage(file: File, height: number, onProgress?: (progress: PlanProgress) => void) {
  const data = new FormData();
  data.append("image", file);
  data.append("height", String(height));
  data.append("debug", "true");
  let response: Response;
  try {
    response = await fetch(`${API}/api/plans/from-image`, {
      method: "POST",
      body: data,
    });
  } catch {
    throw new Error("Cannot reach the API. Is the backend running on port 8000?");
  }
  if (!response.ok || !response.body) {
    const json = await response.json().catch(() => ({}));
    throw new Error(typeof json.detail === "string" ? json.detail : "Could not read the floor plan.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const { events, rest } = splitLines(done ? `${buffer}\n` : buffer);
    buffer = rest;
    for (const event of events) {
      if (typeof event.error === "string") throw new Error(event.error);
      if (typeof event.progress === "number") onProgress?.({ stage: String(event.stage ?? ""), percent: event.progress });
      if (event.success) return event.plan as PlanGeometry;
    }
    if (done) throw new Error("Could not read the floor plan.");
  }
}

/** Re-detect rooms from edited walls (preview, never blocks). */
export function resegmentPlan(state: CorrectionState, signal?: AbortSignal) {
  return request<PlanGeometry>("/api/plans/segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
    signal,
  });
}

/** Build the 3D apartment. Throws PlanValidationError while the plan has blocking problems. */
export function rebuildFromGeometry(state: CorrectionState, height: number) {
  return request<PlanGeometry>("/api/plans/from-geometry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...state, height }),
  });
}

export function validateItem(geometry: PlanGeometry, item: Record<string, unknown>, others: Record<string, unknown>[]) {
  return request<{ warnings: string[]; valid: boolean }>("/api/plans/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geometry, item, others }),
  });
}

export function savePlan(body: object, id?: string) {
  return request<SavedPlan>(id ? `/api/plans/${id}` : "/api/plans", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function loadPlan(id: string) {
  return request<SavedPlan>(`/api/plans/${id}`);
}

export function listPlans() {
  return request<{ plans: { id: string; name: string; updated_at: string }[] }>("/api/plans");
}

export async function exportRoomGlb(id: string) {
  const response = await fetch(`${API}/api/plans/${id}/export?format=glb`);
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(typeof json.detail === "string" ? json.detail : "Export failed.");
  }
  return response.blob();
}

/** Carpet photo → PNG of only the carpet, straightened top-down at width × length (backend OpenCV). */
export async function extractCarpet(image: Blob, widthM: number, lengthM: number): Promise<Blob> {
  const form = new FormData();
  form.append("image", image, "carpet");
  form.append("width_m", String(widthM));
  form.append("length_m", String(lengthM));
  let response: Response;
  try {
    response = await fetch(`${API}/api/vendor/carpets/extract`, { method: "POST", body: form });
  } catch {
    throw new Error("Cannot reach the API. Is the backend running on port 8000?");
  }
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(typeof json.detail === "string" ? json.detail : `Extraction failed (${response.status}).`);
  }
  return response.blob();
}
