import { type NextRequest } from "next/server";
import { BACKEND_URL, forward } from "@/lib/auth/server";

/** Same-origin proxy to the FastAPI backend: adds the user's JWT from the httpOnly cookie and
 * streams both ways (uploads, NDJSON progress, GLB downloads). */
async function handle(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return forward(req, `${BACKEND_URL}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
