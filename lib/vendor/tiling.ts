import { BufferAttribute, BufferGeometry, Vector3, type InterleavedBufferAttribute } from "three";

/** How a tiled pattern is laid on a part: its own UVs, or box-projected UVs baked into the geometry. */
export type Mapping = "uv" | "box";

type Attr = BufferAttribute | InterleavedBufferAttribute;
type Range = { start: number; count: number };

// Any real share of edges cut in UV space breaks a repeating pattern into islands, each at its own angle and scale
// (Meshy's atlases, and split parts that keep a few islands of one): such parts are box-projected instead.
const SEAM_LIMIT = 0.002;
// A run of triangles facing another way that covers less than this share of the part is surface noise (tufting,
// wrinkles, scan bumps), not a real side: it takes its neighbours' projection so the pattern stays one piece.
const PATCH_SHARE = 0.03;
const DEGENERATE_LIMIT = 0.05;

function corner(index: BufferAttribute | null, i: number) {
  return index ? index.getX(i) : i;
}

function scaled(pos: Attr, v: number, scale: Vector3, out: Vector3) {
  return out.fromBufferAttribute(pos, v).multiply(scale);
}

/** What the part's UVs can do for a repeating pattern, over one material group (`range`) of the geometry.
 * `density`: UV units per metre (median), to size tiles in metres when the UVs are kept. */
export function inspectUv(geometry: BufferGeometry, range: Range, scale: Vector3): { mapping: Mapping; reason: string; density: number } {
  const pos = geometry.getAttribute("position") as Attr | undefined;
  const uv = geometry.getAttribute("uv") as Attr | undefined;
  if (!pos) return { mapping: "box", reason: "no positions", density: 1 };
  if (!uv) return { mapping: "box", reason: "no texture coordinates", density: 1 };
  const index = geometry.index;
  const end = Math.min(range.start + range.count, index ? index.count : pos.count);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const ratios: number[] = [];
  let degenerate = 0;
  let tris = 0;
  // Edges keyed by welded position: the same 3D edge with two different UV pairs is a seam.
  const key = (v: number) => `${pos.getX(v).toFixed(5)},${pos.getY(v).toFixed(5)},${pos.getZ(v).toFixed(5)}`;
  const edges = new Map<string, string>();
  let seams = 0;
  for (let i = range.start; i + 2 < end; i += 3) {
    const v = [corner(index, i), corner(index, i + 1), corner(index, i + 2)];
    tris += 1;
    scaled(pos, v[0], scale, a);
    scaled(pos, v[1], scale, b);
    scaled(pos, v[2], scale, c);
    const world = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    const [u0, w0, u1, w1, u2, w2] = [uv.getX(v[0]), uv.getY(v[0]), uv.getX(v[1]), uv.getY(v[1]), uv.getX(v[2]), uv.getY(v[2])];
    const uvArea = Math.abs((u1 - u0) * (w2 - w0) - (u2 - u0) * (w1 - w0)) / 2;
    if (world > 1e-12 && uvArea < 1e-12) degenerate += 1;
    else if (world > 1e-12) ratios.push(Math.sqrt(uvArea / world));
    for (let k = 0; k < 3; k++) {
      const p = v[k], q = v[(k + 1) % 3];
      const [kp, kq] = [key(p), key(q)];
      const id = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      const uvs = kp < kq ? `${uv.getX(p)},${uv.getY(p)},${uv.getX(q)},${uv.getY(q)}` : `${uv.getX(q)},${uv.getY(q)},${uv.getX(p)},${uv.getY(p)}`;
      const seen = edges.get(id);
      if (seen === undefined) edges.set(id, uvs);
      else if (seen !== uvs) seams += 1;
    }
  }
  ratios.sort((x, y) => x - y);
  const density = ratios[Math.floor(ratios.length / 2)] || 1;
  if (!tris) return { mapping: "box", reason: "no triangles", density };
  if (degenerate / tris > DEGENERATE_LIMIT) return { mapping: "box", reason: "degenerate texture coordinates", density };
  const spread = ratios.length ? ratios[Math.floor(ratios.length * 0.9)] / Math.max(ratios[Math.floor(ratios.length * 0.1)], 1e-9) : Infinity;
  // Unevenly stretched UVs show the pattern in wider and narrower bands: kept only when nearly even.
  if (spread > 1.8) return { mapping: "box", reason: "texture coordinates stretch unevenly", density };
  if (seams / Math.max(edges.size, 1) > SEAM_LIMIT) return { mapping: "box", reason: "texture coordinates are a texture atlas", density };
  return { mapping: "uv", reason: "", density };
}

/** Box (cube) projection baked into UVs, in metres / tile, for the triangles of `range`: each triangle takes the axis
 * its face points along (projectionAxes: surface noise merged into the face around it), so front, sides and top each
 * get the pattern flat, unstretched and in one piece, and edges where two faces share an axis stay continuous. Vertices are duplicated only where faces on different axes meet (and where a
 * vertex is also used outside `range`, which keeps its UVs). Positions and normals are copied unchanged.
 * `scale`: the mesh's world scale, so tile sizes are real metres. The UVs export to GLB as they are. */
