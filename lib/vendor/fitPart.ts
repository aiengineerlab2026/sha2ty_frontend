import { Vector3, type Box3, type BufferGeometry } from "three";

/** `source` scaled and moved into `target` (the replaced part's box, in its mesh's own space), each axis on its own,
 * so the variant takes exactly the part's place and size. */
// ponytail: per-axis fit; a "keep proportions" option per variant if vendors author parts at other ratios.
export function fitInto(source: BufferGeometry, target: Box3): BufferGeometry {
  const geometry = source.clone();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new Vector3());
  const want = target.getSize(new Vector3());
  const from = box.getCenter(new Vector3());
  const to = target.getCenter(new Vector3());
  const k = (a: number, b: number) => (a > 1e-9 ? b / a : 1);
  geometry.translate(-from.x, -from.y, -from.z);
  geometry.scale(k(size.x, want.x), k(size.y, want.y), k(size.z, want.z));
  geometry.translate(to.x, to.y, to.z);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
