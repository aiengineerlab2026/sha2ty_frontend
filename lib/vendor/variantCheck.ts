import { Vector3, type BufferGeometry } from "three";

/** The same shape: every sampled point of each mesh within 1% of the part's size of the other mesh (any vertex
 * count or order). Both meshes are already fitted into the same box (fitInto), so a copy of a part that was only
 * moved or scaled counts as the same: choosing it would change nothing on screen. */
export function sameShape(a: BufferGeometry, b: BufferGeometry, tolerance = 0.01) {
  const pa = a.getAttribute("position");
  const pb = b.getAttribute("position");
  if (!pa || !pb || !pa.count || !pb.count) return false;
  a.computeBoundingBox();
  const limit = a.boundingBox!.getSize(new Vector3()).length() * tolerance;
  // ponytail: sampled brute-force nearest points (≤ 400 × 4000 per side); a BVH if parts get much denser.
  const near = (from: typeof pa, to: typeof pb) => {
    const step = Math.max(1, Math.floor(from.count / 400));
    const stepTo = Math.max(1, Math.floor(to.count / 4000));
    for (let i = 0; i < from.count; i += step) {
      let best = Infinity;
      for (let j = 0; j < to.count && best > limit * limit; j += stepTo) {
        const dx = from.getX(i) - to.getX(j), dy = from.getY(i) - to.getY(j), dz = from.getZ(i) - to.getZ(j);
        best = Math.min(best, dx * dx + dy * dy + dz * dz);
      }
      if (best > limit * limit) return false;
    }
    return true;
  };
  return near(pa, pb) && near(pb, pa);
}

export type VariantProblem = { part: string; variant: string; problem: "no-file" | "same-file" | "same-name" | "same-shape"; other?: string };

/** What stops a part's variants from being published, from their records alone: a missing file, two variants on one
 * file, or two with one name. (Identical shapes on different files are found by the viewer, which loads them.) */
export function variantProblems(parts: { id: string; name: string; variants?: { id: string; name: string; glb_url?: string | null }[] }[]): VariantProblem[] {
  const out: VariantProblem[] = [];
  for (const part of parts) {
    const seenFile = new Map<string, string>();
    const seenName = new Map<string, string>();
    for (const v of part.variants ?? []) {
      const url = v.glb_url?.trim();
      const name = v.name.trim().toLowerCase();
      if (!url) out.push({ part: part.name, variant: v.name, problem: "no-file" });
      else if (seenFile.has(url)) out.push({ part: part.name, variant: v.name, problem: "same-file", other: seenFile.get(url) });
      else seenFile.set(url, v.name);
      if (seenName.has(name)) out.push({ part: part.name, variant: v.name, problem: "same-name", other: seenName.get(name) });
      else seenName.set(name, v.name);
    }
  }
  return out;
}