/** The projection axis of each triangle in `range` (0..5: ±X, ±Y, ±Z): from the smooth (vertex) normals where the
 * file has them, then small patches are merged into the face around them. Real faces (front, top, sides) are large
 * and keep their own axis; their shared edges are the only places the pattern changes direction. */
export function projectionAxes(geometry: BufferGeometry, range: Range, scale: Vector3): Int8Array {
  const pos = geometry.getAttribute("position") as Attr;
  const normal = geometry.getAttribute("normal") as Attr | undefined;
  const index = geometry.index;
  const end = Math.min(range.start + range.count, index ? index.count : pos.count);
  const tris = Math.max(0, Math.floor((end - range.start) / 3));
  const axes = new Int8Array(tris);
  const areas = new Float64Array(tris);
  const normals = new Float32Array(tris * 3); // area-weighted, for how far a patch really turns from a face
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), m = new Vector3();
  const inverse = new Vector3(1 / (scale.x || 1), 1 / (scale.y || 1), 1 / (scale.z || 1));
  const axisOf = (v: Vector3) => {
    const [ax, ay, az] = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
    return ax >= ay && ax >= az ? (v.x >= 0 ? 0 : 1) : ay >= az ? (v.y >= 0 ? 2 : 3) : v.z >= 0 ? 4 : 5;
  };
  for (let t = 0; t < tris; t++) {
    const i = range.start + t * 3;
    const [v0, v1, v2] = [corner(index, i), corner(index, i + 1), corner(index, i + 2)];
    scaled(pos, v0, scale, a);
    scaled(pos, v1, scale, b);
    scaled(pos, v2, scale, c);
    n.copy(b).sub(a).cross(m.copy(c).sub(a));
    areas[t] = n.length() / 2;
    if (normal) {
      // Normals scale by the inverse of the mesh scale.
      m.fromBufferAttribute(normal, v0).add(b.fromBufferAttribute(normal, v1)).add(c.fromBufferAttribute(normal, v2)).multiply(inverse);
      if (m.lengthSq() > 1e-12 && m.dot(n) > 0) n.copy(m);
    }
    axes[t] = axisOf(n);
    const scaleBack = areas[t] / (n.length() || 1);
    normals.set([n.x * scaleBack, n.y * scaleBack, n.z * scaleBack], t * 3);
  }
  const AXIS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // Triangles sharing an edge (positions welded, so split vertices still connect).
  const weld = new Map<string, number>();
  const id = new Int32Array(pos.count);
  for (let v = 0; v < pos.count; v++) {
    const key = `${pos.getX(v).toFixed(5)},${pos.getY(v).toFixed(5)},${pos.getZ(v).toFixed(5)}`;
    let w = weld.get(key);
    if (w === undefined) weld.set(key, (w = weld.size));
    id[v] = w;
  }
  const firstOnEdge = new Map<number, number>();
  const neighbours: number[][] = Array.from({ length: tris }, () => []);
  for (let t = 0; t < tris; t++) {
    const i = range.start + t * 3;
    for (let k = 0; k < 3; k++) {
      const p = id[corner(index, i + k)], q = id[corner(index, i + ((k + 1) % 3))];
      if (p === q) continue;
      const edge = Math.min(p, q) * weld.size + Math.max(p, q);
      const other = firstOnEdge.get(edge);
      if (other === undefined) firstOnEdge.set(edge, t);
      else {
        neighbours[t].push(other);
        neighbours[other].push(t);
      }
    }
  }
  const total = areas.reduce((sum, x) => sum + x, 0);
  // Smallest patches first, so a speck inside a patch inside a face ends up with the face.
  for (let pass = 0; pass < 4; pass++) {
    const component = new Int32Array(tris).fill(-1);
    const patches: { members: number[]; area: number }[] = [];
    for (let t = 0; t < tris; t++) {
      if (component[t] >= 0) continue;
      const members = [t];
      component[t] = patches.length;
      let area = 0;
      for (let j = 0; j < members.length; j++) {
        const u = members[j];
        area += areas[u];
        for (const w of neighbours[u]) if (component[w] < 0 && axes[w] === axes[t]) {
          component[w] = patches.length;
          members.push(w);
        }
      }
      patches.push({ members, area });
    }
    let changed = false;
    for (const patch of [...patches].sort((x, y) => x.area - y.area)) {
      if (patch.area >= total * PATCH_SHARE) break;
      const own = axes[patch.members[0]];
      const votes = new Float64Array(6);
      for (const u of patch.members) for (const w of neighbours[u]) if (axes[w] !== own) votes[axes[w]] += areas[w];
      let best = -1;
      for (let k = 0; k < 6; k++) if (votes[k] > 0 && (best < 0 || votes[k] > votes[best])) best = k;
      if (best < 0) continue; // an island on its own (a separate shell): keeps its axis
      // Only surface noise joins its neighbour: a patch that, on the whole, still leans towards the neighbour's
      // direction (a bump on the front). A real side at right angles (a headboard's 10 cm edge) keeps its own
      // projection, or it would be projected edge-on and streak.
      let [sx, sy, sz] = [0, 0, 0];
      for (const u of patch.members) [sx, sy, sz] = [sx + normals[u * 3], sy + normals[u * 3 + 1], sz + normals[u * 3 + 2]];
      const along = (sx * AXIS[best][0] + sy * AXIS[best][1] + sz * AXIS[best][2]) / (Math.hypot(sx, sy, sz) || 1);
      if (along < 0.3) continue;
      for (const u of patch.members) axes[u] = best;
      changed = true;
    }
    if (!changed) break;
  }
  return axes;
}

