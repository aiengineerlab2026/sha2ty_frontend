import type { AnimationConfig } from "@/lib/vendor/animation";

/** Which file the public catalogue shows, and whether its doors can actually move. */
export type CatalogModelSource = {
  glb_url: string;
  open_glb_url?: string | null;
  animation?: AnimationConfig | null;
  components?: { animation?: AnimationConfig | null } | null;
};

/**
 * One modular file for both states when that file has movable parts. Open and closed are openness values, not a
 * second GLB. A separate open file is shown only when the closed file cannot move, and then it is not interactive.
 */
export function catalogModelView(model: CatalogModelSource, state: "open" | "closed"): { url: string; interactive: boolean; legacy: boolean } {
  const anim = model.components?.animation ?? model.animation ?? null;
  const interactive = Boolean(anim && (anim.movable || (anim.animations?.length ?? 0) > 0));
  const legacy = !interactive && state === "open" && Boolean(model.open_glb_url);
  return { url: legacy ? model.open_glb_url! : model.glb_url, interactive, legacy };
}
