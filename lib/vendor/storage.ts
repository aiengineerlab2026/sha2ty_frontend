import { apiFetch } from "@/lib/api";

/** Uploads to the platform's file storage (Cloudflare R2, through the backend's POST /api/files) and returns the
 * file's public URL. The backend files it under the signed-in user's own folder. */
// ponytail: userId kept so callers compile; the backend takes the folder owner from the session.
export async function uploadPublicFile(_userId: string, file: File, folder: string): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  body.append("folder", folder);
  const response = await apiFetch("/api/files", { method: "POST", body });
  const json = (await response.json().catch(() => ({}))) as { url?: string; detail?: string };
  if (!response.ok || !json.url) throw new Error(json.detail || `Upload failed (${response.status}).`);
  return json.url;
}