/** A part whose sides bend around a vertical axis (a curved or wingback headboard, a round ottoman): the circle its
 * side faces follow, or null for flat-sided parts. Side faces must point along the radius of one well-fitting circle
 * and turn through more than ~50° in all, so a box with a flat front never counts. */
export function verticalBend(geometry: BufferGeometry, range: Range, scale: Vector3, axes: Int8Array): { cx: number; cz: number; theta0: number } | null {
  const pos = geometry.getAttribute("position") as Attr;
  const index = geometry.index;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
  const pts: { x: number; z: number; nx: number; nz: number; w: number }[] = [];
  for (let t = 0; t < axes.length; t++) {
    if (axes[t] === 2 || axes[t] === 3) continue; // tops and bottoms keep their flat projection
    const i = range.start + t * 3;
    scaled(pos, corner(index, i), scale, a);
    scaled(pos, corner(index, i + 1), scale, b);
    scaled(pos, corner(index, i + 2), scale, c);
    n.copy(b).sub(a).cross(new Vector3().copy(c).sub(a));
    const w = n.length() / 2;
    const h = Math.hypot(n.x, n.z);
    if (w < 1e-12 || h < 1e-9) continue;
    pts.push({ x: (a.x + b.x + c.x) / 3, z: (a.z + b.z + c.z) / 3, nx: n.x / h, nz: n.z / h, w });
  }
  if (pts.length < 8) return null;
  // Kasa circle fit (area-weighted least squares on x² + z² + Dx + Ez + F = 0).
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
  for (const p of pts) {
    const row = [p.x, p.z, 1], q = -(p.x * p.x + p.z * p.z);
    for (let i = 0; i < 3; i++) {
      r[i] += p.w * row[i] * q;
      for (let j = 0; j < 3; j++) m[i][j] += p.w * row[i] * row[j];
    }
  }
  const det = (k: number[][]) => k[0][0] * (k[1][1] * k[2][2] - k[1][2] * k[2][1]) - k[0][1] * (k[1][0] * k[2][2] - k[1][2] * k[2][0]) + k[0][2] * (k[1][0] * k[2][1] - k[1][1] * k[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-18) return null;
  const solve = (col: number) => det(m.map((row, i) => row.map((v, j) => (j === col ? r[i] : v)))) / d;
  const [D, E, F] = [solve(0), solve(1), solve(2)];
  const [cx, cz] = [-D / 2, -E / 2];
  const R = Math.sqrt(Math.max(cx * cx + cz * cz - F, 0));
  if (!(R > 1e-6)) return null;
  let total = 0, misfit = 0, radial = 0, mx = 0, mz = 0;
  const angles: { a: number; w: number }[] = [];
  for (const p of pts) {
    const [dx, dz] = [p.x - cx, p.z - cz];
    const dist = Math.hypot(dx, dz) || 1e-9;
    total += p.w;
    misfit += p.w * ((dist - R) / R) ** 2;
    radial += p.w * Math.abs((p.nx * dx + p.nz * dz) / dist); // a panel's front faces out, its back in: both count
    mx += (p.w * dx) / dist;
    mz += (p.w * dz) / dist;
    angles.push({ a: Math.atan2(dz, dx), w: p.w });
  }
  const theta0 = Math.atan2(mz, mx);
  const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
  const spread = (() => {
    const list = angles.map((e) => ({ a: wrap(e.a - theta0), w: e.w })).sort((x, y) => x.a - y.a);
    const at = (share: number) => {
      let acc = 0;
      for (const e of list) if ((acc += e.w) >= share * total) return e.a;
      return list[list.length - 1].a;
    };
    return at(0.9) - at(0.1);
  })();
  const fits = Math.sqrt(misfit / total) < 0.08;
  const facesOut = radial / total > 0.85; // sides point along the radius (out or in)
  if (!fits || !facesOut || spread < (50 * Math.PI) / 180) return null;
  return { cx, cz, theta0 };
}

/** Lays the projected faces out like an unfolded box: each projection (front, top, sides, the curve) is shifted so
 * its pattern continues across the edge it shares with the face it unfolds from, instead of every face starting the
 * pattern from the same origin (which put a step in it at every fold: the strong line where the front meets the top
 * roll). The biggest face stays put; the others follow along their longest shared edge (a spanning tree), so only
 * the last closing edge of a closed shape can still show a step, where it is least visible. Same-axis regions move
 * together, so they stay aligned with each other. `copies`: (vertex × 8 + axis) → its copy for that axis. */
function unfold(uvs: number[], axes: Int8Array, owner: Int8Array, copies: Map<number, number>, count: number, area: (t: number) => number, weld: (v: number) => string) {
  const per = new Float64Array(8);
  for (let t = 0; t < axes.length; t++) per[axes[t]] += area(t);
  // UVs of one point of the surface on each projection it is on (by position: faces are often stored with their
  // own vertices at the same point, as in a box or a file split at its old UV seams).
  const on = new Map<string, [number, number][]>();
  const add = (v: number, axis: number, target: number) => {
    const key = weld(v);
    const list = on.get(key) ?? [];
    if (!list.some(([a]) => a === axis)) list.push([axis, target]);
    on.set(key, list);
  };
  for (let v = 0; v < count; v++) if (owner[v] >= 0) add(v, owner[v], v);
  for (const [key, target] of copies) add(Math.floor(key / 8), key % 8, target);
  const links = new Map<string, { du: number; dv: number; n: number }>(); // "a>b": mean (uv on a − uv on b)
  for (const list of on.values()) {
    for (const [a, ta] of list) for (const [b, tb] of list) {
      if (a === b) continue;
      const link = links.get(`${a}>${b}`) ?? { du: 0, dv: 0, n: 0 };
      link.du += uvs[ta * 2] - uvs[tb * 2];
      link.dv += uvs[ta * 2 + 1] - uvs[tb * 2 + 1];
      link.n += 1;
      links.set(`${a}>${b}`, link);
    }
  }
  const placed = new Map<number, [number, number]>();
  const start = per.indexOf(Math.max(...per));
  placed.set(start, [0, 0]);
  for (;;) {
    let best: [number, number, { du: number; dv: number; n: number }] | null = null;
    for (const [key, link] of links) {
      const [a, b] = key.split(">").map(Number);
      if (placed.has(a) && !placed.has(b) && (!best || link.n > best[2].n)) best = [a, b, link];
    }
    if (!best) break;
    const [a, b, link] = best;
    const base = placed.get(a)!;
    placed.set(b, [base[0] + link.du / link.n, base[1] + link.dv / link.n]);
  }
  const shift = (target: number, axis: number) => {
    const d = placed.get(axis);
    if (!d) return;
    uvs[target * 2] += d[0];
    uvs[target * 2 + 1] += d[1];
  };
  for (let v = 0; v < count; v++) if (owner[v] >= 0) shift(v, owner[v]);
  for (const [key, target] of copies) shift(target, key % 8);
}

/** `grain`: the world axis (0 x, 1 y, 2 z) the image's V direction should follow where a face allows it: a wood's
 * grain along a leg or a rail. Without it each face keeps its default orientation (V up, or across a top). */
export function boxProject(geometry: BufferGeometry, range: Range, scale: Vector3, tileU: number, tileV: number, grain?: 0 | 1 | 2): BufferGeometry {
  const pos = geometry.getAttribute("position") as Attr;
  const index = geometry.index;
  const total = index ? index.count : pos.count;
  const end = Math.min(range.start + range.count, total);
  const corners = Uint32Array.from({ length: total }, (_, i) => corner(index, i));
  const outside = new Uint8Array(pos.count);
  for (let i = 0; i < total; i++) if (i < range.start || i >= end) outside[corners[i]] = 1;

  const owner = new Int8Array(pos.count).fill(-1); // the axis (0..7) a vertex's UV was made for
  const copies = new Map<number, number>();
  const clones: number[] = [];
  const uvs: number[] = [];
  const oldUv = geometry.getAttribute("uv") as Attr | undefined;
  for (let v = 0; v < pos.count; v++) uvs.push(oldUv ? oldUv.getX(v) : 0, oldUv ? oldUv.getY(v) : 0);
  const p = new Vector3();
  const axes = projectionAxes(geometry, range, scale);
  // Curved sides: one cylindrical layout (arc length × height) instead of front and side projections that meet in
  // vertical bands and stretch towards 45°. Pseudo-axis 6: sides facing out of the curve, 7: facing into it (a
  // panel's back), each read the right way round from where it is seen.
  const bend = verticalBend(geometry, range, scale, axes);
  if (bend) {
    const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
    for (let t = 0; t < axes.length; t++) {
      if (axes[t] === 2 || axes[t] === 3) continue;
      const i = range.start + t * 3;
      scaled(pos, corners[i], scale, a);
      scaled(pos, corners[i + 1], scale, b);
      scaled(pos, corners[i + 2], scale, c);
      const n = new Vector3().copy(b).sub(a).cross(new Vector3().copy(c).sub(a));
      const out = n.x * ((a.x + b.x + c.x) / 3 - bend.cx) + n.z * ((a.z + b.z + c.z) / 3 - bend.cz);
      axes[t] = out >= 0 ? 6 : 7;
    }
  }
  const setUv = (target: number, v: number, axis: number) => {
    scaled(pos, v, scale, p);
    // +X / -X: (∓z, y), +Y / -Y: (x, ∓z), +Z / -Z: (±x, y): mirrored faces read the right way round.
    if (axis >= 6 && bend) {
      const [dx, dz] = [p.x - bend.cx, p.z - bend.cz];
      const theta = Math.atan2(Math.sin(Math.atan2(dz, dx) - bend.theta0), Math.cos(Math.atan2(dz, dx) - bend.theta0));
      const arc = ((axis === 6 ? -1 : 1) * theta * Math.hypot(dx, dz)); // arc length: the fabric's real size along the curve
      const [a, b] = grain !== undefined && grain !== 1 ? [p.y, arc] : [arc, p.y]; // a curved rail: grain round the curve
      uvs[target * 2] = a / tileU;
      uvs[target * 2 + 1] = b / tileV;
      return;
    }
    let [u, w] =
      axis === 0 ? [-p.z, p.y] : axis === 1 ? [p.z, p.y] :
      axis === 2 ? [p.x, -p.z] : axis === 3 ? [p.x, p.z] :
      axis === 4 ? [p.x, p.y] : [-p.x, p.y];
    // The world axis U runs along on this face: turned when the grain should follow it instead.
    const uAxis = axis <= 1 ? 2 : 0;
    if (grain === uAxis) [u, w] = [w, u];
    uvs[target * 2] = u / tileU;
    uvs[target * 2 + 1] = w / tileV;
  };
  for (let i = range.start; i + 2 < end; i += 3) {
    const axis = axes[(i - range.start) / 3];
    for (let k = 0; k < 3; k++) {
      const v = corners[i + k];
      let target: number;
      if (!outside[v] && (owner[v] === -1 || owner[v] === axis)) {
        owner[v] = axis;
        target = v;
      } else {
        const key = v * 8 + axis;
        target = copies.get(key) ?? -1;
        if (target < 0) {
          target = pos.count + clones.length;
          clones.push(v);
          copies.set(key, target);
          uvs.push(0, 0);
        }
      }
      corners[i + k] = target;
      setUv(target, v, axis);
    }
  }

  unfold(uvs, axes, owner, copies, pos.count, (t) => {
    const i = range.start + t * 3;
    const [a, b, c] = [scaled(pos, corners[i] < pos.count ? corners[i] : clones[corners[i] - pos.count], scale, new Vector3()), scaled(pos, corners[i + 1] < pos.count ? corners[i + 1] : clones[corners[i + 1] - pos.count], scale, new Vector3()), scaled(pos, corners[i + 2] < pos.count ? corners[i + 2] : clones[corners[i + 2] - pos.count], scale, new Vector3())];
    return b.sub(a).cross(c.sub(a)).length() / 2;
  }, (v) => `${pos.getX(v).toFixed(5)},${pos.getY(v).toFixed(5)},${pos.getZ(v).toFixed(5)}`);

  const out = new BufferGeometry();
  const count = pos.count + clones.length;
  for (const [name, attr] of Object.entries(geometry.attributes) as [string, Attr][]) {
    if (name === "uv") continue;
    const size = attr.itemSize;
    const data = new Float32Array(count * size);
    const read = (v: number, k: number) => (k === 0 ? attr.getX(v) : k === 1 ? attr.getY(v) : k === 2 ? attr.getZ(v) : attr.getW(v));
    for (let v = 0; v < count; v++) {
      const src = v < pos.count ? v : clones[v - pos.count];
      for (let k = 0; k < size; k++) data[v * size + k] = read(src, k);
    }
    out.setAttribute(name, new BufferAttribute(data, size));
  }
  out.setAttribute("uv", new BufferAttribute(Float32Array.from(uvs), 2));
  out.setIndex(new BufferAttribute(corners, 1));
  for (const group of geometry.groups) out.addGroup(group.start, group.count, group.materialIndex);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** A panel is thin: its smallest side is well under its middle side. A leg or a block is not, and stays one material. */
function sheetThin(size: number[]): 0 | 1 | 2 | null {
  const order = [0, 1, 2].sort((a, b) => size[a] - size[b]);
  const [thin, mid] = [order[0], order[1]];
  if (!(size[thin] > 1e-6) || size[thin] > size[mid] * 0.7) return null;
  return thin as 0 | 1 | 2;
}

/** Pull a sheet's cut edges off its faces so they can wear the core (chips, plies, blockboard strips) while the
 * faces keep the finish. Face vertices and their UVs stay. Each edge corner is a copy, with UVs from `uvFor`
 * (along the cut, through the thickness). Not a sheet: the geometry is left as it is and the result is null.
 * Groups become face (material 0) then edge (material 1). */
export function splitSheetEdge(
  geometry: BufferGeometry,
  scale: Vector3,
  uvFor: (info: { along: number; through: number; normalAxis: 0 | 1 | 2; thin: 0 | 1 | 2; thickness: number }) => [number, number],
): { thin: 0 | 1 | 2; thickness: number } | null {
  const pos = geometry.getAttribute("position") as Attr | undefined;
  const index = geometry.index;
  if (!pos || !index) return null;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new Vector3()).multiply(scale).toArray();
  const thin = sheetThin(size);
  if (thin == null) return null;
  const min = [box.min.x, box.min.y, box.min.z];
  const thickness = size[thin];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const face: number[] = [];
  const edge: { v: number; u: number; w: number }[] = [];
  for (let i = 0; i + 2 < index.count; i += 3) {
    const [ia, ib, ic] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    scaled(pos, ia, scale, a);
    scaled(pos, ib, scale, b);
    scaled(pos, ic, scale, c);
    const n = new Vector3().copy(b).sub(a).cross(new Vector3().copy(c).sub(a));
    const len = n.length() || 1;
    const ax = [Math.abs(n.x) / len, Math.abs(n.y) / len, Math.abs(n.z) / len];
    const normalAxis = (ax[0] >= ax[1] && ax[0] >= ax[2] ? 0 : ax[1] >= ax[2] ? 1 : 2) as 0 | 1 | 2;
    if (normalAxis === thin) {
      face.push(ia, ib, ic);
      continue;
    }
    const along = (3 - normalAxis - thin) as 0 | 1 | 2;
    for (const v of [ia, ib, ic]) {
      scaled(pos, v, scale, a);
      const at = a.toArray();
      const [u, w] = uvFor({ along: at[along], through: at[thin] - min[thin] * scale.getComponent(thin), normalAxis, thin, thickness });
      edge.push({ v, u, w });
    }
  }
  if (!edge.length || !face.length) return null;
  const count = pos.count + edge.length;
  const attrs = Object.entries(geometry.attributes) as [string, Attr][];
  for (const [name, attr] of attrs) {
    const item = attr.itemSize;
    const data = new Float32Array(count * item);
    const read = (v: number, k: number) => (k === 0 ? attr.getX(v) : k === 1 ? attr.getY(v) : k === 2 ? attr.getZ(v) : attr.getW(v));
    for (let v = 0; v < pos.count; v++) for (let k = 0; k < item; k++) data[v * item + k] = read(v, k);
    edge.forEach((corner, n) => {
      const dst = pos.count + n;
      if (name === "uv") {
        data[dst * item] = corner.u;
        if (item > 1) data[dst * item + 1] = corner.w;
        return;
      }
      for (let k = 0; k < item; k++) data[dst * item + k] = read(corner.v, k);
    });
    geometry.setAttribute(name, new BufferAttribute(data, item));
  }
  const order = new Uint32Array(face.length + edge.length);
  face.forEach((v, i) => (order[i] = v));
  edge.forEach((_, n) => (order[face.length + n] = pos.count + n));
  geometry.setIndex(new BufferAttribute(order, 1));
  geometry.clearGroups();
  geometry.addGroup(0, face.length, 0);
  geometry.addGroup(face.length, edge.length, 1);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { thin, thickness };
}

/** Whether a pattern image tiles without a visible edge: its opposite borders match about as well as neighbouring
 * pixels inside it do. */
export function tilesSeamlessly(image: CanvasImageSource): boolean {
  const seams = seamsOf(image);
  return !seams.across && !seams.down;
}

/** Which way a pattern image shows an edge when repeated: `across` (left and right borders differ: vertical lines),
 * `down` (top and bottom differ: horizontal lines). Each is judged on its own: the step from the last row to the
 * first against the typical step between neighbouring rows inside the image. */
export function seamsOf(image: CanvasImageSource): { across: boolean; down: boolean } {
  const n = 128;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = n;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { across: false, down: false };
    ctx.drawImage(image, 0, 0, n, n);
    return seamsIn(ctx.getImageData(0, 0, n, n).data, n, n);
  } catch {
    return { across: false, down: false }; // unreadable (cross-origin): plain repeat, as before
  }
}

