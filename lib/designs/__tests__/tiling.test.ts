import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, PlaneGeometry, Vector3 } from "three";
import { boxProject, mendTile, projectionAxes, seamsIn, splitSheetEdge, tileBreaks, verticalBend, wrapColumns } from "../../vendor/tiling";

const one = new Vector3(1, 1, 1);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test("a tufted headboard front is projected as one piece: its bumps do not become patches facing up or sideways", () => {
  // A 1.6 × 1 m front (facing +Z) with 20 × 12 quads; a few buttons pushed in far enough that their triangles face
  // mostly sideways or up.
  const front = new PlaneGeometry(1.6, 1, 20, 12);
  const pos = front.getAttribute("position");
  for (const v of [50, 75, 100, 130, 160, 190]) pos.setZ(v, -0.2);
  front.computeVertexNormals();
  const range = { start: 0, count: front.index!.count };
  const axes = projectionAxes(front, range, one);
  assert.deepEqual(new Set(axes), new Set([4]), "every triangle takes the front's +Z projection");
  // And its UVs are then one continuous planar layout: u = x / tile.
  const out = boxProject(front, range, one, 0.3, 0.3);
  const [uv, p] = [out.getAttribute("uv"), out.getAttribute("position")];
  for (let v = 0; v < uv.count; v++) assert.ok(Math.abs(uv.getX(v) - p.getX(v) / 0.3) < 1e-6);
});

test("a cube keeps its six real faces, each with its own projection", () => {
  const cube = new BoxGeometry(1, 1, 1);
  cube.clearGroups();
  const axes = projectionAxes(cube, { start: 0, count: cube.index!.count }, one);
  assert.equal(new Set(axes).size, 6);
});

test("a photo that does not tile is wrapped by copying its own pixels: the new edge is no bigger a step than inside it", () => {
  // Stripes every 17 px on a 100 px photo: the right edge does not meet the left one (100 is not a multiple of 17).
  const [w, h] = [100, 8];
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src.set([128 + 100 * Math.sin((2 * Math.PI * x) / 17), 60, 60, 255], (y * w + x) * 4);
  const step = (d: Uint8ClampedArray, width: number, a: number, b: number) => Math.abs(d[a * 4] - d[b * 4]) + 0 * width;
  const innerMax = Math.max(...Array.from({ length: w - 1 }, (_, x) => step(src, w, x, x + 1)));
  assert.ok(step(src, w, w - 1, 0) > innerMax, "the photo as it is shows an edge when repeated");
  const { data, w: out } = wrapColumns(src, w, h, 12);
  assert.equal(out, 88);
  for (let y = 0; y < h; y++) assert.ok(step(data, out, y * out + out - 1, y * out) <= innerMax, "no edge where the tile repeats");
  // Only the photo's own values: nothing blended.
  const own = new Set(Array.from({ length: w }, (_, x) => src[x * 4]));
  for (let i = 0; i < data.length; i += 4) assert.ok(own.has(data[i]));
});

test("a curved headboard is wrapped as one piece: the pattern runs round the curve at its real size, with no bands", () => {
  // A 120° arc of radius 1.5 m, 1 m tall, its outside facing the room.
  const arc = new CylinderGeometry(1.5, 1.5, 1, 48, 4, true, -Math.PI / 3, (2 * Math.PI) / 3);
  const range = { start: 0, count: arc.index!.count };
  const bend = verticalBend(arc, range, one, projectionAxes(arc, range, one));
  assert.ok(bend, "the curve is recognised");
  const out = boxProject(arc, range, one, 0.3, 0.3);
  assert.equal(out.getAttribute("position").count, arc.getAttribute("position").count, "no vertex split: no seam anywhere on the curve");
  const uv = out.getAttribute("uv");
  const us = Array.from({ length: uv.count }, (_, v) => uv.getX(v));
  // Arc length 1.5 × 120° = 3.14 m → 10.5 tiles of 30 cm across.
  close(Math.max(...us) - Math.min(...us), (1.5 * (2 * Math.PI) / 3) / 0.3);
});

test("a flat box is not taken for a curve", () => {
  const box = new BoxGeometry(1.6, 1, 0.1, 8, 4, 1);
  box.clearGroups();
  const range = { start: 0, count: box.index!.count };
  assert.equal(verticalBend(box, range, one, projectionAxes(box, range, one)), null);
});

