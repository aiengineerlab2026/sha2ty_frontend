import { apiFetch } from "@/lib/api";
import type { Design, DesignData, DesignKind, DesignVersion, ItemEdits } from "./schema";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(`/api/designs${path}`, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new Error("Cannot reach the server. Check your connection and try again.");
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = json.detail;
    const text = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(" ") : "";
    throw new Error(text || `Request failed (${response.status}).`);
  }
  return json as T;
}

const post = <T,>(path: string, body: object) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export const listDesigns = (kind?: DesignKind, offset = 0) =>
  call<{ designs: Design[]; limit: number; offset: number }>(`?${new URLSearchParams({ ...(kind ? { kind } : {}), offset: String(offset) })}`);
export const designForPlan = (planId: string) => call<{ designs: Design[] }>(`?plan_id=${encodeURIComponent(planId)}`).then((r) => r.designs[0] ?? null);
export const getDesign = (id: string) => call<Design>(`/${id}`);
export const listVersions = (id: string) => call<{ versions: DesignVersion[] }>(`/${id}/versions`).then((r) => r.versions);
export const getVersion = (id: string, number: number) => call<DesignVersion & { data: DesignData }>(`/${id}/versions/${number}`);

/** A design from a catalogue model. With `first`, the design's v1 is the customer's first save (edits, files);
 * `clientToken` makes a repeated first save return the same design. */
export const designFromModel = (
  modelId: string,
  title = "",
  first?: { item: ItemEdits; glb_url?: string | null; thumbnail_url?: string | null; note?: string; clientToken: string },
) =>
  post<Design>("/from-model", {
    model_id: modelId,
    title,
    ...(first ? { item: first.item, glb_url: first.glb_url ?? null, thumbnail_url: first.thumbnail_url ?? null, note: first.note ?? "", client_token: first.clientToken } : {}),
  });

/** A design from one of the user's own models (user_models): customised and requested like a catalogue one. */
export const designFromUserModel = (userModelId: string, title = "") => post<Design>("/from-user-model", { user_model_id: userModelId, title });

/** The user's design of their own model (the latest one), else a new one: so the model opens the same design each time. */
export async function designForUserModel(userModelId: string): Promise<string> {
  const mine = (await customisedModels()).find((d) => d.current?.data.item?.source.source_type === "user" && d.current.data.item.source.model_id === userModelId);
  return mine?.id ?? (await designFromUserModel(userModelId)).id;
}

/** "My customised models": the user's item designs with their latest version (for the planner). */
export const customisedModels = () => call<{ models: (Design & { current: (DesignVersion & { data: DesignData }) | null })[] }>("/library").then((r) => r.models);
export const designFromPlan = (planId: string, title = "") => post<Design>("/from-plan", { plan_id: planId, title });

/** One save = one version. `clientToken` makes a retried save (lost connection) return the same version. */
export const saveItemVersion = (id: string, body: { item: ItemEdits; glb_url?: string | null; thumbnail_url?: string | null; note: string; clientToken: string }) =>
  post<DesignVersion>(`/${id}/versions`, { item: body.item, glb_url: body.glb_url ?? null, thumbnail_url: body.thumbnail_url ?? null, note: body.note, client_token: body.clientToken });
export const savePlanVersion = (id: string, note: string, clientToken: string) => post<DesignVersion>(`/${id}/versions`, { note, client_token: clientToken });
export const restoreVersion = (id: string, number: number, clientToken: string) => post<DesignVersion>(`/${id}/restore`, { number, client_token: clientToken });
export const duplicateDesign = (id: string, title = "", number?: number) => post<Design>(`/${id}/duplicate`, { title, ...(number ? { number } : {}) });
export const renameDesign = (id: string, title: string) => call<Design>(`/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
export const deleteDesign = (id: string) => call<{ status: string }>(`/${id}`, { method: "DELETE" });
