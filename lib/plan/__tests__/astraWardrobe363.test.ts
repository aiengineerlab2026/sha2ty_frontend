import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { attachmentsFrom, refine, type AnimationConfig, type PartAnimation } from "../../vendor/animation";
import { checkMovers } from "../../vendor/reconstruct";

// The real parts of catalogue model 363f2fbd (a GPT Astra children's wardrobe): four doors, each with a vertical grip
// on two mounts, side shelves. Its vision reading named door 1's grip "Inner left door handle" and said it is attached to
// door 2 (its box drawn on the line between the two doors). Applied without looking at the geometry, that relation
// gave door 2 a second handle and left door 1 blocked by its own grip (opening 0°).
type Fixture = {
  parts: [string, string, number[], number[]][];
  doc: { components: { id: string; analysisId: string }[]; analysis: { components: Record<string, unknown>[] } };
  saved: AnimationConfig;
};
const data: Fixture = JSON.parse(readFileSync("lib/plan/__tests__/astraWardrobe363.json", "utf8"));

type Slot = { id: string; name: string; mesh: Mesh };

/** The wardrobe's parts as boxes, optionally turned about y (`turn`, radians) or mirrored left ⇄ right (`mirror`). */
function build({ turn = 0, mirror = false, extra = [] as [string, string, number[], number[]][] } = {}) {
  const model = new Group();
  const slots: Slot[] = [...data.parts, ...extra].map(([id, name, a, b]) => {
    const box = new Box3(new Vector3(...a), new Vector3(...b));
    if (mirror) [box.min.x, box.max.x] = [-box.max.x, -box.min.x];
    const s = box.getSize(new Vector3()), c = box.getCenter(new Vector3());
    const geo = new BoxGeometry(s.x, s.y, s.z).translate(c.x, c.y, c.z).rotateY(turn);
    const mesh = new Mesh(geo, new MeshStandardMaterial());
    mesh.name = name;
    model.add(mesh);
    return { id, name, mesh };
  });
  model.updateMatrixWorld(true);
  return { model, slots };
}

const ready = (slots: Slot[], model: Group, saved: AnimationConfig | null = data.saved) =>
  checkMovers(refine(saved && JSON.parse(JSON.stringify(saved)), slots, model, attachmentsFrom(data.doc)), slots, model)!;

const door = (c: AnimationConfig, n: number) => c.animations.find((a) => a.component.startsWith(`door_0${n}_`))!;
const owners = (c: AnimationConfig) => {
  const out = new Map<string, string[]>();
  for (const a of c.animations) for (const f of a.follow) out.set(f, [...(out.get(f) ?? []), a.component]);
  return out;
};
const opens = (a: PartAnimation) => Math.abs((a.to ?? 0) - (a.from ?? 0));

function assertHealthy(c: AnimationConfig, mirrored = false) {
  for (const n of [1, 2, 3, 4]) {
    const d = door(c, n);
    assert.ok(d.enabled, `door ${n} enabled (${d.issues.join("; ")})`);
    assert.ok(opens(d) >= 60, `door ${n} opens ${opens(d)}° (${d.limit?.by ?? "no limit"})`);
    assert.ok(!d.limit || !/handle|grip|mount/i.test(d.limit.by) || !d.limit.by.toLowerCase().includes(`0${n}`), `door ${n} is not blocked by its own handle`);
  }
  // Every grip and mount rides with its own door only: no handle on two doors, none left behind.
  const own = owners(c);
  for (const [id] of data.parts.filter(([id]) => /^handle_0\d_/.test(id))) {
    const n = id[8];
    assert.deepEqual(own.get(id), [door(c, Number(n)).component], `${id} belongs to door ${n} only`);
  }
  // Hinges: the outer doors on the cabinet's sides, the inner ones at the centre partition (handles meet in pairs).
  const want = mirrored ? ["right", "left", "right", "left"] : ["left", "right", "left", "right"];
  assert.deepEqual([1, 2, 3, 4].map((n) => door(c, n).hinge), want);
}

