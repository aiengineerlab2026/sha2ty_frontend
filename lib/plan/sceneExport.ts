import { Group, Scene } from "three";
import { exportSceneGlb } from "./exportPlan";

let apartment: Scene | null = null;

/** The planner canvas. Export reads the live furniture, walls and floors out of it. */
export function bindApartmentScene(scene: Scene | null) {
  apartment = scene;
}

const KEEP = new Set(["placed-furniture", "apartment-wall", "apartment-floor"]);

/** Apartment shell plus every placed model, at its room position, with the materials currently on screen. */
export async function exportApartmentGlb(): Promise<Blob | null> {
  if (!apartment) return null;
  const group = new Group();
  group.name = "apartment";
  const found: { name: string }[] = [];
  apartment.traverse((obj) => {
    if (KEEP.has(obj.name)) found.push(obj);
  });
  for (const obj of found) {
    const node = obj as import("three").Object3D;
    const clone = node.clone(true);
    node.updateWorldMatrix(true, false);
    clone.matrix.copy(node.matrixWorld);
    clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
    clone.matrixAutoUpdate = true;
    group.add(clone);
  }
  if (!group.children.length) return null;
  return exportSceneGlb(group);
}