export function seamsIn(data: Uint8ClampedArray, w: number, h: number): { across: boolean; down: boolean } {
  const diff = (i: number, j: number) => Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
  const column = (x0: number, x1: number) => {
    let sum = 0;
    for (let y = 0; y < h; y++) sum += diff((y * w + x0) * 4, (y * w + x1) * 4);
    return sum / h;
  };
  const row = (y0: number, y1: number) => {
    let sum = 0;
    for (let x = 0; x < w; x++) sum += diff((y0 * w + x) * 4, (y1 * w + x) * 4);
    return sum / w;
  };
  let inCols = 0, inRows = 0;
  for (let x = 0; x + 1 < w; x++) inCols += column(x, x + 1);
  for (let y = 0; y + 1 < h; y++) inRows += row(y, y + 1);
  const SLACK = 3; // flat colours: tiny steps never count
  return { across: column(w - 1, 0) > (inCols / (w - 1)) * 1.6 + SLACK, down: row(h - 1, 0) > (inRows / (h - 1)) * 1.6 + SLACK };
}

const MAX_SIDE = 2048; // the GLB export's texture limit: larger photos would be downscaled there anyway

function pixels(image: CanvasImageSource & { width: number; height: number }, max: number) {
  const k = Math.min(1, max / Math.max(image.width, image.height));
  const [w, h] = [Math.max(2, Math.round(image.width * k)), Math.max(2, Math.round(image.height * k))];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, w, h);
  return { canvas, ctx, w, h, data: ctx.getImageData(0, 0, w, h) };
}

