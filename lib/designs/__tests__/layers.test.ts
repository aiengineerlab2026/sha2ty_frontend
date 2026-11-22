import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Vector3 } from "three";
import { layerOfLook, layerOfName, ownLayerName } from "../../vendor/layers";
import { applyAnimations, refine } from "../../vendor/animation";
import { checkMovers } from "../../vendor/reconstruct";
import type { PartInfo } from "../../vendor/parts";

const vision = (id: string, name: string, analysisId: string): PartInfo => ({ id, name, naming: "vision", analysisId, editable: true });
const WOOD = { metalness: 0, roughness: 0.6 };
const MIRROR = { metalness: 1, roughness: 0.05 };

test("the saved names of wardrobe b5efef35's doors: each photo name stays only on the layer it describes", () => {
  // As saved: the photo's mirror was given to the backing behind it, its door frame to the mirror pane, a mirror to a frame.
  const cases: [PartInfo, string, typeof WOOD, string, boolean][] = [
    [vision("right_inner_mirrored_door_mirror_backing", "Central right door mirror", "mirror_center_right"), "Right_inner_mirrored_door_mirror_backing_wood", WOOD, "Right inner mirrored door mirror backing", true],
    [vision("right_inner_mirrored_door_mirror", "Central right open door frame", "door_center_right"), "Right_inner_mirrored_door_mirror_mirror", MIRROR, "Right inner mirrored door mirror", true],
    [vision("right_outer_mirrored_door_mirror", "Far-right door frame", "door_far_right"), "Right_outer_mirrored_door_mirror_mirror", MIRROR, "Right outer mirrored door mirror", true],
    [vision("left_central_door_wood_frame", "Left inner door mirror", "mirror_left"), "Left_central_door_walnut", WOOD, "Left central door wood frame", true],
    // Correct links are kept as they are.
    [vision("left_outer_mirrored_door_wood_frame", "Far-left door frame", "door_far_left"), "Left_outer_mirrored_door_walnut", WOOD, "Far-left door frame", false],
    [vision("door_glass", "Left door glass", "glass_left"), "Smoked_glass", { metalness: 0, roughness: 0.1, transparent: true, opacity: 0.4 } as typeof WOOD, "Left door glass", false],
  ];
  for (const [info, materialName, look, name, relinked] of cases) {
    const out = ownLayerName(info, { materialName, look });
    assert.equal(out.name, name, info.id);
    assert.equal(out.analysisId, relinked ? undefined : info.analysisId, info.id);
    assert.equal(out.naming, relinked ? "file" : "vision");
  }
  // A part named by its file is never touched.
  const file: PartInfo = { id: "a", name: "Door mirror", naming: "file", editable: true };
  assert.equal(ownLayerName(file, { look: WOOD }), file);
});

test("layers from names and looks: mirrored ≠ mirror, a backing is a backing, a see-through material is glass", () => {
  assert.equal(layerOfName("Left_outer_mirrored_door_walnut"), null);
  assert.equal(layerOfName("door mirror backing"), "backing");
  assert.equal(layerOfName("Glazed door"), "glass");
  assert.equal(layerOfLook(MIRROR), "mirror");
  assert.equal(layerOfLook({ transmission: 0.9 }), "glass");
  assert.equal(layerOfLook({ metalness: 0.95, roughness: 0.4 }), "solid"); // brushed nickel: a fitting, not a mirror
});

/** A door as layers: frame ring (wood), a pane in front (mirror or glass), and wood behind it (a backing) when given. */
function layeredDoor(pane: "mirror" | "glass", backing: boolean, finish: MeshStandardMaterial) {
  const model = new Group();
  const body = new Mesh(new BoxGeometry(1, 2, 0.6).translate(0, 1, 0), new MeshStandardMaterial());
  body.name = "Carcass";
  const frame = new Mesh(new BoxGeometry(0.5, 1.9, 0.027).translate(-0.25, 1, 0.309), finish);
  frame.name = "Door frame";
  const front = new Mesh(new BoxGeometry(0.42, 1.8, 0.005).translate(-0.25, 1, 0.315), pane === "mirror" ? new MeshPhysicalMaterial({ name: "mirror", metalness: 1, roughness: 0.05 }) : new MeshPhysicalMaterial({ name: "glass", transmission: 0.9, transparent: true, opacity: 0.4 }));
  front.name = `Door ${pane}`;
  const parts = [{ id: "body", name: "Carcass", mesh: body }, { id: "door", name: "Door frame", mesh: frame }, { id: "pane", name: `Door ${pane}`, mesh: front }];
  if (backing) {
    const back = new Mesh(new BoxGeometry(0.42, 1.8, 0.012).translate(-0.25, 1, 0.304), new MeshStandardMaterial({ name: "backing wood", color: "#7a5230" }));
    back.name = "Door mirror backing";
    parts.push({ id: "backing", name: "Door mirror backing", mesh: back });
  }
  for (const p of parts) model.add(p.mesh);
  model.updateMatrixWorld(true);
  return { model, parts };
}

test("opening and closing never moves a finish to another surface: the pane stays on the front, the wood behind it", () => {
  const painted = new MeshStandardMaterial({ name: "white paint", color: "#ffffff", roughness: 0.45 });
  const laminate = new MeshStandardMaterial({ name: "oak laminate", color: "#b08850", roughness: 0.5 });
  for (const [pane, backing, finish] of [["mirror", true, painted], ["glass", false, laminate], ["mirror", true, laminate]] as const) {
    const { model, parts } = layeredDoor(pane, backing, finish);
    const c = checkMovers(refine(null, parts, model), parts, model)!;
    const door = c.animations.find((a) => a.component === "door")!;
    assert.ok(door.enabled && door.follow.includes("pane") && (!backing || door.follow.includes("backing")), JSON.stringify(door));
    const looks = new Map(parts.map((p) => [p.id, p.mesh.material]));
    const rest = new Map(parts.map((p) => [p.mesh, [p.mesh.position.clone(), p.mesh.quaternion.clone(), p.mesh.scale.clone()] as const]));
    for (const t of [1, 0, 0.5, 1, 0]) {
      for (const [m, [pos, q]] of rest) { m.position.copy(pos); m.quaternion.copy(q); }
      applyAnimations(parts, model, c, { [door.id]: t });
      model.updateMatrixWorld(true);
      // In the door's own frame (its front normal turned with it), the pane is in front of the frame's middle and the backing.
      const front = new Vector3(0, 0, 1).transformDirection(parts[1].mesh.matrixWorld);
      const depth = (id: string) => new Vector3().setFromMatrixPosition(parts.find((p) => p.id === id)!.mesh.matrixWorld).add(centre(id)).dot(front);
      const centre = (id: string) => { const m = parts.find((p) => p.id === id)!.mesh; m.geometry.computeBoundingBox(); return m.geometry.boundingBox!.getCenter(new Vector3()).applyQuaternion(m.getWorldQuaternion(m.quaternion.clone())); };
      if (backing) assert.ok(depth("pane") > depth("backing"), `t=${t}: the ${pane} faces out, the backing in`);
      assert.ok(depth("pane") > depth("door"), `t=${t}: the ${pane} is on the front of its frame`);
      for (const p of parts) {
        assert.equal(p.mesh.material, looks.get(p.id), `${p.id} keeps its own material`);
        assert.ok(p.mesh.scale.equals(rest.get(p.mesh)![2]) && p.mesh.visible, `${p.id} is not stretched or hidden`);
      }
      assert.equal((parts[1].mesh.material as MeshStandardMaterial).opacity, 1);
    }
  }
});
