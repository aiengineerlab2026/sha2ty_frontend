import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, BACKEND_URL, authApi, clearTokens, cookieBase, persist, session, setTokens, type Tokens } from "@/lib/auth/server";

/**
 * Cookie-based auth for the browser (tokens never reach JavaScript):
 *   POST login {email, password}   POST logout   GET me   POST refresh
 *   POST recover {email, redirectTo}   POST session {access_token, refresh_token} (reset links)
 *   POST password {password}
 *   POST admin-login {username, password}   POST admin-logout   GET admin-me
 */
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

async function supabaseError(res: Response) {
  const body = await res.json().catch(() => ({}));
  return String(body.error_description ?? body.msg ?? body.message ?? body.error ?? `Request failed (${res.status}).`);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action === "admin-me") return NextResponse.json({ admin: Boolean(req.cookies.get(ADMIN_COOKIE)?.value) });
  if (action !== "me") return fail("Not found.", 404);
  const s = await session(req);
  if (!s.access) return persist(NextResponse.json({ user: null }), s);
  const res = await authApi("/user", { token: s.access });
  if (!res.ok) {
    const out = NextResponse.json({ user: null });
    clearTokens(out);
    return out;
  }
  return persist(NextResponse.json({ user: await res.json() }, { headers: { "Cache-Control": "no-store" } }), s);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const body = await req.json().catch(() => ({}));

  if (action === "login") {
    const res = await authApi("/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: body.email, password: body.password }) });
    if (!res.ok) return fail(await supabaseError(res), res.status === 400 ? 401 : res.status);
    const tokens = (await res.json()) as Tokens;
    const out = NextResponse.json({ user: tokens.user });
    setTokens(out, tokens);
    return out;
  }

  if (action === "logout") {
    const s = await session(req);
    if (s.access) await authApi("/logout", { method: "POST", token: s.access }).catch(() => undefined);
    const out = NextResponse.json({ ok: true });
    clearTokens(out);
    return out;
  }

  if (action === "refresh") {
    const s = await session(req);
    if (!s.access) return persist(fail("Signed out.", 401), s);
    return persist(NextResponse.json({ ok: true }), s);
  }

  if (action === "recover") {
    const redirect = typeof body.redirectTo === "string" ? `?redirect_to=${encodeURIComponent(body.redirectTo)}` : "";
    const res = await authApi(`/recover${redirect}`, { method: "POST", body: JSON.stringify({ email: body.email }) });
    return res.ok ? NextResponse.json({ ok: true }) : fail(await supabaseError(res), res.status);
  }

  if (action === "session") {
    // The password-reset email link carries tokens in the URL fragment; trade them for cookies.
    if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string") return fail("Invalid reset link.");
    const res = await authApi("/user", { token: body.access_token });
    if (!res.ok) return fail("This reset link has expired. Request a new one.", 401);
    const out = NextResponse.json({ user: await res.json() });
    setTokens(out, { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: Number(body.expires_in) || 3600 });
    return out;
  }

  if (action === "password") {
    const s = await session(req);
    if (!s.access) return persist(fail("Sign in required.", 401), s);
    const res = await authApi("/user", { method: "PUT", token: s.access, body: JSON.stringify({ password: body.password }) });
    return persist(res.ok ? NextResponse.json({ ok: true }) : fail(await supabaseError(res), res.status), s);
  }

  if (action === "admin-login") {
    const res = await fetch(`${BACKEND_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: body.username ?? "", password: body.password ?? "" }),
      cache: "no-store",
    }).catch(() => null);
    if (!res) return fail("Cannot reach the server.", 502);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail(typeof data.detail === "string" ? data.detail : "Could not sign in.", res.status);
    const out = NextResponse.json({ ok: true });
    out.cookies.set(ADMIN_COOKIE, data.token, { ...cookieBase, maxAge: Math.max(60, data.expires_at - Math.floor(Date.now() / 1000)) });
    return out;
  }

  if (action === "admin-logout") {
    const out = NextResponse.json({ ok: true });
    out.cookies.set(ADMIN_COOKIE, "", { ...cookieBase, maxAge: 0 });
    return out;
  }

  return fail("Not found.", 404);
}
