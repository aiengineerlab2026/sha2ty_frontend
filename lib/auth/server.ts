/**
 * Server-only session handling. The Supabase access JWT and refresh token live in httpOnly cookies
 * (JavaScript never sees them); route handlers read them, refresh the access token when it is
 * about to expire, and attach it to Supabase / backend calls made on the user's behalf.
 */
import type { NextRequest, NextResponse } from "next/server";

export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const BACKEND_URL = (process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");

export const ACCESS_COOKIE = "sha2ty-access";
export const REFRESH_COOKIE = "sha2ty-refresh";
/** Signed admin session from the backend (/api/admin/login); forwarded as X-Admin-Token. */
export const ADMIN_COOKIE = "sha2ty-admin";
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days; Supabase rotates the token on every refresh
const SKEW = 60; // refresh a minute before expiry

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: unknown;
}

export const cookieBase = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export function setTokens(res: NextResponse, t: Tokens) {
  res.cookies.set(ACCESS_COOKIE, t.access_token, { ...cookieBase, maxAge: t.expires_in ?? 3600 });
  res.cookies.set(REFRESH_COOKIE, t.refresh_token, { ...cookieBase, maxAge: REFRESH_MAX_AGE });
}

export function clearTokens(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, "", { ...cookieBase, maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { ...cookieBase, maxAge: 0 });
}

/** Seconds since epoch when a JWT expires (0 when unreadable). Signature is checked by Supabase. */
export function jwtExpiry(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

/** Supabase Auth REST call with the project key. */
export function authApi(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, headers, ...rest } = init;
  return fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...rest,
    headers: { apikey: ANON_KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers ?? {}) },
    cache: "no-store",
  });
}

export async function refresh(refreshToken: string): Promise<Tokens | null> {
  const res = await authApi("/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) });
  return res.ok ? ((await res.json()) as Tokens) : null;
}

/**
 * The caller's valid access token, refreshing it with the refresh cookie when it expired.
 * `refreshed` carries new tokens to write back as cookies; `expired` means the refresh token was
 * rejected too (the cookies should be cleared: the user is signed out).
 */
export async function session(req: NextRequest): Promise<{ access: string | null; refreshed?: Tokens; expired?: boolean }> {
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  if (access && jwtExpiry(access) > Date.now() / 1000 + SKEW) return { access };
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return { access: null };
  const next = await refresh(refreshToken);
  return next ? { access: next.access_token, refreshed: next } : { access: null, expired: true };
}

/** Write back what `session()` found: rotated tokens, or cleared cookies after a failed refresh. */
export function persist(res: NextResponse, s: Awaited<ReturnType<typeof session>>) {
  if (s.refreshed) setTokens(res, s.refreshed);
  else if (s.expired) clearTokens(res);
  return res;
}

const HOP = ["connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "host"];

/** Forward a request (method, headers, streamed body) to `target`, with the session's bearer token. */
export async function forward(req: NextRequest, target: string, extra: Record<string, string> = {}) {
  const s = await session(req);
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP.includes(key) && key !== "cookie" && key !== "authorization") headers.set(key, value);
  });
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  if (s.access) headers.set("Authorization", `Bearer ${s.access}`);
  const admin = req.cookies.get(ADMIN_COOKIE)?.value;
  if (admin) headers.set("X-Admin-Token", admin);
  else headers.delete("x-admin-token"); // only ever from the httpOnly cookie
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    // @ts-expect-error Node's fetch needs duplex to stream a request body
    duplex: hasBody ? "half" : undefined,
    cache: "no-store",
    redirect: "manual",
  });
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP.includes(key)) out.set(key, value);
  });
  const { NextResponse } = await import("next/server");
  return persist(new NextResponse(upstream.body, { status: upstream.status, headers: out }), s);
}
