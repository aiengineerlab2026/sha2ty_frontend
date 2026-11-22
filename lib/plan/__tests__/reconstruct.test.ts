import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3 } from "three";
import { boxInModel, refine, withDirection, withHinge, type PartAnimation } from "../../vendor/animation";
import { checkMovers, frontFill, movedBox, openCavities, rebuildPanel, triangles } from "../../vendor/reconstruct";

/** A generated cabinet as Meshy writes it: a SOLID body (its front face runs straight across behind the door), a
 * door panel and a drawer front on it. */
function cabinet() {
  const model = new Group();
  const add = (id: string, name: string, g: BoxGeometry | PlaneGeometry) => {
    const mesh = new Mesh(g, new MeshStandardMaterial({ color: "#c8a27a" }));
    mesh.name = id;
    model.add(mesh);
    return { id, name, mesh };
  };
  const slots = [
    add("body", "Body", new BoxGeometry(1, 2, 0.6, 8, 16, 1).translate(0, 1, 0)), // subdivided: faces to cut out
    add("door_left", "Left door", new BoxGeometry(0.48, 1.4, 0.02).translate(-0.25, 1.2, 0.31)),
    add("drawer_1", "Drawer", new BoxGeometry(0.96, 0.3, 0.02).translate(0, 0.3, 0.31)),
  ];
  model.updateMatrixWorld(true);
  return { model, slots };
}
const frontArea = (mesh: Mesh, model: Group, box: Box3) => {
  const tri = triangles(mesh, model);
  let sum = 0;
  for (let t = 0; t < tri.count; t++) {
    const x = tri.centroid[t * 3], y = tri.centroid[t * 3 + 1];
    if (tri.nz[t] > 0.5 && x > box.min.x && x < box.max.x && y > box.min.y && y < box.max.y) sum += tri.area[t];
  }
  return sum;
};

test("a solid body is opened behind its door and drawer: real hollow space, a drawer box that slides along", () => {
  const { model, slots } = cabinet();
  const config = checkMovers(refine(null, slots, model), slots, model)!;
  assert.ok(config.animations.every((a) => a.enabled), JSON.stringify(config.animations.map((a) => a.issues)));
  const doorBox = boxInModel(slots[1].mesh, model);
  const behindDoor = doorBox.clone().expandByVector(new Vector3(-0.03, -0.03, 0));
  assert.ok(frontArea(slots[0].mesh, model, behindDoor) > 0.5); // solid: the body's face is right behind the door
  const added = openCavities(config, slots, model);
  assert.ok(frontArea(slots[0].mesh, model, behindDoor) < 0.05, "the body's face behind the door is gone");
  assert.ok(frontArea(slots[0].mesh, model, new Box3(new Vector3(0.1, 0.7, 0), new Vector3(0.45, 1.9, 1))) > 0.3, "the uncovered front stays");
  const ids = added.map((a) => a.id).sort();
  assert.deepEqual(ids, ["cavity_door_left", "cavity_drawer_1", "drawer_box_drawer_1"]);
  const interior = boxInModel(added.find((a) => a.id === "cavity_door_left")!.mesh, model);
  const body = new Box3(new Vector3(-0.5, 0, -0.3), new Vector3(0.5, 2, 0.3));
  assert.ok(body.containsBox(interior), "the interior is inside the body, not overlapping out of it");
  assert.ok(interior.max.z <= doorBox.min.z && interior.max.z > doorBox.min.z - 0.01, "open right behind the door");
  assert.equal(added.find((a) => a.id === "drawer_box_drawer_1")!.follows, config.animations.find((a) => a.component === "drawer_1")!.id);
  // Opened once: the next check finds a hollow body and adds nothing.
  assert.deepEqual(openCavities(config, slots, model), []);
});