test("a thick curved panel (front facing out, back facing in) is still one curve, front and back each continuous", () => {
  const outer = new CylinderGeometry(1.5, 1.5, 1, 48, 4, true, -Math.PI / 3, (2 * Math.PI) / 3);
  const inner = new CylinderGeometry(1.42, 1.42, 1, 48, 4, true, -Math.PI / 3, (2 * Math.PI) / 3);
  // One geometry: the outer shell, then the inner one wound the other way (its faces point into the curve).
  const panel = new BufferGeometry();
  const [po, pi] = [outer.getAttribute("position"), inner.getAttribute("position")];
  const positions = new Float32Array([...(po.array as Float32Array), ...(pi.array as Float32Array)]);
  panel.setAttribute("position", new BufferAttribute(positions, 3));
  const io = Array.from(outer.index!.array), ii = Array.from(inner.index!.array);
  const flipped: number[] = [];
  for (let k = 0; k < ii.length; k += 3) flipped.push(ii[k] + po.count, ii[k + 2] + po.count, ii[k + 1] + po.count);
  panel.setIndex([...io, ...flipped]);
  const range = { start: 0, count: panel.index!.count };
  assert.ok(verticalBend(panel, range, one, projectionAxes(panel, range, one)), "front and back together are recognised as a curve");
  const out = boxProject(panel, range, one, 0.3, 0.3);
  assert.equal(out.getAttribute("position").count, panel.getAttribute("position").count, "no seam on either side");
});

test("where the front meets the top the pattern carries on over the edge (unfolded), with no step", () => {
  // A 1.6 × 1 × 0.1 m headboard block; front faces +Z, its top +Y.
  const block = new BoxGeometry(1.6, 1, 0.1, 8, 5, 1);
  block.clearGroups();
  const out = boxProject(block, { start: 0, count: block.index!.count }, one, 0.3, 0.3);
  const [p, uv, n] = [out.getAttribute("position"), out.getAttribute("uv"), out.getAttribute("normal")];
  // The front's and the top's UVs at the same point on their shared edge (y = 0.5, z = 0.05).
  const at = (face: (i: number) => boolean, x: number) => {
    for (let i = 0; i < p.count; i++) if (face(i) && Math.abs(p.getX(i) - x) < 1e-6 && Math.abs(p.getY(i) - 0.5) < 1e-6 && Math.abs(p.getZ(i) - 0.05) < 1e-6) return [uv.getX(i), uv.getY(i)];
    throw new Error("no vertex");
  };
  for (const x of [-0.8, 0, 0.6]) {
    const front = at((i) => n.getZ(i) > 0.9, x);
    const top = at((i) => n.getY(i) > 0.9, x);
    close(front[0], top[0]);
    close(front[1], top[1]);
  }
});

test("a hard horizontal join is spread out, and the tile edge is two pixels that were already neighbours", () => {
  // Brightens steadily down the photo, so the bottom row does not meet the top, plus a weave. The same
  // kind of border the green linen has: continuous inside, a step only when the photo repeats.
  const [w, h] = [80, 60];
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const weave = 24 * Math.sin((2 * Math.PI * x) / 7) + 16 * Math.sin((2 * Math.PI * y) / 5);
      const base = 70 + (y / (h - 1)) * 90;
      src.set([base + weave, base * 0.85 + weave, base * 0.7, 255], (y * w + x) * 4);
    }
  }
  const mean = (data: Uint8ClampedArray, y: number) => {
    let s = 0;
    for (let x = 0; x < w; x++) s += data[(y * w + x) * 4];
    return s / w;
  };
  const cliff = Math.abs(mean(src, 0) - mean(src, h - 1));
  assert.ok(cliff > 70, "the photo as it is shows a horizontal edge when repeated");
  const seams = seamsIn(src, w, h);
  const out = mendTile(src, w, h, seams);
  // The new border is a pair of rows that were already next to each other, so it steps like the weave, not like the cliff.
  let weave = 0;
  for (let y = 0; y < h - 1; y++) weave = Math.max(weave, Math.abs(mean(src, y) - mean(src, y + 1)));
  assert.ok(Math.abs(mean(out, 0) - mean(out, h - 1)) <= weave + 2, "the tile's top meets its bottom");
  let worst = 0;
  for (let y = 0; y < h - 1; y++) worst = Math.max(worst, Math.abs(mean(out, y) - mean(out, y + 1)));
  assert.ok(worst < cliff / 2, `the join is spread out (largest row step ${worst}, cliff was ${cliff})`);
  // A border pixel is the photo's own pixel, not a blend: the repair stays in the middle.
  const ox = seams.across ? Math.floor(w / 2) : 0;
  const oy = seams.down ? Math.floor(h / 2) : 0;
  assert.equal(out[0], src[(((0 - oy + h) % h) * w + ((0 - ox + w) % w)) * 4]);
});