test("real Astra wardrobe: the leftmost door opens and every handle rides with its own door (saved state reloaded)", () => {
  const { model, slots } = build();
  const c = ready(slots, model);
  assertHealthy(c);
  const left = door(c, 1);
  assert.ok(Math.abs(left.pivot![0] - -0.799) < 0.01, `door 1 turns on its left edge (pivot x ${left.pivot![0]})`);
  assert.ok(left.follow.includes("handle_01_vertical_grip"), "door 1 carries its own grip");
  assert.ok(!door(c, 2).follow.includes("handle_01_vertical_grip"), "door 2 no longer carries door 1's grip");
});

test("real Astra wardrobe: the same from scratch (no saved animation)", () => {
  const { model, slots } = build();
  assertHealthy(ready(slots, model, null));
});

test("real Astra wardrobe: the repair is stable: saved and reopened twice, nothing changes or doubles", () => {
  const { model, slots } = build();
  const once = ready(slots, model);
  const twice = ready(slots, model, JSON.parse(JSON.stringify(once)));
  const thrice = ready(slots, model, JSON.parse(JSON.stringify(twice)));
  const shape = (c: AnimationConfig) => c.animations.map((a) => ({ c: a.component, f: [...a.follow].sort(), h: a.hinge, to: a.to, p: a.pivot, e: a.enabled }));
  assert.deepEqual(shape(twice), shape(once));
  assert.deepEqual(shape(thrice), shape(once));
  for (const a of thrice.animations) assert.equal(new Set(a.follow).size, a.follow.length, `${a.component}: no follower twice`);
});

test("real Astra wardrobe: turned to face sideways, or mirrored, every door still opens with its own handle", () => {
  for (const turn of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const { model, slots } = build({ turn });
    assertHealthy(ready(slots, model, null));
  }
  const { model, slots } = build({ mirror: true });
  assertHealthy(ready(slots, model, null), true);
});

test("real Astra wardrobe: a door with two handles keeps both", () => {
  // A second grip on door 4, lower down: an intentional design, never merged or dropped.
  const extra: [string, string, number[], number[]][] = [
    ["handle_04_lower_grip", "Handle 04 lower grip", [0.152, 0.3, 0.311], [0.163, 0.5, 0.327]],
    ["handle_04_lower_mount", "Handle 04 lower mount", [0.153, 0.39, 0.29], [0.162, 0.41, 0.313]],
  ];
  const { model, slots } = build({ extra });
  const c = ready(slots, model);
  const d4 = door(c, 4).follow;
  for (const id of ["handle_04_vertical_grip", "handle_04_lower_grip", "handle_04_lower_mount"]) assert.ok(d4.includes(id), id);
  assertHealthy(c);
});

test("a vision relation is still honoured when the part really is on that door", () => {
  // The analysis ties the grip to door 1 (where it is): kept, whatever its name says.
  const { model, slots } = build();
  const doc = JSON.parse(JSON.stringify(data.doc));
  for (const comp of doc.analysis.components) if (comp.id === "handle_left_inner") comp.relations = [{ type: "attached_to", target: "door_left_outer" }];
  const c = checkMovers(refine(null, slots, model, attachmentsFrom(doc)), slots, model)!;
  assert.deepEqual(owners(c).get("handle_01_vertical_grip"), ["door_01_outer_left_coral"]);
});

test("collision still stops a door at something really in its way", () => {
  // A post standing in front of door 1's free edge (not on it, not moving): door 1 must stop before it.
  const extra: [string, string, number[], number[]][] = [["post", "Standing post", [-0.6, 0.03, 0.45], [-0.55, 2.0, 0.5]]];
  const { model, slots } = build({ extra });
  const d1 = door(ready(slots, model, null), 1);
  assert.ok(d1.limit && d1.limit.by === "Standing post" && opens(d1) < 60, `door 1 stopped by the post (${JSON.stringify(d1.limit)})`);
});