test("overlapping fragments, thick slabs and irregular pieces never move; a swing into the body is turned outwards", () => {
  const { model, slots } = cabinet();
  const extra = new Mesh(new BoxGeometry(0.4, 1.3, 0.02).translate(-0.2, 1.2, 0.33), new MeshStandardMaterial());
  model.add(extra);
  const slab = new Mesh(new BoxGeometry(0.4, 0.4, 0.4).translate(0.25, 1.5, 0.1), new MeshStandardMaterial());
  model.add(slab);
  const shard = new Mesh(new PlaneGeometry(0.4, 1.2).translate(0.25, 1.2, 0.31), new MeshStandardMaterial()); // a sliver: a triangle strip
  shard.geometry.setIndex([0, 1, 2]); // half the outline: an irregular piece
  model.add(shard);
  model.updateMatrixWorld(true);
  const all = [...slots, { id: "door_x", name: "Door", mesh: extra }, { id: "slab", name: "Door", mesh: slab }, { id: "shard", name: "Door", mesh: shard }];
  const base = refine(null, all, model)!;
  const vision = base.animations.map((a) => (a.component === "door_left" ? { ...a, source: "vision" as const } : a));
  const checked = checkMovers({ ...base, animations: vision }, all, model)!;
  const by = Object.fromEntries(checked.animations.map((a) => [a.component, a]));
  assert.equal(by.door_left.enabled, true); // the vision-matched door wins the overlap
  assert.equal(by.door_x.enabled, false);
  assert.match(by.door_x.issues.join(" "), /Overlaps/);
  assert.match(by.slab.issues.join(" "), /Not a flat panel/);
  assert.match(by.shard.issues.join(" "), /irregular piece/);
  // A hinge set to swing inwards is turned outwards.
  const door = boxInModel(slots[1].mesh, model);
  const inwards: PartAnimation = { ...withHinge(by.door_left, "left", door), to: 95 };
  assert.ok(movedBox(inwards, door).min.z < door.min.z - 0.1);
  const fixed = checkMovers({ ...checked, animations: [inwards] }, slots, model)!.animations[0];
  assert.equal(fixed.to, -95);
  assert.equal(fixed.enabled, true);
  // A drawer slides out, never into the body.
  const drawer = withDirection(by.drawer_1, "back", 0.3);
  assert.ok(checkMovers({ ...checked, animations: [drawer] }, slots, model)!.animations[0].distance! > 0);
});

test("rebuilding an irregular piece gives a full flat panel of the same outline, same material", () => {
  const shard = new Mesh(new PlaneGeometry(0.4, 1.2), new MeshStandardMaterial());
  shard.geometry.setIndex([0, 1, 2]);
  const model = new Group();
  model.add(shard);
  model.updateMatrixWorld(true);
  const box = boxInModel(shard, model);
  assert.ok(frontFill(triangles(shard, model), box) < 0.6);
  const material = shard.material;
  assert.equal(rebuildPanel(shard), true);
  const after = boxInModel(shard, model);
  assert.ok(after.min.distanceTo(box.min) < 1e-3 && after.max.distanceTo(box.max) < 1e-3 && shard.material === material);
  assert.ok(frontFill(triangles(shard, model), after) > 0.99);
});

/** A cabinet built from separate panels (as GPT Astra writes it): HOLLOW behind its drawer front, no drawer box. */
function panelCabinet() {
  const model = new Group();
  const add = (id: string, name: string, g: BoxGeometry) => {
    const mesh = new Mesh(g, new MeshStandardMaterial({ color: "#efe8dc" }));
    mesh.name = id;
    model.add(mesh);
    return { id, name, mesh };
  };
  const slots = [
    add("left", "Left side panel", new BoxGeometry(0.02, 0.8, 0.5).translate(-0.49, 0.4, 0)),
    add("right", "Right side panel", new BoxGeometry(0.02, 0.8, 0.5).translate(0.49, 0.4, 0)),
    add("bottom", "Bottom panel", new BoxGeometry(0.96, 0.02, 0.5).translate(0, 0.01, 0)),
    add("top", "Top panel", new BoxGeometry(0.96, 0.02, 0.5).translate(0, 0.79, 0)),
    add("back", "Back panel", new BoxGeometry(0.96, 0.8, 0.01).translate(0, 0.4, -0.245)),
    add("drawer_1", "Drawer 1", new BoxGeometry(0.94, 0.25, 0.02).translate(0, 0.15, 0.26)),
  ];
  model.updateMatrixWorld(true);
  return { model, slots };
}

test("a drawer in a hollow, panel-built cabinet still gets its box (base, sides, back), once, sliding with its front", () => {
  const { model, slots } = panelCabinet();
  const config = checkMovers(refine(null, slots, model), slots, model)!;
  const drawer = config.animations.find((a) => a.component === "drawer_1")!;
  assert.ok(drawer.enabled && drawer.type === "translation");
  const added = openCavities(config, slots, model);
  assert.deepEqual(added.map((a) => [a.id, a.follows]), [["drawer_box_drawer_1", drawer.id]]);
  const box = boxInModel(added[0].mesh, model);
  const front = boxInModel(slots[5].mesh, model);
  assert.ok(box.max.z <= front.min.z && box.min.z >= -0.25, "behind its front, inside the cabinet");
  assert.ok(box.min.y >= front.min.y - 1e-6 && box.max.x <= front.max.x, "within the front's outline");
  assert.ok(Math.abs(box.min.z - box.max.z) >= Math.abs(drawer.distance ?? 0), "deep enough to stay in the cabinet when open");
  assert.deepEqual(openCavities(config, slots, model), []); // added once
});