test("a vertical join no bigger than the weave is left alone; a darker bottom edge is repaired", () => {
  const [w, h] = [40, 40];
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Period 10 divides 40, so left meets right. Brightness falls down the photo, so top does not meet bottom.
      const weave = 40 * Math.sin((2 * Math.PI * x) / 10);
      data.set([140 + weave - y, 120 + weave - y * 0.6, 100, 255], (y * w + x) * 4);
    }
  }
  assert.deepEqual(tileBreaks(data, w, h), { across: false, down: true });
});

test("a photo with only a top/bottom edge is judged that way: horizontal lines, no vertical ones", () => {
  const [w, h] = [40, 40];
  const data = new Uint8ClampedArray(w * h * 4);
  // Repeats left to right (period 10 divides 40), brightens top to bottom: the bottom row does not meet the top.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([100 + 20 * Math.sin((2 * Math.PI * x) / 10) + y * 3, 90, 80, 255], (y * w + x) * 4);
  assert.deepEqual(seamsIn(data, w, h), { across: false, down: true });
});

test("a sheet's faces stay the finish and its cut edges become the core", () => {
  // 1.2 × 0.8 m panel, 18 mm thick. The two broad faces are the finish; the rim is the core.
  const panel = new BoxGeometry(1.2, 0.018, 0.8);
  panel.clearGroups();
  const projected = boxProject(panel, { start: 0, count: panel.index!.count }, one, 0.6, 0.6, 0);
  const split = splitSheetEdge(projected, one, ({ along, through, thickness }) => [along / 0.04, through / thickness]);
  assert.ok(split);
  assert.equal(split.thin, 1);
  assert.equal(projected.groups.length, 2);
  const [face, edge] = projected.groups;
  assert.equal(face.materialIndex, 0);
  assert.equal(edge.materialIndex, 1);
  assert.equal(face.count, 12); // the two broad faces, four triangles
  assert.equal(edge.count, 24); // the cut rim
  // A cube is not a sheet: nothing is split off.
  const cube = new BoxGeometry(0.4, 0.4, 0.4);
  cube.clearGroups();
  const solid = boxProject(cube, { start: 0, count: cube.index!.count }, one, 0.6, 0.6, 1);
  assert.equal(splitSheetEdge(solid, one, () => [0, 0]), null);
});

test("wood grain runs along a part: V follows a leg's height and a rail's length on every side face", () => {
  // Along a face, moving the length of the part changes V only (U stays): the image's grain lies along it.
  const grainAlong = (geometry: BoxGeometry, axis: 0 | 1 | 2) => {
    geometry.clearGroups();
    const out = boxProject(geometry, { start: 0, count: geometry.index!.count }, one, 0.6, 0.6, axis);
    const [uv, p, idx] = [out.getAttribute("uv"), out.getAttribute("position"), out.index!];
    const get = (v: number) => [p.getX(v), p.getY(v), p.getZ(v)];
    let checked = 0;
    for (let i = 0; i < idx.count; i += 3) {
      const [a, b, c] = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
      for (const [m, n] of [[a, b], [b, c], [a, c]]) {
        const [pm, pn] = [get(m), get(n)];
        const moved = [0, 1, 2].filter((k) => Math.abs(pm[k] - pn[k]) > 1e-6);
        if (moved.length !== 1 || moved[0] !== axis) continue; // an edge running exactly along the part
        close(uv.getX(m), uv.getX(n)); // U unchanged: the grain (V) follows the part
        assert.ok(Math.abs(uv.getY(m) - uv.getY(n)) > 1e-3);
        checked++;
      }
    }
    assert.ok(checked >= 8, `${checked} edges checked`);
  };
  grainAlong(new BoxGeometry(0.04, 0.45, 0.04), 1); // a chair leg: grain up its height
  grainAlong(new BoxGeometry(0.9, 0.06, 0.04), 0); // a rail: along its length, also on its top and bottom
  grainAlong(new BoxGeometry(0.04, 0.06, 0.9), 2); // a side rail
});
