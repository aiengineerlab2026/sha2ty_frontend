import { Box3, Vector3, type Mesh } from "three";

const MAX_VERTICES = 300_000; // ponytail: bigger meshes are measured as one box (pieces are found by union-find on vertices)
const cm = (m: number) => Math.round(m * 100);

/** The separate pieces of one mesh (e.g. four legs in one "Legs" mesh), as world-space boxes: vertices at the same
 * place and vertices of one triangle belong together. */
export function pieces(mesh: Mesh): Box3[] {
  const geometry = mesh.geometry;
  const pos = geometry.attributes.position;
  mesh.updateWorldMatrix(true, false);
  const whole = () => [new Box3().setFromObject(mesh)];
  if (!pos || pos.count > MAX_VERTICES) return whole();
  const parent = Int32Array.from({ length: pos.count }, (_, i) => i);
  const find = (i: number) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const at = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    const same = at.get(key);
    if (same === undefined) at.set(key, i);
    else join(i, same);
  }
  const index = geometry.index;
  const corners = index ? index.count : pos.count;
  for (let c = 0; c + 2 < corners; c += 3) {
    const [a, b, d] = index ? [index.getX(c), index.getX(c + 1), index.getX(c + 2)] : [c, c + 1, c + 2];
    join(a, b);
    join(b, d);
  }
  const boxes = new Map<number, Box3>();
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const root = find(i);
    const box = boxes.get(root) ?? boxes.set(root, new Box3()).get(root)!;
    box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  }
  return [...boxes.values()];
}

/** "4 × 41 × 4 cm (×4)" for repeated pieces of the same size (one of them, and how many), else the part's own "52 × 41 × 4 cm" (W × H × D). */
export function sizeText(boxes: Box3[]): { text: string; box: Box3 } {
  const all = boxes.reduce((acc, b) => acc.union(b), new Box3());
  const size = (b: Box3) => b.getSize(new Vector3());
  const biggest = Math.max(...boxes.map((b) => size(b).length()));
  const main = boxes.filter((b) => size(b).length() > biggest * 0.3); // tufting buttons and specks are not pieces
  const first = main[0] ? size(main[0]) : size(all);
  const alike = main.length > 1 && main.length <= 12 && main.every((b) => {
    const s = size(b);
    return Math.abs(s.x - first.x) <= first.x * 0.15 + 0.005 && Math.abs(s.y - first.y) <= first.y * 0.15 + 0.005 && Math.abs(s.z - first.z) <= first.z * 0.15 + 0.005;
  });
  const s = alike ? first : size(all);
  return { text: `${cm(s.x)} × ${cm(s.y)} × ${cm(s.z)} cm${alike ? ` (×${main.length})` : ""}`, box: all };
}

/** A point on the part itself to pin its label to: its highest vertex nearest the middle of its box (on the part's
 * top surface, not in the air above a hollow part like a bed frame). */
export function anchor(mesh: Mesh, box: Box3): Vector3 {
  const pos = mesh.geometry.attributes.position;
  const center = box.getCenter(new Vector3());
  const top = box.max.y, height = Math.max(box.max.y - box.min.y, 1e-6);
  const v = new Vector3();
  let best: Vector3 | null = null;
  let score = Infinity;
  const step = Math.max(1, Math.floor((pos?.count ?? 0) / 20_000)); // ponytail: sampled on very dense meshes
  for (let i = 0; i < (pos?.count ?? 0); i += step) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const s = Math.hypot(v.x - center.x, v.z - center.z) + ((top - v.y) / height) * 2; // near the middle, near the top
    if (s < score) {
      score = s;
      best = v.clone();
    }
  }
  return best ?? center.setY(top);
}
