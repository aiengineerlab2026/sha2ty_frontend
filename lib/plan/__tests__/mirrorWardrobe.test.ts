import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { refine } from "../../vendor/animation";

// The real part boxes of a Meshy wardrobe (catalogue model 8610edac): three doors (one a mirror door named "Mirror
// door backing"), two drawers; handle pulls on mounting feet, locks with keys hanging from them.
test("every handle, lock, key and mirror rides with its own door or drawer (real Meshy wardrobe)", () => {
  const data: [string, number[][]][] = JSON.parse(readFileSync("lib/plan/__tests__/mirrorWardrobe.json", "utf8"));
  const model = new Group();
  const slots = data.map(([name, [a, b]]) => {
    const box = new Box3(new Vector3(...a), new Vector3(...b));
    const s = box.getSize(new Vector3()), c = box.getCenter(new Vector3());
    const mesh = new Mesh(new BoxGeometry(s.x, s.y, s.z).translate(c.x, c.y, c.z), new MeshStandardMaterial());
    model.add(mesh);
    return { id: name.toLowerCase().replace(/ /g, "_"), name, mesh };
  });
  model.updateMatrixWorld(true);
  const config = refine(null, slots, model)!;
  assert.deepEqual(config.animations.map((a) => a.component).sort(), ["center_wood_grain_door", "left_wood_grain_door", "lower_drawer_front", "mirror_door_backing", "upper_drawer_front"]);
  const owner = new Map(config.animations.flatMap((a) => a.follow.map((f) => [f, a.component] as const)));
  const expect: [RegExp, string][] = [[/^left_door_/, "left_wood_grain_door"], [/^center_door_/, "center_wood_grain_door"], [/^(mirrored_door_|mirror_surround|tall_inset)/, "mirror_door_backing"], [/^upper_drawer_(handle|lock)/, "upper_drawer_front"], [/^lower_drawer_handle/, "lower_drawer_front"]];
  for (const { id } of slots) {
    const want = expect.find(([re]) => re.test(id))?.[1];
    assert.equal(owner.get(id), want, id); // accessories on their own part; structure on none
  }
});
