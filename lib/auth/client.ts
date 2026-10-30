"use client";

/**
 * Browser auth. The session is two httpOnly cookies set by /api/auth (access JWT + refresh token),
 * so nothing here can read a token: it asks the server who is signed in, and every Supabase /
 * backend request goes through the same-origin proxies, which attach the token server-side.
 */
export interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

const listeners = new Set<(user: AuthUser | null) => void>();
let current: Promise<AuthUser | null> | null = null;

/** The signed-in user (one request per page, shared by every caller). */
export function getUser(force = false): Promise<AuthUser | null> {
  if (!current || force) {
    current = fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => (j.user as AuthUser | null) ?? null)
      .catch(() => null);
  }
  return current;
}

/** Drop-in for the old `supabase().auth.getSession()` shape: `{ data: { session: { user } | null } }`. */
export async function authSession() {
  const user = await getUser();
  return { data: { session: user ? { user } : null } };
}

export function onAuthChange(listener: (user: AuthUser | null) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

async function changed() {
  const user = await getUser(true);
  listeners.forEach((l) => l(user));
  return user;
}

async function post(action: string, body?: unknown): Promise<{ error?: string; [k: string]: unknown }> {
  try {
    const res = await fetch(`/api/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), credentials: "same-origin" });
    const json = await res.json().catch(() => ({}));
    return res.ok ? json : { error: String(json.error ?? `Request failed (${res.status}).`) };
  } catch {
    return { error: "Cannot reach the server. Check your connection and try again." };
  }
}

export async function login(email: string, password: string) {
  const result = await post("login", { email, password });
  if (!result.error) await changed();
  return result;
}

export async function logout() {
  await post("logout");
  await changed();
}

export const requestPasswordReset = (email: string, redirectTo: string) => post("recover", { email, redirectTo });

/** On the reset page: a recovery link puts tokens in the URL fragment; trade them for cookies. */
export async function recoverFromLink(): Promise<boolean> {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (hash.get("type") !== "recovery" || !hash.get("access_token") || !hash.get("refresh_token")) return false;
  history.replaceState(null, "", window.location.pathname + window.location.search); // tokens out of the address bar
  const result = await post("session", { access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token"), expires_in: hash.get("expires_in") });
  if (result.error) return false;
  await changed();
  return true;
}

export const updatePassword = (password: string) => post("password", { password });
