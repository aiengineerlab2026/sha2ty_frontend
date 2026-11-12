import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { API } from "@/lib/api";

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Database and storage client. In the browser it talks to the backend's /api/sb, which adds the
 * signed-in user's JWT from its httpOnly cookie, so no session is stored or refreshed here. Sign-in / out go through lib/auth/client, never `supabase().auth`.
 */
export function supabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to frontend/.env.local");
  }
  if (!client) {
    // ponytail: the backend's temporary database passthrough (backend app/api/sb_proxy.py) until every area has its own endpoints.
    const base = typeof window === "undefined" ? url : `${API}/api/sb`;
    client = createClient(base, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, credentials: "include" }) }, // the session cookies
    });
  }
  return client;
}