/** Wraps an image horizontally without a visible edge, copying pixels (no blending, so no blur, ghosting or colour
 * shift): its right-hand strip of width `overlap` is laid over its left-hand strip, and along the path down that
 * overlap where the two strips differ least (a minimum-error cut, as in image quilting) the left side takes the
 * right strip and the right side the image's own pixels. The result is `overlap` px narrower and its last column
 * continues into its first. RGBA, row-major. */
export function wrapColumns(src: Uint8ClampedArray, w: number, h: number, overlap: number): { data: Uint8ClampedArray; w: number } {
  const ov = Math.max(2, Math.min(overlap, Math.floor(w / 3)));
  const cost = new Float64Array(ov * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < ov; x++) {
      const [i, j] = [(y * w + x) * 4, (y * w + w - ov + x) * 4];
      // Column 0 is never the cut: there the wrap would meet the image's own first column, the edge being hidden.
      cost[y * ov + x] = x === 0 ? 1e18 : (src[i] - src[j]) ** 2 + (src[i + 1] - src[j + 1]) ** 2 + (src[i + 2] - src[j + 2]) ** 2;
    }
  }
  // Cheapest top-to-bottom path, moving at most one column per row.
  const acc = Float64Array.from(cost);
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < ov; x++) {
      let best = acc[(y - 1) * ov + x];
      if (x > 0) best = Math.min(best, acc[(y - 1) * ov + x - 1]);
      if (x < ov - 1) best = Math.min(best, acc[(y - 1) * ov + x + 1]);
      acc[y * ov + x] += best;
    }
  }
  const cut = new Int32Array(h);
  let x = 0;
  for (let k = 1; k < ov; k++) if (acc[(h - 1) * ov + k] < acc[(h - 1) * ov + x]) x = k;
  cut[h - 1] = x;
  for (let y = h - 2; y >= 0; y--) {
    let next = cut[y + 1];
    for (const k of [cut[y + 1] - 1, cut[y + 1] + 1]) if (k >= 0 && k < ov && acc[y * ov + k] < acc[y * ov + next]) next = k;
    cut[y] = next;
  }
  const outW = w - ov;
  const out = new Uint8ClampedArray(outW * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < outW; x++) {
      // Left of the cut, in the overlap: the right strip (which continues the image's last kept column).
      const from = x < ov && x < cut[y] ? w - ov + x : x;
      out.set(src.subarray((y * w + from) * 4, (y * w + from) * 4 + 4), (y * outW + x) * 4);
    }
  }
  return { data: out, w: outW };
}

