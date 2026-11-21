/** The FastAPI backend: every API call goes straight to it (the frontend has no API of its own). The session is its
 * httpOnly cookies, so each request sends credentials; the backend's CORS allows this site's origin. */
function base(): string {
  const configured = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
  if (typeof window === "undefined") return configured;
  // ponytail: development over the LAN (the mobile app's web view opens 192.168.x.x:3000): a localhost backend is
  // this same machine. Production sets a real API host and is left as is.
  const url = new URL(configured);
  if (url.hostname === "localhost" && window.location.hostname !== "localhost") url.hostname = window.location.hostname;
  return url.origin;
}

export const API = base();

export const apiFetch = (path: string, init: RequestInit = {}) => fetch(`${API}${path}`, { credentials: "include", ...init });

/** A stored file link. Local dev has advertised :8010 while this app calls :8000; load the file from the API that is up. */
export function assetUrl(url: string): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
  try {
    const parsed = new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    const localFile = parsed.pathname.startsWith("/api/files") && parsed.hostname === "localhost" && (parsed.port === "8010" || parsed.port === "8000");
    if (!localFile) return url;
    const api = new URL(API);
    parsed.protocol = api.protocol;
    parsed.hostname = api.hostname;
    parsed.port = api.port;
    return parsed.toString();
  } catch {
    return url;
  }
}
