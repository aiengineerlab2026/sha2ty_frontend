"use client";

import { useEffect, useState } from "react";

/** The mobile app opens web pages in its own browser view signed in as the app's user: the tokens come in the URL
 * fragment (never sent to a server or kept in history), are traded for the usual httpOnly cookies
 * (/api/auth/session), and the page moves on to `next` (a path on this site only). */
export default function AppSession() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const next = params.get("next") ?? "/";
    const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    history.replaceState(null, "", window.location.pathname); // drop the tokens from the address bar
    void fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ access_token: params.get("access_token"), refresh_token: params.get("refresh_token"), expires_in: Number(params.get("expires_in")) || 3600 }),
    }).then((res) => (res.ok ? window.location.replace(safe) : setError("Your session could not be opened. Sign in again in the app.")), () => setError("Cannot reach the server."));
  }, []);
  return <p className="p-6 text-center text-sm text-slate-500">{error ?? "…"}</p>;
}
