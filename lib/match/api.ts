import { API } from "@/lib/plan/api";
import { matchForm, splitLines, type MatchRequest, type MatchVariation } from "./match";

/** POST /api/match. The answer streams {"progress": n} lines (0–100) while the images are made,
 * then one line with the result or {"error": …}. Validation errors come back as plain JSON. */
export async function requestMatch(req: MatchRequest, signal?: AbortSignal, onProgress?: (percent: number) => void): Promise<{ variations: MatchVariation[]; warnings: string[] }> {
  let response: Response;
  try {
    response = await fetch(`${API}/api/match`, { method: "POST", body: matchForm(req), signal });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") throw caught;
    throw new Error("Cannot reach the API. Is the backend running on port 8000?");
  }
  if (!response.ok || !response.body) {
    const json = await response.json().catch(() => ({}));
    const detail = json.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: { msg?: string }) => d.msg).join(" ") : "Matching failed. Try again.");
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
      if (typeof event.progress === "number") onProgress?.(event.progress);
      if (event.success) {
        return {
          variations: (event.variations as MatchVariation[]).map((v) => ({ ...v, imageUrl: v.imageUrl.startsWith("http") ? v.imageUrl : `${API}${v.imageUrl}` })),
          warnings: (event.warnings as string[]) ?? [],
        };
      }
    }
    if (done) throw new Error("Matching failed. Try again.");
  }
}
