import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Database and storage client. In the browser it talks to the same-origin proxy (/api/sb), which
 * adds the signed-in user's JWT from the httpOnly cookie, so no session is stored or refreshed
 * here. Sign-in / out go through lib/auth/client, never `supabase().auth`.
 */
export function supabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to frontend/.env.local");
  }
  if (!client) {
    const base = typeof window === "undefined" ? url : `${window.location.origin}/api/sb`;
    client = createClient(base, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  return client;
}

/** Public file URL on the real Supabase host (stored in the database, so never the proxy). */
export function publicStorageUrl(bucket: string, path: string): string {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${url}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
