"use client";

import { useT } from "@/lib/i18n";
import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Download, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bounds, ContactShadows, Environment, OrbitControls, useBounds, useGLTF } from "@react-three/drei";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { AmbientLight, Box3, BufferGeometry, Color, DirectionalLight, Euler, Group, LinearSRGBColorSpace, Matrix4, Mesh, MeshStandardMaterial, NeutralToneMapping, NormalBlending, Object3D, PerspectiveCamera, PMREMGenerator, Quaternion, RepeatWrapping, Scene, Sphere, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer, type Material } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { measure, normalizeModel, type CatalogSize, type Dimensions, type NormalizationReport } from "@/lib/plan/modelNormalization";
import type { MaterialEdit, PartDocument, PartEditorApi, PartInfo } from "@/lib/vendor/parts";
import { quote } from "@/lib/designs/materials";
import { boxProject, fabricNormals, inspectUv, seamlessFabric, splitSheetEdge, type Mapping } from "@/lib/vendor/tiling";
import { PartControls, PartList, partLabel } from "./PartEditor";
import { MaterialPicker } from "./MaterialPicker";
import { ResizeGizmo } from "@/components/designs/ResizeGizmo";
import { MIN_SIZE, resized } from "@/lib/designs/resize";

export type Slot = { id: string; name: string; naming?: PartInfo["naming"]; mesh: Mesh; materialIndex: number };

/** Extra transform on one mesh, relative to how the file was authored. Scale is a multiplier (1 = unchanged). */
export type PartPose = {
  scale?: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
};

export const WHOLE = "One mesh. Color and texture change the whole model. Separate cushions, legs or doors were not in this file.";

function materials(mesh: Mesh): Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function standard(mat: Material): MeshStandardMaterial | null {
  return "color" in mat && "roughness" in mat ? (mat as MeshStandardMaterial) : null;
}

const CORE = "sha2ty-core"; // the cut edge of a sheet. Not its own part: the face's edit builds it, and the GLB keeps it.

/** Engineered sheets whose cut edge is a different material from the face. Solid wood is one grain all round. */
const CORED = new Set(["mdf", "hdf", "plywood", "particleboard", "blockboard"]);

function realMaterials(mesh: Mesh): Material[] {
  return materials(mesh).filter((mat) => mat.name !== CORE);
}

/** Back to one material on the loaded geometry. The next pattern lays the whole part out again, faces and edges. */
function dropCore(mesh: Mesh) {
  const list = materials(mesh);
  if (!list.some((mat) => mat.name === CORE)) return;
  const face = list.find((mat) => mat.name !== CORE) ?? list[0];
  for (const mat of list) if (mat.name === CORE) mat.dispose();
  mesh.material = face;
  const loaded = originalGeometry.get(mesh);
  if (loaded && mesh.geometry !== loaded) {
    mesh.geometry.dispose();
    mesh.geometry = loaded;
  }
  mesh.geometry.clearGroups(); // the edge group pointed at the material just removed
}

/** An opaque finish hides the core on the faces only. Clear lacquer seals the edge too. Raw MDF is smooth on the edge as well. */
function showCore(edit: MaterialEdit): boolean {
  const type = edit.material?.kind === "wood" ? edit.material.wood_type : undefined;
  if (!type || !CORED.has(type)) return false;
  const finish = edit.material?.finish?.wood_type;
  if (finish === "lacquer") return false;
  if (finish) return true;
  return type === "particleboard" || type === "blockboard" || type === "plywood";
}

export function paint(mat: Material, edit: MaterialEdit) {
  const std = standard(mat);
  if (!std) return;
  // Painted: a flat colour, no fabric or wood pattern under it.
  if (edit.material?.kind === "paint") {
    std.map = null;
    std.normalMap = null;
  }
  if (edit.color) std.color.set(edit.color);
  if (edit.roughness != null) std.roughness = edit.roughness;
  if (edit.metalness != null) std.metalness = edit.metalness;
  if (std.map) {
    // Repeat multiplies the tile size; `base` turns a kept UV layout into tiles of that size (layPattern).
    const base = (std.map.userData.base as [number, number] | undefined) ?? [1, 1];
    const repeat = edit.repeat ?? [1, 1];
    if (edit.repeat || std.map.userData.base) std.map.repeat.set(repeat[0] * base[0], repeat[1] * base[1]);
  }
  if (std.map && edit.rotation != null) std.map.rotation = edit.rotation;
  if (std.map && edit.offset) std.map.offset.set(edit.offset[0], edit.offset[1]);
  // The weave relief lies exactly on the pattern (same tiles, turn and shift), in the editor and in the GLB.
  for (const relief of [std.normalMap, std.roughnessMap]) {
    if (!std.map || !relief || (weave.get(std.map) !== relief && grain.get(std.map) !== relief)) continue;
    relief.repeat.copy(std.map.repeat);
    relief.offset.copy(std.map.offset);
    relief.rotation = std.map.rotation;
  }
  std.needsUpdate = true;
}

const fabrics = new Map<string, { color: HTMLImageElement | HTMLCanvasElement; normal: HTMLCanvasElement | null }>();
// A pattern's weave relief (normal map). Not in texture.userData: the exporter writes userData into the GLB.
const weave = new WeakMap<Texture, Texture>();
// A wood's roughness map (pores duller than the surface), laid exactly like its colour map.
const grain = new WeakMap<Texture, Texture>();
// The sheet's core (cut edge), prepared with the face texture so a saved edit rebuilds both.
const boardCores = new WeakMap<Texture, { color: Texture; normal: Texture | null; rough: Texture | null }>();

/** The default woods (public/woods, scripts/make-woods.py) ship PBR maps beside the colour image. */
const companion = (url: string, map: "normal" | "roughness") => (/\/woods\/[a-z]+\.jpg$/.test(url) ? url.replace(/\.jpg$/, `_${map}.jpg`) : null);

/** Cut-edge maps for a sheet. MDF and HDF are the smooth board itself; the others have a separate core image. */
function coreUrls(type: string): { color: string; normal: string; rough: string } | null {
  if (!CORED.has(type)) return null;
  const file = type === "mdf" || type === "hdf" ? type : `${type}_edge`;
  return { color: `/woods/${file}.jpg`, normal: `/woods/${file}_normal.jpg`, rough: `/woods/${file}_roughness.jpg` };
}

function reliefTexture(image: CanvasImageSource) {
  const texture = new Texture(image);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  texture.center.set(0, 0);
  texture.needsUpdate = true;
  return texture;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("texture"));
    image.src = url;
  });
}

export function loadMap(url: string, edit: MaterialEdit) {
  return new Promise<Texture>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      // Prepared once per fabric: the seamless image and its weave relief (canvases, baked into the GLB on save).
      const prepared = fabrics.get(url) ?? (() => {
        const color = seamlessFabric(image);
        const next = { color, normal: fabricNormals(color) };
        fabrics.set(url, next);
        return next;
      })();
      const texture = new Texture(prepared.color);
      texture.colorSpace = SRGBColorSpace; // a colour image (the base colour map)
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.anisotropy = maxAnisotropy; // sharp tiles at grazing angles (the headboard's top and sides)
      texture.center.set(0, 0); // glTF's texture transform has no centre: rotate about the UV origin so the GLB matches
      if (edit.repeat) texture.repeat.set(edit.repeat[0], edit.repeat[1]);
      if (edit.rotation != null) texture.rotation = edit.rotation;
      if (edit.offset) texture.offset.set(edit.offset[0], edit.offset[1]);
      texture.needsUpdate = true;
      // A vendor's own normal map is used when the pattern is used as uploaded (it matches that image pixel for pixel);
      // a default wood has its own normal and roughness maps; otherwise the relief is read from the image.
      const wood = edit.material?.kind === "wood";
      const normalUrl = (edit.normalUrl && prepared.color === image ? edit.normalUrl : null) ?? (wood ? companion(url, "normal") : null);
      const roughUrl = wood ? companion(url, "roughness") : null;
      const core = wood && edit.material?.wood_type ? coreUrls(edit.material.wood_type) : null;
      void Promise.all([
        normalUrl ? loadImage(normalUrl).catch(() => null) : null,
        roughUrl ? loadImage(roughUrl).catch(() => null) : null,
        core ? loadImage(core.color).catch(() => null) : null,
        core ? loadImage(core.normal).catch(() => null) : null,
        core ? loadImage(core.rough).catch(() => null) : null,
      ]).then(([own, rough, coreColor, coreNormal, coreRough]) => {
        const reliefImage = own ?? prepared.normal;
        if (reliefImage) weave.set(texture, reliefTexture(reliefImage));
        if (rough) grain.set(texture, reliefTexture(rough));
        if (coreColor) {
          const color = reliefTexture(coreColor);
          color.colorSpace = SRGBColorSpace; // a colour photo, like the face map; the normal and roughness stay linear
          boardCores.set(texture, { color, normal: coreNormal ? reliefTexture(coreNormal) : null, rough: coreRough ? reliefTexture(coreRough) : null });
        }
        resolve(texture);
      });
    };
    image.onerror = () => reject(new Error("texture"));
    image.src = url;
  });
}

