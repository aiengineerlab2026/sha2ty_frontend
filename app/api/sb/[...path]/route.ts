import { type NextRequest } from "next/server";
import { ANON_KEY, SUPABASE_URL, forward } from "@/lib/auth/server";

/** Same-origin proxy for supabase-js (database, storage): adds the signed-in user's JWT from the
 * httpOnly cookie. Auth endpoints are not proxied: sign-in goes through /api/auth only. */
async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path[0] === "auth") return new Response(JSON.stringify({ error: "Use /api/auth." }), { status: 404 });
  return forward(req, `${SUPABASE_URL}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`, { apikey: ANON_KEY });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD };
