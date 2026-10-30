import type { PlacedItem, PlanGeometry } from "./types";

/**
 * A guest's unsaved design, kept while they log in to save it. Stored in this browser (sessionStorage:
 * survives the login redirect, not other tabs or a closed browser) and cleared once it is saved.
 */
export interface PendingPlan {
  name: string;
  geometry: PlanGeometry;
  items: PlacedItem[];
}

const KEY = "shatably.pendingPlan";

export function stashPlan(plan: PendingPlan): boolean {
  // Images are large and only needed while correcting detection: keep the design itself.
  const { debug_images: _d, preview_image: _p, ...geometry } = plan.geometry;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...plan, geometry }));
    return true;
  } catch {
    return false; // storage full or blocked: the caller tells the user
  }
}

export function takePendingPlan(): PendingPlan | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingPlan) : null;
  } catch {
    return null;
  }
}

export function clearPendingPlan() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}

/** Where login sends the user back to: a same-site path only (never another origin). */
export function safeNext(next: string | null | undefined, fallback = "/vendor") {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