const BAND = 0.2; // share of the photo the colour step is spread across (stays clear of the tile border)
const BLUR = 0.13; // the step is averaged along the join, so the weave itself is not what gets corrected

function clampByte(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Wrapped moving average. The window is odd, so each sample stays centred on itself. */
function boxBlur(values: Float64Array, radius: number) {
  const n = values.length;
  const out = new Float64Array(n);
  const k = radius * 2 + 1;
  let sum = 0;
  for (let i = -radius; i <= radius; i++) sum += values[(i + n) % n];
  for (let i = 0; i < n; i++) {
    out[i] = sum / k;
    sum += values[(i + radius + 1) % n] - values[(i - radius + n) % n];
  }
  return out;
}

/** Cancel the low-frequency colour step where a rolled photo's original borders now meet (the middle of `axis`:
 * 0 = between rows, 1 = between columns). The step is spread over a band as a smooth ramp. Pixels outside that
 * band, including the tile border, are not touched, and the weave (the step's high frequency) is left in place. */
function absorb(rgb: Float64Array, w: number, h: number, axis: 0 | 1) {
  const n = axis === 0 ? h : w;
  const along = axis === 0 ? w : h;
  const mid = Math.floor(n / 2);
  const band = Math.max(4, Math.min(Math.floor(n / 2) - 2, Math.round(n * BAND)));
  const radius = Math.max(2, Math.min(Math.floor(along / 2), Math.round(along * BLUR)));
  const jump = [new Float64Array(along), new Float64Array(along), new Float64Array(along)];
  for (let i = 0; i < along; i++) {
    const [a, b] = axis === 0 ? [((mid - 1) * w + i) * 3, (mid * w + i) * 3] : [(i * w + mid - 1) * 3, (i * w + mid) * 3];
    for (let c = 0; c < 3; c++) jump[c][i] = rgb[b + c] - rgb[a + c];
  }
  const smooth = jump.map((ch) => boxBlur(ch, radius));
  // A tent: zero at the band's outer edge, half the jump at the seam, so the two sides meet and the
  // tile border (outside the band) stays exactly the photo.
  for (let i = Math.max(0, mid - band); i < Math.min(n, mid + band); i++) {
    const dist = i < mid ? mid - 1 - i : i - mid;
    const k = (1 - dist / band) * 0.5;
    const sign = i < mid ? 1 : -1;
    if (axis === 0) {
      for (let x = 0; x < w; x++) {
        const p = (i * w + x) * 3;
        for (let c = 0; c < 3; c++) rgb[p + c] += smooth[c][x] * k * sign;
      }
    } else {
      for (let y = 0; y < h; y++) {
        const p = (y * w + i) * 3;
        for (let c = 0; c < 3; c++) rgb[p + c] += smooth[c][y] * k * sign;
      }
    }
  }
}

function meanColour(data: Uint8ClampedArray, w: number, h: number, axis: 0 | 1, line: number) {
  let r = 0, g = 0, b = 0;
  const n = axis === 0 ? w : h;
  for (let i = 0; i < n; i++) {
    const p = (axis === 0 ? line * w + i : i * w + line) * 4;
    r += data[p];
    g += data[p + 1];
    b += data[p + 2];
  }
  return [r / n, g / n, b / n];
}

const colourStep = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Which borders are an actual line. A direction is repaired only when the colour step across that tile edge is
 * larger than every step inside the photo. A weave that simply does not repeat pixel for pixel is not a line —
 * rolling that border to the middle draws one (the green linen's left and right edges are within its own grain). */
export function tileBreaks(data: Uint8ClampedArray, w: number, h: number): { across: boolean; down: boolean } {
  const worst = (axis: 0 | 1) => {
    const n = axis === 0 ? h : w;
    let m = 0;
    for (let i = 0; i < n - 1; i++) m = Math.max(m, colourStep(meanColour(data, w, h, axis, i), meanColour(data, w, h, axis, i + 1)));
    return m;
  };
  const down = h >= 2 && colourStep(meanColour(data, w, h, 0, 0), meanColour(data, w, h, 0, h - 1)) > worst(0) + 1;
  const across = w >= 2 && colourStep(meanColour(data, w, h, 1, 0), meanColour(data, w, h, 1, w - 1)) > worst(1) + 1;
  return { across, down };
}

/** Make one photo tile. A hard min-cut through the picture leaves a jagged coastline that repeats once per tile
 * (the horizontal line on a headboard). Instead the borders that do not meet are rolled to the middle — the new
 * tile edge is then two pixels that were already neighbours, so it cannot show a line — and only the low-frequency
 * colour difference at that join is spread into a ramp. Same width and height, so a tile of `tile_m` metres still
 * covers the same amount of the original weave. */
export function mendTile(src: Uint8ClampedArray, w: number, h: number, seams: { across: boolean; down: boolean }): Uint8ClampedArray {
  const ox = seams.across ? Math.floor(w / 2) : 0;
  const oy = seams.down ? Math.floor(h / 2) : 0;
  const rgb = new Float64Array(w * h * 3);
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    const sy = (y - oy + h) % h;
    for (let x = 0; x < w; x++) {
      const sx = (x - ox + w) % w;
      const from = (sy * w + sx) * 4;
      const to = (y * w + x) * 3;
      rgb[to] = src[from];
      rgb[to + 1] = src[from + 1];
      rgb[to + 2] = src[from + 2];
      out[(y * w + x) * 4 + 3] = src[from + 3];
    }
  }
  // Rows first: the green linen's bad join is the horizontal one, and the column pass then sees the corrected picture.
  if (seams.down && h >= 8) absorb(rgb, w, h, 0);
  if (seams.across && w >= 8) absorb(rgb, w, h, 1);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = clampByte(rgb[i * 3]);
    out[i * 4 + 1] = clampByte(rgb[i * 3 + 1]);
    out[i * 4 + 2] = clampByte(rgb[i * 3 + 2]);
  }
  return out;
}