// Not in mesh.userData: the exporter writes userData into the GLB, and each material serialized there carried its
// texture as a base64 image (a 24 MB bed exported at 61 MB).
const originals = new WeakMap<Mesh, Material[]>();
const basePose = new WeakMap<Mesh, { position: Vector3; quaternion: Quaternion; scale: Vector3 }>();
// Each mesh's geometry as loaded (its own copy): reset and re-projection start from it.
const originalGeometry = new WeakMap<Mesh, BufferGeometry>();
let maxAnisotropy = 8; // the renderer's maximum, read when the model loads

const DEFAULT_TILE = 0.3; // metres one pattern tile covers across

// How deep each surface's relief reads (normal map strength): open-pored solid woods most, pressed boards and
// printed or pressed decors barely; clear lacquer fills the pores of whatever it covers.
// A little flat light only: the room environment and the key light shade the model. More flattened every surface
// (wood grain and fabric weave read washed out).
const AMBIENT = 0.25;

const RELIEF: Record<string, number> = { oak: 0.7, ash: 0.7, walnut: 0.65, teak: 0.55, mahogany: 0.5, pine: 0.5, beech: 0.45, veneer: 0.5, plywood: 0.35, blockboard: 0.35, particleboard: 0.08, mdf: 0.08, hdf: 0.06, laminate: 0.12, melamine: 0.06 };
const LACQUER_FILL = 0.4;

/** The relief of what a wooden part shows: its opaque finish (veneer, melamine, laminate) or else its board. */
function relief(edit: MaterialEdit) {
  const finish = edit.material?.finish?.wood_type;
  const shown = finish && finish !== "lacquer" ? finish : edit.material?.wood_type;
  return (RELIEF[shown ?? ""] ?? 0.5) * (finish === "lacquer" ? LACQUER_FILL : 1);
}

/** The part's longest side (0 x, 1 y, 2 z) as placed: where a wooden part's grain runs. */
function longestAxis(geometry: BufferGeometry, scale: Vector3): 0 | 1 | 2 {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new Vector3()).multiply(scale);
  return size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
}

function groupRange(slot: Slot) {
  const geometry = slot.mesh.geometry;
  const total = geometry.index ? geometry.index.count : geometry.getAttribute("position").count;
  const group = Array.isArray(slot.mesh.material) ? geometry.groups.find((g) => (g.materialIndex ?? 0) === slot.materialIndex) : undefined;
  return group ? { start: group.start, count: group.count } : { start: 0, count: total };
}

const inspections = new WeakMap<BufferGeometry, Map<string, ReturnType<typeof inspectUv>>>();
function inspected(geometry: BufferGeometry, range: { start: number; count: number }, scale: Vector3) {
  const key = `${range.start}:${range.count}:${scale.toArray().map((x) => x.toFixed(4))}`;
  const byRange = inspections.get(geometry) ?? new Map<string, ReturnType<typeof inspectUv>>();
  inspections.set(geometry, byRange);
  const hit = byRange.get(key) ?? inspectUv(geometry, range, scale);
  byRange.set(key, hit);
  return hit;
}

/** Put a repeating pattern on one part. Its UVs are inspected first: an atlas (Meshy's: many seams), missing,
 * degenerate or unevenly stretched UVs would break the pattern into fragments, so the part gets box-projected UVs
 * baked into its own geometry (exported as they are). Valid UVs are kept and the tile size set from their density.
 * Tiles are `edit.tile` metres across, at the image's own aspect ratio. Returns the mapping, stored with the edit
 * so later changes (tile size, undo, reload) lay it out the same way. */
/** Edge UVs in the core texture's tiles. Plies and the blockboard's strips fill the thickness once; a cross-cut
 * shows the strips side by side (22 mm, four to a tile), and the long edge shows one strip. Chips repeat at 4 cm. */
function edgeUv(type: string, lengthAxis: 0 | 1 | 2) {
  return ({ along, through, normalAxis, thickness }: { along: number; through: number; normalAxis: 0 | 1 | 2; thickness: number }) => {
    const depth = Math.max(thickness, 1e-4);
    if (type === "plywood") return [along / 0.5, through / depth];
    if (type === "blockboard") return [along / (normalAxis === lengthAxis ? 0.088 : 2), through / depth];
    const tile = type === "particleboard" ? 0.04 : 0.6;
    return [along / tile, through / tile];
  };
}

export function layPattern(slot: Slot, texture: Texture, edit: MaterialEdit): Mapping {
  const mesh = slot.mesh;
  dropCore(mesh); // a new pattern lays the whole part out again, including a sheet's edge
  const mat = standard(slotMaterial(slot));
  const scale = mesh.getWorldScale(new Vector3());
  const range = groupRange(slot);
  const original = originalGeometry.get(mesh) ?? mesh.geometry;
  // Decided from the part's geometry every time (cached), not from the stored edit: a layout saved under an older,
  // looser rule is laid out again by the current one.
  const found = inspected(original, range, scale);
  // Wood is always projected from the part's own shape, its grain along the part's longest side (a leg's height, a
  // rail's length): a model's UVs (an atlas, or laid out for something else) say nothing about where grain runs.
  const wood = edit.material?.kind === "wood";
  const mapping: Mapping = wood ? "box" : found.mapping;
  const image = texture.image as { width?: number; height?: number } | undefined;
  const tileU = edit.tile ?? DEFAULT_TILE;
  const tileV = tileU * ((image?.height ?? 1) / (image?.width ?? 1) || 1);
  if (mapping === "box") {
    // One material on the mesh: project from the loaded geometry, so repeated changes do not pile up copies.
    const from = materials(mesh).length === 1 ? original : mesh.geometry;
    const previous = mesh.geometry;
    mesh.geometry = boxProject(from, range, scale, tileU, tileV, wood ? longestAxis(from, scale) : undefined);
    if (previous !== original) previous.dispose();
    texture.userData.base = [1, 1];
  } else {
    const density = found.density; // UV units per metre
    texture.userData.base = [1 / (density * tileU), 1 / (density * tileV)];
  }
  if (mat) {
    neutralise(mat);
    mat.map = texture;
    mat.metalness = 0;
    mat.normalMap = weave.get(texture) ?? null;
    if (wood) {
      // Wood: its pores and latewood in relief, roughness varying across the grain (the map is relative: the surface's
      // own roughness multiplies it, as glTF does). How deep the relief reads depends on the surface you see.
      mat.roughness = edit.roughness ?? 0.5;
      mat.roughnessMap = grain.get(texture) ?? null;
      const depth = relief(edit);
      mat.normalScale.set(depth, depth);
    } else {
      // Upholstery: matte, not metal, with the weave's fine relief. A saved roughness/metal edit still wins (paint).
      mat.roughness = 0.88;
      mat.normalScale.set(0.35, 0.35);
    }
    paint(mat, edit);
    // A sheet's cut edge wears the core. One part, so the face's edit rebuilds both; the GLB stores both materials.
    const core = boardCores.get(texture);
    const type = edit.material?.wood_type;
    if (wood && core && type && showCore(edit) && realMaterials(mesh).length === 1) {
      const split = splitSheetEdge(mesh.geometry, scale, edgeUv(type, longestAxis(mesh.geometry, scale)));
      if (split) {
        const edgeMat = mat.clone();
        edgeMat.name = CORE;
        edgeMat.map = core.color;
        edgeMat.normalMap = core.normal;
        edgeMat.roughnessMap = core.rough;
        edgeMat.roughness = type === "particleboard" ? 0.86 : 0.72;
        edgeMat.metalness = 0;
        edgeMat.color.set(0xffffff);
        const depth = type === "particleboard" ? 0.4 : type === "mdf" || type === "hdf" ? 0.08 : 0.3;
        edgeMat.normalScale.set(depth, depth);
        edgeMat.needsUpdate = true;
        mesh.material = [mat, edgeMat];
      }
    }
  }
  return mapping;
}

