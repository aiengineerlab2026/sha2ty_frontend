import type { MeshStandardMaterial } from "three";

/** A part's material back to how its file loaded it: every property (colour, colour / normal / roughness / metalness /
 * AO / emissive maps, PBR factors, opacity and transparency, and the physical ones such as transmission, sheen and
 * clearcoat). Resetting only colour and the colour map left a part that had a pattern laid on it without its
 * roughness and metalness maps, and a glass part opaque. */
export function restoreMaterial(to: MeshStandardMaterial, from: MeshStandardMaterial): void {
  to.copy(from);
  to.needsUpdate = true;
}