/** The fabric photo made to tile without an edge. Colours and weave stay the photo's; only a border that does not
 * meet is repaired (mendTile). Same size as the source, baked into the texture the GLB stores. A photo that already
 * tiles is returned unchanged. */
export function seamlessFabric<T extends CanvasImageSource & { width: number; height: number }>(image: T): T | HTMLCanvasElement {
  try {
    const { canvas, ctx, w, h, data } = pixels(image, MAX_SIDE);
    // Each direction on its own: a photo that only has a top/bottom edge is only repaired top to bottom.
    const seams = tileBreaks(data.data, w, h);
    if (!seams.across && !seams.down) return image;
    const mended = mendTile(data.data, w, h, seams);
    const out = ctx.createImageData(w, h);
    out.data.set(mended);
    ctx.putImageData(out, 0, 0);
    return canvas;
  } catch {
    return image; // unreadable (cross-origin): used as it is
  }
}

/** A subtle weave relief for the fabric (a tangent-space normal map from its brightness), wrapping at the borders so
 * it tiles like the pattern. Small (512 px): it is fine surface detail, not the pattern. Null if the image cannot be
 * read. */
export function fabricNormals(image: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement | null {
  try {
    const { canvas, ctx, w, h, data } = pixels(image, 512);
    const px = data.data;
    const height = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) height[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
    const STRENGTH = 2.5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * STRENGTH;
        const dy = (at(x, y + 1) - at(x, y - 1)) * STRENGTH;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * w + x) * 4;
        px[i] = ((-dx / len) * 0.5 + 0.5) * 255;
        px[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
        px[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        px[i + 3] = 255;
      }
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}