/** A replacement pattern shows its own pixels: nothing left on the material may tint it. The base colour is white
 * (it multiplies the map; edit.color is set to white with the pattern, and a later colour pick still tints on
 * purpose), no emissive glow (added on top: black turned reddish-brown), no vertex colours (multiplied), fully
 * opaque, and the old texture's other maps go too: they belong to the old texture's layout, not the new pattern. */
function neutralise(mat: MeshStandardMaterial) {
  mat.color.set(0xffffff);
  mat.emissive.set(0x000000);
  mat.emissiveIntensity = 0;
  mat.emissiveMap = null;
  mat.vertexColors = false;
  mat.opacity = 1;
  mat.transparent = false;
  mat.normalMap = null;
  mat.roughnessMap = null;
  mat.metalnessMap = null;
  mat.aoMap = null;
  mat.lightMap = null;
  mat.needsUpdate = true;
}

// The editor's old selection glow (emissive #c2410c) was exported into GLBs saved while a part was selected; it
// lifts every dark colour to reddish-brown. Cleared on load (generated models have no emissive), saved on next save.
const STALE_GLOW = new Color(0xc2410c);
function clearStaleGlow(mat: Material): boolean {
  const std = standard(mat);
  if (!std || std.emissive.getHex() === 0 || std.emissiveMap) return false;
  const e = std.emissive.clone().multiplyScalar(1 / Math.max(std.emissive.r, 1e-6));
  const g = STALE_GLOW.clone().multiplyScalar(1 / STALE_GLOW.r);
  if (Math.abs(e.g - g.g) > 0.02 || Math.abs(e.b - g.b) > 0.02) return false;
  std.emissive.set(0x000000);
  std.emissiveIntensity = 0;
  std.needsUpdate = true;
  return true;
}

export function prepare(root: Object3D, server?: PartDocument | null): { slots: Slot[]; cleaned: boolean } {
  const meshes: Mesh[] = [];
  root.traverse((node) => {
    if ((node as Mesh).isMesh) meshes.push(node as Mesh);
  });
  const slots: Slot[] = [];
  const used = new Set<string>();
  let n = 0;
  let cleaned = false;
  for (const mesh of meshes) {
    const list = materials(mesh).map((mat) => mat.clone()); // own copies: edits never reach another mesh
    for (const mat of list) cleaned = clearStaleGlow(mat) || cleaned;
    mesh.material = Array.isArray(mesh.material) ? list : list[0];
    originals.set(mesh, list.map((mat) => mat.clone()));
    delete mesh.userData.original; // files saved before the WeakMap carry it as extras: dropped on the next save
    mesh.geometry = mesh.geometry.clone(); // its own copy: projections never touch another mesh's geometry
    originalGeometry.set(mesh, mesh.geometry);
    if (!basePose.has(mesh)) basePose.set(mesh, { position: mesh.position.clone(), quaternion: mesh.quaternion.clone(), scale: mesh.scale.clone() });
    list.forEach((mat, materialIndex) => {
      if (mat.name === CORE) return; // the sheet's cut edge belongs to the face part
      const from = server?.components[n];
      let id = from?.id || mesh.name || `part_${n}`;
      while (used.has(id)) id = `${id}_${n}`;
      used.add(id);
      const name = from?.name || mesh.name || (meshes.length === 1 && list.length === 1 ? "Whole model" : `Part ${n + 1}`);
      slots.push({ id, name, naming: from?.naming, mesh, materialIndex });
      n += 1;
    });
  }
  return { slots, cleaned };
}

export function slotMaterial(slot: Slot): Material {
  return materials(slot.mesh)[slot.materialIndex];
}

export function restore(slot: Slot) {
  // A core added in this session comes off with the edit. A file that was saved with its edge keeps that edge.
  const loaded = originals.get(slot.mesh);
  if (slot.materialIndex === 0 && loaded && !loaded.some((mat) => mat.name === CORE)) dropCore(slot.mesh);
  const original = loaded?.[slot.materialIndex];
  const current = slotMaterial(slot);
  const from = original ? standard(original) : null;
  const to = standard(current);
  if (!from || !to) return;
  to.color.copy(from.color);
  to.roughness = from.roughness;
  to.metalness = from.metalness;
  to.map = from.map;
  to.normalMap = from.normalMap;
  to.emissive.copy(from.emissive);
  to.emissiveIntensity = from.emissiveIntensity;
  to.needsUpdate = true;
  const source = originalGeometry.get(slot.mesh);
  if (source && slot.mesh.geometry !== source) {
    slot.mesh.geometry.dispose();
    slot.mesh.geometry = source;
  }
}

export function slotHit(slots: Slot[], mesh: Mesh, materialIndex: number) {
  const hit = slots.find((item) => item.mesh === mesh && item.materialIndex === materialIndex);
  // The cut edge is not its own part: clicking it selects the face it belongs to.
  if (hit) return hit;
  if (materials(mesh)[materialIndex]?.name !== CORE) return null;
  return slots.find((item) => item.mesh === mesh && item.materialIndex === 0) ?? null;
}

/** Put saved colours and textures back on these parts. Each part is restored first, so a removed edit does not linger. */
export async function replayEdits(slots: Slot[], edits: Record<string, MaterialEdit> | undefined) {
  for (const slot of slots) restore(slot);
  if (!edits) return;
  await Promise.all(
    slots.map(async (slot) => {
      const edit = edits[slot.id];
      if (!edit) return;
      paint(slotMaterial(slot), edit);
      if (edit.mapUrl) layPattern(slot, await loadMap(edit.mapUrl, edit), edit);
    }),
  );
}

/** Scale, slide and turn individual meshes. One mesh with several materials is moved once. Reset starts from the pose captured in `prepare`. */
export function applyPoses(slots: Slot[], poses: Record<string, PartPose> | undefined) {
  const seen = new Set<Mesh>();
  for (const slot of slots) {
    if (seen.has(slot.mesh)) continue;
    seen.add(slot.mesh);
    const base = basePose.get(slot.mesh);
    if (!base) continue;
    const pose = poses?.[slot.id];
    slot.mesh.position.copy(base.position);
    slot.mesh.quaternion.copy(base.quaternion);
    slot.mesh.scale.copy(base.scale);
    if (!pose) continue;
    if (pose.position) slot.mesh.position.add(new Vector3(...pose.position));
    if (pose.rotation) {
      const extra = new Quaternion().setFromEuler(new Euler(...pose.rotation.map((deg) => (deg * Math.PI) / 180) as [number, number, number]));
      slot.mesh.quaternion.multiply(extra);
    }
    if (pose.scale) slot.mesh.scale.multiply(new Vector3(...pose.scale));
  }
}

/** After a part moves, put the model's lowest point back on y = 0 and return its world size. */
export function reseat(wrapper: Object3D): Dimensions {
  wrapper.updateMatrixWorld(true);
  let box = new Box3().setFromObject(wrapper, true);
  const fit = wrapper.getObjectByName("fit");
  if (fit && Math.abs(box.min.y) > 1e-4) {
    fit.position.y -= box.min.y;
    wrapper.updateMatrixWorld(true);
    box = new Box3().setFromObject(wrapper, true);
  }
  return measure(wrapper);
}

const SIZER = "design-size";

/** Frames the model again each time `signal` changes (the page's "reset view"). */
function FitOnSignal({ signal }: { signal?: number }) {
  const bounds = useBounds();
  useEffect(() => {
    if (signal) bounds.refresh().clip().fit();
  }, [signal, bounds]);
  return null;
}
// Parts that are never wood: bedding and soft furnishings (English and Arabic part names).
const SOFT = /mattress|pillow|cushion|blanket|duvet|quilt|throw|bedding|bedspread|sheet|upholster|fabric|curtain|rug|carpet|مرتبة|مخدة|وسادة|بطانية|لحاف|مفرش|قماش|ستارة|سجادة/i;
// Never wood either: woven, glass, metal and stone parts keep their own material (a cane back, a glass top, steel legs).
const NOT_WOOD = /cane|rattan|wicker|seagrass|weave|woven|glass|mirror|metal|steel|iron|chrome|brass|aluminium|aluminum|marble|stone|ceramic|leather|خيزران|قش|زجاج|مرآة|معدن|حديد|ستانلس|نحاس|رخام|حجر|جلد/i;

/** The real surface area (m²) of one part: its triangles (only its material's, on a multi-material mesh), placed
 * as in the model and stretched by the customer's size. */
function partArea(slot: Slot, factor: [number, number, number]): number {
  let root: Object3D = slot.mesh;
  while (root.parent && root.parent.name !== SIZER) root = root.parent;
  const geometry = slot.mesh.geometry;
  const position = geometry.getAttribute("position");
  if (!position) return 0;
  root.updateWorldMatrix(true, true);
  const toModel = new Matrix4().copy(root.matrixWorld).invert().multiply(slot.mesh.matrixWorld);
  const matrix = new Matrix4().makeScale(...factor).multiply(root.matrix).multiply(toModel);
  const coreIndex = materials(slot.mesh).findIndex((mat) => mat.name === CORE);
  const group = geometry.groups.length
    ? geometry.groups.filter((g) => {
        const id = g.materialIndex ?? 0;
        return id === slot.materialIndex || (slot.materialIndex === 0 && id === coreIndex);
      })
    : [{ start: 0, count: geometry.index?.count ?? position.count }];
  const index = geometry.index;
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  let area = 0;
  for (const { start, count } of group) {
    for (let i = start; i + 2 < start + count; i += 3) {
      const at = (k: number, v: Vector3) => v.fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(matrix);
      at(i, a);
      at(i + 1, b);
      at(i + 2, c);
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
  }
  return area;
}

export function partBox(slot: Slot): Dimensions {
  const size = new Box3().setFromObject(slot.mesh, true).getSize(new Vector3());
  return { width: size.x, height: size.y, depth: size.z };
}

/** A 1024 px render of the model on a transparent background: its own renderer, so the editor's grid, background
 * and selection glow are not in it. Materials and textures are the live ones (the state that is exported). */
async function renderThumbnail(object: Object3D, scale?: Vector3): Promise<Blob> {
  const size = 1024;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  const pmrem = new PMREMGenerator(renderer);
  try {
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping; // as the editor: base colours and textures keep their hue
    const scene = new Scene();
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.add(new AmbientLight(0xffffff, AMBIENT));
    const key = new DirectionalLight(0xffffff, 1.35);
    key.position.set(6, 8, 4);
    const fill = new DirectionalLight(0xffffff, 0.35);
    fill.position.set(-4, 2, -3);
    scene.add(key, fill);
    const model = object.clone(true); // shares geometry and materials: nothing is copied or changed
    if (scale) model.scale.multiply(scale); // the customer's size (the editor's size group)
    scene.add(model);
    model.updateMatrixWorld(true);
    const sphere = new Box3().setFromObject(model).getBoundingSphere(new Sphere());
    const camera = new PerspectiveCamera(35, 1, 0.01, 1000);
    const distance = (sphere.radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.08;
    camera.position.copy(sphere.center).addScaledVector(new Vector3(0.75, 0.45, 1).normalize(), distance);
    camera.lookAt(sphere.center);
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    environment.dispose();
    const blob = await new Promise<Blob | null>((resolve) => renderer.domElement.toBlob(resolve, "image/webp", 0.92));
    if (!blob) throw new Error("the browser could not encode the image");
    return blob;
  } finally {
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

const SELECT = "#f2a33a"; // Sha2ty orange
const GRID = "editor-grid";
const GUIDES_KEY = "sha2ty.showDimensions";
type Tab = "parts" | "properties" | "actions";

/** Blender-style selection: a screen-space silhouette with a soft glow around the selected mesh only (three's
 * OutlinePass). The scene renders as without it (same colours); the pass then draws only its overlay on top, so the
 * outline is never in the model, the exported GLB or the thumbnail, and no material is touched. Built once;
 * selecting only swaps `selectedObjects`, so there is no flicker. */
export function SelectionOutline({ mesh }: { mesh: Mesh | null }) {
  const { gl, scene, camera, size } = useThree();
  const pass = useRef<OutlinePass | null>(null);
  useEffect(() => {
    const outline = new OutlinePass(new Vector2(256, 256), scene, camera);
    // The overlay writes its colour straight to the screen (no sRGB conversion): stored as the sRGB values.
    outline.visibleEdgeColor.setStyle(SELECT, LinearSRGBColorSpace);
    outline.hiddenEdgeColor.set(0x000000); // behind other parts: transparent below, so hidden edges are not drawn
    outline.edgeStrength = 6;
    outline.edgeThickness = 1;
    outline.edgeGlow = 1.2;
    // Its overlay is additive, and orange added to a cream sofa or the light background is still white. Normal alpha
    // blending of the edge colour shows on light and dark parts alike.
    const overlay = outline.overlayMaterial;
    overlay.fragmentShader = overlay.fragmentShader.replace(
      "gl_FragColor = finalColor;",
      "float a = max(finalColor.r, max(finalColor.g, finalColor.b)); gl_FragColor = vec4(finalColor.rgb / max(a, 1e-4), min(a, 1.0));",
    );
    overlay.blending = NormalBlending;
    overlay.needsUpdate = true;
    // Blender-style: outline what is seen of the part. The pass outlines the whole projected silhouette and hides the
    // stretches behind other parts, so where generated parts overlap (a cushion under its neighbour) the seen
    // boundary had no outline. Occluded pixels of the part are masked out instead: the edge runs along the visible
    // region and hidden edges are never drawn. 1% (+5 mm) depth slack: parts flush with the frame still count as seen.
    const mask = outline.prepareMaskMaterial;
    mask.fragmentShader = mask.fragmentShader
      .replace("(-vPosition.z > viewZ)", "(-vPosition.z > viewZ * 1.01 + 0.005)")
      .replace("gl_FragColor = vec4(0.0, depthTest, 1.0, 1.0);", "gl_FragColor = depthTest > 0.5 ? vec4(1.0) : vec4(0.0, 0.0, 1.0, 1.0);");
    mask.needsUpdate = true;
    pass.current = outline;
    return () => {
      outline.dispose();
      pass.current = null;
    };
  }, [scene, camera]);
  useEffect(() => {
    const dpr = gl.getPixelRatio();
    pass.current?.setSize(size.width * dpr, size.height * dpr);
  }, [gl, scene, camera, size]);
  useEffect(() => {
    if (pass.current) pass.current.selectedObjects = mesh ? [mesh] : [];
  }, [scene, camera, mesh]);
  useFrame(() => {
    gl.render(scene, camera);
    const outline = pass.current;
    // readBuffer null: the overlay goes straight onto the frame just drawn.
    if (!outline?.selectedObjects.length) return;
    // drei's Grid is an upright plane its own shader lays flat; under the pass's depth material it stands up through
    // the model and hides every part behind it. It is not part of the furniture: left out of the outline passes.
    const grid = scene.getObjectByName(GRID);
    if (grid) grid.visible = false;
    outline.render(gl, null as never, null as never, 0, false);
    if (grid) grid.visible = true;
  }, 1);
  return null;
}

/** Khronos PBR Neutral tone mapping: base colours and textures keep their hue (ACES shifted hues, greyed whites). */
function ToneMapping() {
  const gl = useThree((state) => state.gl);
  useEffect(() => setNeutral(gl), [gl]);
  return null;
}

function setNeutral(gl: WebGLRenderer) {
  gl.toneMapping = NeutralToneMapping;
  gl.toneMappingExposure = 1;
}

/** Width / height / depth typed in, beside the drag handles (same numbers: typing and dragging stay in sync). */
function SizeInputs({ size, unit, proportional, onSize }: { size: Dimensions; unit: "m" | "cm"; proportional: boolean; onSize: (size: Dimensions) => void }) {
  const t = useT();
  const k = unit === "cm" ? 100 : 1;
  return (
    <div className="flex gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
      {(["width", "height", "depth"] as const).map((axis) => (
        <label key={axis} className="flex flex-col gap-0.5">
          <span className="px-0.5">{t(axis === "width" ? "Width" : axis === "height" ? "Height" : "Depth")}</span>
          <input
            type="number"
            min={MIN_SIZE * k}
            max={50 * k}
            step={unit === "cm" ? 1 : 0.01}
            value={Number((size[axis] * k).toFixed(unit === "cm" ? 1 : 3))}
            onChange={(e) => {
              const value = Number(e.target.value) / k;
              if (value > 0) onSize(resized(size, axis, value, proportional));
            }}
            className="w-[4.5rem] rounded-md border border-slate-200 bg-white px-1.5 py-1 text-sm font-normal normal-case tabular-nums tracking-normal text-slate-900 outline-none transition focus:border-brand-amber focus:ring-2 focus:ring-brand-amber/20"
          />
        </label>
      ))}
    </div>
  );
}

/** Per material, so one part of a multi-material mesh can be hidden on its own. */
function setVisibility(slots: Slot[], hidden: Set<string>) {
  for (const slot of slots) slotMaterial(slot).visible = !hidden.has(slot.id);
}

/** Removed parts: the whole mesh is switched off (the exporter and the thumbnail skip invisible objects). */
function setRemoved3d(slots: Slot[], removed: Set<string>) {
  for (const slot of slots) if (materials(slot.mesh).length === 1) slot.mesh.visible = !removed.has(slot.id);
}

/** Every part visible for an export or render; returns the function that puts the view back. */
function showAll(slots: Slot[]): () => void {
  const was = slots.map((slot) => slotMaterial(slot).visible);
  for (const slot of slots) slotMaterial(slot).visible = true;
  return () => slots.forEach((slot, i) => (slotMaterial(slot).visible = was[i]));
}

export function authored(root: Object3D): Object3D {
  // normalizeModel wraps: fit → orient → clone. Export the clone, not the catalogue scale.
  return root.children[0]?.children[0]?.children[0] ?? root;
}

function LoadedModel({
  url,
  dimensions,
  edit,
  server,
  saved,
  replay,
  onReport,
  onSlots,
  onPick,
  track,
}: {
  url: string;
  dimensions: CatalogSize | null;
  edit: boolean;
  server?: PartDocument | null;
  saved?: Record<string, MaterialEdit> | null;
  replay: boolean;
  onReport: (report: NormalizationReport) => void;
  onSlots: (slots: Slot[], root: Object3D, cleaned: boolean) => void;
  onPick: (id: string) => void;
  track: <T>(load: Promise<T>) => Promise<T>;
}) {
  const { scene } = useGLTF(url);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    maxAnisotropy = gl.capabilities.getMaxAnisotropy();
  }, [gl]);
  const w = dimensions?.width;
  const h = dimensions?.height;
  const d = dimensions?.depth;
  const slotsRef = useRef<Slot[]>([]);
  const { object, report } = useMemo(() => normalizeModel(scene, w && h ? { width: w, height: h, ...(d ? { depth: d } : {}) } : null, url), [scene, w, h, d, url]);
  useEffect(() => onReport(report), [onReport, report]);
  useEffect(() => {
    if (!edit) return;
    const { slots: next, cleaned } = prepare(object, server);
    slotsRef.current = next;
    if (replay && saved) {
      for (const slot of next) {
        const editOf = saved[slot.id];
        if (!editOf) continue;
        paint(slotMaterial(slot), editOf);
        if (editOf.mapUrl) void track(loadMap(editOf.mapUrl, editOf).then((texture) => layPattern(slot, texture, editOf)));
      }
    }
    onSlots(next, object, cleaned);
  }, [edit, object, onSlots, replay, saved, server, track]);
  return (
    <primitive
      object={object}
      onClick={(event: { stopPropagation: () => void; object: Object3D; face?: { materialIndex?: number } | null }) => {
        if (!edit) return;
        event.stopPropagation();
        const mesh = event.object as Mesh;
        if (!mesh.isMesh) return;
        const materialIndex = Array.isArray(mesh.material) ? event.face?.materialIndex ?? 0 : 0;
        const hit = slotHit(slotsRef.current, mesh, materialIndex);
        if (hit) onPick(hit.id);
      }}
    />
  );
}

export function ModelViewer({
  url,
  dimensions = null,
  edit = false,
  parts: server = null,
  edits: saved = null,
  replay = false,
  onApi,
  designSize = null,
  fill = false,
  details,
  overlay,
  resetView,
  autoRotate = false,
  stacked = false,
  partsFooter,
  woodVendor,
  woodModel,
  onDesignSize,
  proportional = true,
  actions,
  removedParts,
}: {
  url: string;
  dimensions?: CatalogSize | null;
  edit?: boolean;
  parts?: PartDocument | null;
  edits?: Record<string, MaterialEdit> | null;
  /** Apply saved edits on top of the file. Skip when the GLB was already exported with them. */
  replay?: boolean;
  onApi?: (api: PartEditorApi) => void;
  /** Stores an uploaded texture image and returns its public URL (saved edits must not point at browser-only
   * blob: URLs). Without it the image is used from memory for this session only. */
  /** The customer's overall size (m). The model is normalised once at `dimensions` (the catalogue size) and this
   * scales it on top, so resizing never re-loads it or loses edits; the exported GLB stays in the file's own units
   * and the size is saved beside it (no double scaling). With `onDesignSize`, drag handles and live dimension lines
   * resize it. */
  designSize?: Dimensions | null;
  onDesignSize?: (size: Dimensions) => void;
  /** Handles keep the proportions (true) or change one axis (false). */
  proportional?: boolean;
  /** Fill the parent's height on desktop (the parent sets it); each side panel then scrolls on its own. */
  fill?: boolean;
  /** Studio layout (desktop: details | canvas | parts and materials; tablets: drawers; phones: tabs). The page's form
   * for the left column. Use with `fill`. */
  details?: ReactNode;
  /** Floating controls drawn over the canvas (studio layout). */
  overlay?: ReactNode;
  /** Changing it frames the model again (reset view). */
  resetView?: number;
  autoRotate?: boolean;
  /** Canvas on top and a parts | materials drawer under it (for a narrow column beside a form). Use with `fill`. */
  stacked?: boolean;
  /** Shown under the parts list (the page's own card, e.g. having the model made). */
  partsFooter?: ReactNode;
  /** Offer only this vendor's woods (a vendor's own model); none: all of Sha2ty's woods. */
  woodVendor?: string | null;
  /** The catalogue model whose wood choice (models.woods) applies. */
  woodModel?: string | null;
  /** The page's own controls (save, request…), in the properties column (their own tab on small screens). */
  actions?: ReactNode;
  /** Parts removed from the model (saved with the design). With it, the parts list can remove and restore parts. */
  removedParts?: string[] | null;
}) {
  const t = useT();
  const [downloading, setDownloading] = useState(false);
  const [report, setReport] = useState<NormalizationReport | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Saved edits are the starting record: a save keeps them (not only this session's), reset and undo work on them.
  const [edits, setEdits] = useState<Record<string, MaterialEdit>>(() => saved ?? {});
  const [past, setPast] = useState(0);
  const [future, setFuture] = useState(0);
  // Dimension lines on the model: off unless the user turns them on (remembered in this browser).
  // Parts hidden in the view (a view choice: exports and thumbnails always have every part).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  // Parts removed from the model: their meshes are switched off, so neither the export nor the thumbnail has them.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set(removedParts ?? []));
  const removedRef = useRef(removed);
  const toggle = (id: string, shown: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (shown) next.delete(id);
      else next.add(id);
      return next;
    });
  const [tab, setTab] = useState<Tab>("parts");
  // Studio layout below 1024 px: which side panel is open (tablet drawer / phone tab). Phones open on Details;
  // tablets start with both drawers closed. (Client-only component: matchMedia is safe here.)
  const [studioPanel, setStudioPanel] = useState<"details" | "materials" | null>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches ? "details" : null,
  );
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [guides, setGuides] = useState(() => {
    try {
      return localStorage.getItem(GUIDES_KEY) === "1";
    } catch {
      return false;
    }
  });
  const showGuides = (on: boolean) => {
    setGuides(on);
    try {
      localStorage.setItem(GUIDES_KEY, on ? "1" : "0");
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  };
  const [guideUnit, setGuideUnit] = useState<"m" | "cm">("m");
  const root = useRef<Object3D | null>(null);
  const sizer = useRef<Group>(null);
  const history = useRef<Record<string, MaterialEdit>[]>([]);
  const ahead = useRef<Record<string, MaterialEdit>[]>([]);
  const dirty = useRef(false);
  const removable = (id: string) => {
    const item = slots.find((entry) => entry.id === id);
    return Boolean(item && materials(item.mesh).length === 1); // one part of a shared mesh cannot leave the file alone
  };
  const removePart = (id: string) => {
    dirty.current = true;
    setRemoved((current) => new Set(current).add(id));
    setSelected((current) => (current === id ? null : current));
  };
  const restoreParts = () => {
    dirty.current = true;
    setRemoved(new Set());
  };
  const loading = useRef(new Set<Promise<unknown>>());
  // Texture loads in flight: the thumbnail waits for them, so it shows the final materials.
  const track = useMemo(() => <T,>(load: Promise<T>) => {
    const settled = load.catch(() => undefined);
    loading.current.add(settled);
    void settled.finally(() => loading.current.delete(settled));
    return load;
  }, []);
  const editsRef = useRef(edits);
  useEffect(() => {
    editsRef.current = edits; // the latest edits for the export callbacks (refs are not written during render)
  }, [edits]);
  const hiddenRef = useRef(hidden);
  useEffect(() => {
    hiddenRef.current = hidden;
    setVisibility(slots, hidden);
  }, [hidden, slots]);
  useEffect(() => {
    removedRef.current = removed;
    setRemoved3d(slots, removed);
  }, [removed, slots]);
  const base = report?.finalSize;
  const size = designSize ?? base;
  // The size group: customer size ÷ the size the model was normalised to.
  const factor: [number, number, number] = designSize && base ? [designSize.width / base.width, designSize.height / base.height, designSize.depth / base.depth] : [1, 1, 1];
  const slot = slots.find((item) => item.id === selected) ?? null;
  // Walks every triangle of the part: only when the selection or the size changes, not on every render.
  const area = useMemo(() => (slot ? partArea(slot, factor) : null), [slot, factor[0], factor[1], factor[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  // The model's wood goes on its wooden parts: shown, not removed, not upholstered (a fabric chosen) and not soft
  // by name (mattress, pillows, bedding…).
  const woodParts = useMemo(
    () => slots.filter((item) => !removed.has(item.id) && !hidden.has(item.id) && !["fabric", "paint"].includes(edits[item.id]?.material?.kind ?? "") && !SOFT.test(item.name) && !NOT_WOOD.test(item.name)),
    [slots, removed, hidden, edits],
  );
  const woodEdit = woodParts.map((item) => edits[item.id]).find((e) => e?.material?.kind === "wood") ?? null;
  const woodArea = useMemo(() => woodParts.reduce((sum, item) => sum + partArea(item, factor), 0), [woodParts, factor[0], factor[1], factor[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSlots = useMemo(() => (next: Slot[], object: Object3D, cleaned: boolean) => {
    root.current = object;
    if (cleaned) dirty.current = true; // the next save writes the file without the stale glow
    setSlots(next);
    // Nothing is selected until the user picks a part (no outline or panel on load).
    setSelected((current) => (current && next.some((s) => s.id === current) ? current : null));
  }, []);

  const applyAll = (map: Record<string, MaterialEdit>) => {
    for (const item of slots) restore(item);
    for (const item of slots) {
      const editOf = map[item.id];
      if (!editOf) continue;
      paint(slotMaterial(item), editOf);
      if (editOf.mapUrl) void track(loadMap(editOf.mapUrl, editOf).then((texture) => layPattern(item, texture, editOf)));
    }
  };

  const change = (id: string, patch: MaterialEdit, texture?: Texture) => {
    history.current.push(editsRef.current);
    ahead.current = [];
    setPast(history.current.length);
    setFuture(0);
    dirty.current = true;
    const next = { ...editsRef.current, [id]: { ...editsRef.current[id], ...patch } };
    const item = slots.find((entry) => entry.id === id);
    if (item) {
      // A new pattern, or a new tile size for the current one: lay it out again (UVs or projection).
      const current = standard(slotMaterial(item))?.map;
      const pattern = texture ?? (patch.tile != null && next[id].mapUrl ? current : null);
      if (patch.material?.kind === "paint") dropCore(item.mesh); // paint covers the edge as well; a raw core is not a painted edge
      if (pattern) next[id] = { ...next[id], mapping: layPattern(item, pattern, next[id]) };
      else paint(slotMaterial(item), next[id]);
    }
    setEdits(next);
  };

  /** One wood for the whole model: every wooden part takes it, in one undo step. */
  const changeWood = (patch: MaterialEdit, textures: Map<string, Texture>) => {
    history.current.push(editsRef.current);
    ahead.current = [];
    setPast(history.current.length);
    setFuture(0);
    dirty.current = true;
    const next = { ...editsRef.current };
    for (const item of woodParts) {
      next[item.id] = { ...next[item.id], ...patch };
      const texture = textures.get(item.id);
      if (texture) next[item.id] = { ...next[item.id], mapping: layPattern(item, texture, next[item.id]) };
    }
    setEdits(next);
  };

  const rename = (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    dirty.current = true; // the exported GLB carries the names
    setSlots((current) => current.map((item) => (item.id === id ? { ...item, name: clean, naming: "vendor" } : item)));
  };

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    ahead.current.push(editsRef.current);
    setPast(history.current.length);
    setFuture(ahead.current.length);
    setEdits(prev);
    applyAll(prev);
  };
  const redo = () => {
    const next = ahead.current.pop();
    if (!next) return;
    history.current.push(editsRef.current);
    setPast(history.current.length);
    setFuture(ahead.current.length);
    setEdits(next);
    applyAll(next);
  };

  // The edited model as a GLB (every part, the edits baked in, in the file's own units): saved by the page, or downloaded.
  const exportGlb = () => new Promise<Blob | null>((resolve, reject) => {
    if (!root.current) return resolve(null);
    const restoreView = showAll(slots); // the file has every part, whatever is hidden on screen
    // Names go into the file: one mesh, one material → the mesh carries the part's name.
    for (const item of slots) if (materials(item.mesh).length === 1) item.mesh.name = item.name;
    // The exporter re-encodes every texture as full-size PNG: one phone photo used as a texture pushed a
    // 24 MB model past the 50 MB storage limit. Opaque textures go out as JPEG, all at most 2048 px.
    for (const item of slots) {
      for (const mat of materials(item.mesh).map((entry) => standard(entry))) {
        if (!mat || mat.transparent || mat.alphaTest > 0) continue;
        for (const map of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap]) if (map) map.userData.mimeType = "image/jpeg";
      }
    }
    new GLTFExporter().parse(
      authored(root.current),
      (bin) => {
        restoreView();
        resolve(new Blob([bin as ArrayBuffer], { type: "model/gltf-binary" }));
      },
      (error) => {
        restoreView();
        reject(error);
      },
      { binary: true, maxTextureSize: 2048 },
    );
  });

  useEffect(() => {
    if (!edit || !onApi) return;
    onApi({
      exportGlb,
      document: () => ({
        modelType: server?.modelType,
        separated: slots.length > 1,
        components: slots.map((item) => ({ id: item.id, name: item.name, editable: true, ...(item.naming ? { naming: item.naming } : {}) })),
        limits: slots.length > 1 ? null : WHOLE,
      }),
      // Material estimates at the size being saved (the customer may have resized since picking).
      edits: () => {
        const scale = sizer.current?.scale;
        const now: [number, number, number] = scale ? [scale.x, scale.y, scale.z] : [1, 1, 1];
        const areas = new Map(slots.map((item) => [item.id, partArea(item, now)]));
        // The model's wood is bought for all its wooden parts together (whole sheets, one waste allowance), then
        // shared out by each part's surface, so the parts add up to the model's estimate.
        const woodIds = Object.keys(editsRef.current).filter((id) => editsRef.current[id].material?.kind === "wood" && areas.has(id));
        const woodArea = woodIds.reduce((sum, id) => sum + areas.get(id)!, 0);
        const whole = woodIds.length ? quote(editsRef.current[woodIds[0]].material!, woodArea) : null;
        const share = (x: number | null | undefined, id: string) => (x == null ? x : Math.round((x * areas.get(id)!) / (woodArea || 1) * 1000) / 1000);
        return Object.fromEntries(Object.entries(editsRef.current).map(([id, value]) => {
          if (!value.material || !areas.has(id)) return [id, value];
          if (value.material.kind === "wood" && whole) {
            return [id, { ...value, material: { ...value.material, quantity: share(whole.quantity, id) ?? undefined, finish_quantity: share(whole.finish_quantity, id) ?? undefined, total: share(whole.total, id) } }];
          }
          return [id, { ...value, material: quote(value.material, areas.get(id)!) }];
        }));
      },
      dirty: () => dirty.current,
      visibleParts: () => slots.filter((item) => !hiddenRef.current.has(item.id) && !removedRef.current.has(item.id)).map((item) => item.id),
      removedParts: () => [...removedRef.current].filter((id) => slots.some((item) => item.id === id)),
      markClean: () => {
        dirty.current = false; // saved: the next save only re-exports after a new change
      },
      thumbnail: async () => {
        if (!root.current) return null;
        while (loading.current.size) await Promise.all(loading.current);
        // The model as shown (oriented, at the customer's size); handles, guides and outline are not part of it.
        const restoreView = showAll(slots);
        try {
          return await renderThumbnail(root.current, sizer.current?.scale);
        } finally {
          restoreView();
        }
      },
    });
    // exportGlb reads only `slots` and refs: rebuilt with them, so it is not a dependency of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, onApi, server?.modelType, slots]);


  const canvas = (
    // A soft studio backdrop (CSS gradient behind a transparent canvas): the model is the only thing that stands out.
    <div
      className={`relative w-full overflow-hidden ${details !== undefined ? "" : "rounded-2xl border border-slate-200/80"} bg-[radial-gradient(ellipse_at_50%_35%,#ffffff_0%,#f1f5f9_55%,#e2e8f0_100%)] ${
        edit ? (details !== undefined ? "h-full min-h-[280px] md:min-h-[420px]" : `h-[52vh] min-h-[320px] ${fill ? "lg:h-full lg:min-h-0" : "lg:h-[calc(100dvh-12.5rem)] lg:min-h-[520px]"}`) : "h-[min(70vh,640px)]"
      }`}
    >
      <Canvas
        camera={{ position: [2.4, 1.6, 3.2], fov: 45 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: edit }}
        dpr={[1, 2]}
        onPointerMissed={() => edit && setSelected(null)}
      >
        <ambientLight intensity={AMBIENT} />
        <directionalLight position={[6, 8, 4]} intensity={1.35} />
        <directionalLight position={[-4, 2, -3]} intensity={0.35} />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.25}>
            <group ref={sizer} name={SIZER} scale={factor}>
              <LoadedModel url={url} dimensions={dimensions} edit={edit} server={server} saved={saved} replay={replay} onReport={setReport} onSlots={onSlots} onPick={setSelected} track={track} />
            </group>
            <FitOnSignal signal={resetView} />
          </Bounds>
          {edit && guides && designSize && onDesignSize && base && (
            <ResizeGizmo target={sizer} size={designSize} proportional={proportional} guides={guides} unit={guideUnit} onSize={onDesignSize} onDrag={() => undefined} />
          )}
          <Environment preset="warehouse" />
        </Suspense>
        <ToneMapping />
        {/* Always mounted in the editor, not per selection: no flicker or colour shift on select. */}
        {edit && <SelectionOutline mesh={slot?.mesh ?? null} />}
        {/* No grid: a soft contact shadow grounds the model on the backdrop. */}
        <ContactShadows name={GRID} position={[0, 0.001, 0]} scale={12} blur={2.4} far={4} opacity={0.35} resolution={1024} />
        <OrbitControls makeDefault enableDamping autoRotate={autoRotate} autoRotateSpeed={1.2} />
      </Canvas>
      {edit && designSize && onDesignSize && (
        // Floating toolbar: typed sizes, the handles / dimensions switch and the unit.
        <div className="absolute inset-x-3 top-3 flex justify-center">
          <div className="flex max-w-full flex-wrap items-end gap-3 rounded-2xl border border-white/70 bg-white/80 px-3 py-2 shadow-lg shadow-slate-900/5 backdrop-blur-md">
            <SizeInputs size={designSize} unit={guideUnit} proportional={proportional} onSize={onDesignSize} />
            <span className="hidden h-8 w-px bg-slate-200 sm:block" aria-hidden />
            <label className="flex cursor-pointer items-center gap-2 self-center text-xs font-medium text-slate-600">
              <span className="relative inline-flex">
                <input type="checkbox" checked={guides} onChange={(e) => showGuides(e.target.checked)} className="peer sr-only" />
                <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-brand-amber peer-focus-visible:ring-2 peer-focus-visible:ring-brand-amber/40" />
                <span className="absolute start-0.5 top-0.5 size-4 rounded-full bg-white shadow transition peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" />
              </span>
              {t("Dimensions & handles")}
            </label>
            <div className="flex self-center rounded-lg bg-slate-100 p-0.5 text-xs font-medium" role="radiogroup" aria-label={t("Unit")}>
              {(["m", "cm"] as const).map((u) => (
                <button key={u} type="button" role="radio" aria-checked={guideUnit === u} onClick={() => setGuideUnit(u)} className={`rounded-md px-2 py-1 transition ${guideUnit === u ? "bg-white text-brand-navy shadow-sm" : "text-slate-500 hover:text-brand-navy"}`}>
                  {u}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className={`pointer-events-none absolute inset-x-3 flex flex-col items-center gap-1 text-[11px] ${overlay ? "top-12" : "bottom-3"}`}>
        {/* With the page's own overlay (studio) its size pill replaces this one. */}
        <p className={`${overlay ? "hidden" : ""} rounded-full border border-white/70 bg-white/85 px-3 py-1 font-medium tabular-nums text-slate-700 shadow-sm backdrop-blur`}>
          {size
            ? `${designSize ? t("Your size") : dimensions ? t("Scaled to the catalogue size") : t("No catalogue size yet: authored size")} · ${size.width.toFixed(2)} × ${size.height.toFixed(2)} × ${size.depth.toFixed(2)} m (W × H × D)`
            : t("Loading…")}
        </p>
        {report?.warnings.map((warning) => (
          <p key={warning} className="rounded-lg border border-amber-200 bg-amber-50/95 px-2.5 py-1 text-amber-800 shadow-sm">{warning}</p>
        ))}
      </div>
    </div>
  );

  if (!edit) return canvas;

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await exportGlb();
      if (!blob) return;
      // In the app's browser view a blob: link cannot be saved: the file goes to the app, which saves and shares it.
      const app = (window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } }).ReactNativeWebView;
      if (app) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        return app.postMessage(JSON.stringify({ type: "glb", name: "model.glb", data }));
      }
      const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "model.glb" });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } catch (error) {
      window.alert(t("Could not prepare the download: {error}", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setDownloading(false);
    }
  };

  const list: PartInfo[] = slots.filter((item) => !removed.has(item.id)).map((item) => ({ id: item.id, name: item.name, editable: true, naming: item.naming }));
  // The parts list takes the room left; download and the page's footer (e.g. "Have it made") stay under it.
  const partsPanel = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
    <PartList parts={list} selected={selected} limits={slots.length > 1 ? null : WHOLE} onSelect={(id) => { setSelected(id); setTab("properties"); }} onRename={rename} hidden={hidden} onToggle={slots.length > 1 ? toggle : undefined}
      {...(removedParts !== undefined && slots.length > 1 ? { onRemove: removePart, canRemove: removable, removedCount: removed.size, onRestore: restoreParts } : {})} />
    <button type="button" onClick={() => void download()} disabled={downloading} className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-brand-navy shadow-sm hover:bg-slate-50 disabled:opacity-60">
      <Download className="size-4" aria-hidden />
      {downloading ? t("Preparing the file…") : t("Download 3D model (.glb)")}
    </button>
    {partsFooter && <div className="shrink-0">{partsFooter}</div>}
    </div>
  );
  // Side panels: their own thin scrollbar, the height of the canvas.
  const panel = `lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:thin] ${fill ? "lg:h-full lg:min-h-0" : "lg:sticky lg:top-20 lg:max-h-[calc(100dvh-12.5rem)]"}`;
  const columns = `${leftOpen ? "260px" : "0px"}_minmax(0,1fr)_${rightOpen ? "320px" : "0px"}`;
  const controls = (
    <>
      <PartControls
        name={slot ? partLabel(t, slot.name) : null}
        edit={slot ? { color: `#${(standard(slotMaterial(slot))?.color.getHexString() ?? "cccccc")}`, roughness: standard(slotMaterial(slot))?.roughness, metalness: standard(slotMaterial(slot))?.metalness, ...edits[slot.id] } : null}
        mapping={slot ? edits[slot.id]?.mapping : undefined}
        area={area}
        canUndo={past > 0}
        canRedo={future > 0}
        onUndo={undo}
        onRedo={redo}
        onLibrary={(mapUrl, tile, picked) => {
          if (!slot) return;
          const next = { ...picked, mapUrl, color: "#ffffff", tile };
          void track(loadMap(mapUrl, next).then((texture) => change(slot.id, next, texture)));
        }}
        onPaint={(picked) => slot && change(slot.id, { ...picked, mapUrl: undefined, normalUrl: undefined, mapping: undefined, tile: undefined, repeat: undefined })}
        onRepeat={(repeat) => slot && change(slot.id, { repeat })}
        onTile={(tile) => slot && change(slot.id, { tile })}
        onRotation={(rotation) => slot && change(slot.id, { rotation })}
        onOffset={(offset) => slot && change(slot.id, { offset })}
        onReset={() => {
          if (!slot) return;
          history.current.push(editsRef.current);
          ahead.current = [];
          dirty.current = true;
          const next = { ...editsRef.current };
          delete next[slot.id];
          applyAll(next);
          setEdits(next);
          setPast(history.current.length);
          setFuture(0);
        }}
      />
      {woodParts.length > 0 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-3 text-sm shadow-sm">
          <MaterialPicker
            mode="wood"
            edit={woodEdit}
            area={woodArea}
            woodVendor={woodVendor}
            woodModel={woodModel}
            onPick={(picked) => {
              const next = { ...picked, color: "#ffffff" };
              // Each part its own texture (its tiling is its own); the image is loaded and prepared once.
              void track(
                Promise.all(woodParts.map((item) => loadMap(next.mapUrl!, next).then((texture) => [item.id, texture] as const))).then((pairs) => changeWood(next, new Map(pairs))),
              );
            }}
          />
        </div>
      )}
    </>
  );
  if (details !== undefined) {
    // Phones: the panels are part of the page, which scrolls; from tablets up each scrolls on its own.
    const side = "md:overflow-y-auto md:overscroll-contain [scrollbar-width:thin] bg-white p-4";
    const drawer = "md:max-lg:fixed md:max-lg:inset-y-0 md:max-lg:z-40 md:max-lg:w-[min(24rem,88vw)] md:max-lg:shadow-2xl";
    return (
      <div className="flex min-h-0 flex-1 flex-col max-md:overflow-y-auto max-md:overscroll-contain md:relative lg:grid lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)_minmax(17rem,20rem)] lg:grid-rows-[minmax(0,1fr)]">
        {/* Tablets: buttons that slide the side panels in; phones: tabs under the canvas. */}
        <div className="flex shrink-0 gap-1 border-b border-slate-200 bg-white p-1.5 max-md:order-2 lg:hidden" role="tablist">
          {([["details", "Details"], ["materials", "Parts & materials"]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={studioPanel === id} onClick={() => setStudioPanel((open) => (open === id && !window.matchMedia("(max-width: 767px)").matches ? null : id))} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${studioPanel === id ? "bg-brand-navy text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}>
              {t(label)}
            </button>
          ))}
        </div>
        {studioPanel && <button type="button" aria-label={t("Close")} onClick={() => setStudioPanel(null)} className="fixed inset-0 z-30 hidden bg-slate-900/30 md:max-lg:block" />}
        <aside className={`${side} space-y-4 max-md:order-3 lg:border-e lg:border-slate-200 ${drawer} md:max-lg:start-0 ${studioPanel === "details" ? "" : "max-lg:hidden"}`}>
          {details}
        </aside>
        <div className="relative max-md:sticky max-md:top-0 max-md:z-10 max-md:order-1 max-md:h-[45vh] max-md:shrink-0 md:flex-1 lg:min-h-0">
          {canvas}
          {overlay}
        </div>
        <aside className={`${side} space-y-3 max-md:order-4 lg:border-s lg:border-slate-200 ${drawer} md:max-lg:end-0 ${studioPanel === "materials" ? "" : "max-lg:hidden"}`}>
          {partsPanel}
          {controls}
          {actions}
        </aside>
      </div>
    );
  }
  if (stacked) {
    const scroll = "lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:thin]";
    return (
      // The canvas on top, filling the space; under it a drawer: parts | the selected part's materials (and the
      // model's wood). Each side of the drawer scrolls on its own.
      <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
        <div className="relative lg:min-h-0 lg:flex-1">{canvas}</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:h-[40%] lg:min-h-[260px] lg:shrink-0">
          <div className={`lg:min-h-0 ${scroll}`}>{partsPanel}</div>
          <div className={`space-y-3 lg:min-h-0 ${scroll}`}>
            {controls}
            {actions}
          </div>
        </div>
      </div>
    );
  }
  const TABS = [["parts", "Parts"], ["properties", "Properties"], ...(actions ? [["actions", "Save"]] : [])] as [Tab, string][];
  return (
    // Desktop: parts | canvas | properties (+ the page's actions), side panels collapsible. Below 1024 px: the canvas on
    // top (sticky on phones) and one panel at a time under it, chosen with tabs.
    <div
      className={`flex flex-col gap-3 lg:grid lg:gap-4 lg:[grid-template-columns:var(--cols)] ${fill ? "lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]" : "lg:items-start"}`}
      style={{ "--cols": columns.replace(/_/g, " ") } as CSSProperties}
    >
      {/* Full height: no scroll of its own, only the parts list inside scrolls. */}
      <div className={`hidden ${fill ? "lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden" : `lg:block ${panel}`} ${leftOpen ? "" : "lg:invisible lg:w-0"}`}>{leftOpen && partsPanel}</div>
      <div className={`relative max-lg:sticky max-lg:top-16 max-lg:z-10 ${fill ? "lg:h-full lg:min-h-0" : ""}`}>
        {canvas}
        <div className="absolute bottom-3 end-3 hidden gap-1.5 lg:flex">
          <button type="button" onClick={() => setLeftOpen((o) => !o)} title={leftOpen ? t("Hide parts") : t("Show parts")} className="rounded-lg border border-white/70 bg-white/85 p-1.5 text-slate-600 shadow-sm backdrop-blur transition hover:text-brand-navy">
            {leftOpen ? <PanelLeftClose className="size-4 rtl:-scale-x-100" aria-hidden /> : <PanelLeftOpen className="size-4 rtl:-scale-x-100" aria-hidden />}
          </button>
          <button type="button" onClick={() => setRightOpen((o) => !o)} title={rightOpen ? t("Hide properties") : t("Show properties")} className="rounded-lg border border-white/70 bg-white/85 p-1.5 text-slate-600 shadow-sm backdrop-blur transition hover:text-brand-navy">
            {rightOpen ? <PanelRightClose className="size-4 rtl:-scale-x-100" aria-hidden /> : <PanelRightOpen className="size-4 rtl:-scale-x-100" aria-hidden />}
          </button>
        </div>
      </div>
      <div className="flex gap-1 rounded-xl border border-slate-200/80 bg-white p-1 shadow-sm lg:hidden" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${tab === id ? "bg-brand-navy text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}>
            {t(label)}
          </button>
        ))}
      </div>
      <div className="lg:hidden">{tab === "parts" && partsPanel}</div>
      <div className={`space-y-3 lg:block ${panel} ${tab === "parts" ? "max-lg:hidden" : ""} ${rightOpen ? "" : "lg:invisible lg:w-0"}`}>
      <div className={`space-y-3 ${tab === "actions" ? "max-lg:hidden" : ""}`}>{controls}</div>
      {actions && <div className={tab === "properties" ? "max-lg:hidden" : ""}>{actions}</div>}
      </div>
    </div>
  );
}
