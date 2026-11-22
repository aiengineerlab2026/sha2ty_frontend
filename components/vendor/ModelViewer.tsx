"use client";

import { useT } from "@/lib/i18n";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, CircleHelp, DoorOpen, FileText, Lightbulb, Download, Eraser, Layers, Link2, Maximize, Minimize, Loader2, Palette, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Redo2, RotateCcw, RotateCw, Ruler, Focus, SlidersHorizontal, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bounds, ContactShadows, OrbitControls, useBounds, useGLTF } from "@react-three/drei";
import { assetUrl } from "@/lib/api";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { Box3, BufferGeometry, Color, DirectionalLight, Euler, Group, LinearSRGBColorSpace, Matrix4, Mesh, MeshStandardMaterial, NeutralToneMapping, NormalBlending, Object3D, PerspectiveCamera, PMREMGenerator, Quaternion, Raycaster, RepeatWrapping, Scene, Sphere, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer, type Material } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { FILL_POSITION, KEY_POSITION, STUDIO_LIGHT } from "@/lib/vendor/studioLight";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { alignLike, fitScale, measure, normalizeModel, type CatalogSize, type Dimensions, type NormalizationReport } from "@/lib/plan/modelNormalization";
import type { AddablePart, MaterialEdit, PartDocument, PartEditorApi, PartInfo, PartVariant } from "@/lib/vendor/parts";
import { fitInto, loadVariant } from "@/lib/vendor/partVariant";
import { sameShape, variantProblems } from "@/lib/vendor/variantCheck";
import { formatPrice } from "@/lib/plan/pricing";
import { guideWithOptions } from "@/lib/designs/api";
import { REGISTRY } from "@/lib/vendor/parts3d";
import { paintOf, quote, withBoard, withPaint } from "@/lib/designs/materials";
import { boxProject, fabricNormals, inspectUv, seamlessFabric, splitSheetEdge, type Mapping } from "@/lib/vendor/tiling";
import { PartControls, PartList, partLabel } from "./PartEditor";
import { MaterialPicker } from "./MaterialPicker";
import { PartVariants } from "./PartVariants";
import { PartSizes } from "./PartSizes";
import { ResizeGizmo } from "@/components/designs/ResizeGizmo";
import { AnimationPanel } from "./AnimationPanel";
import { AddComponentsPanel, PickerBridge, PlacementOverlay, ResizeHandles, useComponentEditor } from "./AddComponents";
import { choosePart, offsetAxis, specBox, type Side, type Surroundings } from "@/lib/vendor/parts3d";
import { blocksPartIcon, checkMovers, movedBox, openCavities, rebuildPanel, type Added } from "@/lib/vendor/reconstruct";
import { animationClips, animationOf, applyAnimations, attachmentsFrom, boxInModel, carried, enabledAnimations, handleOf, meshesOf, refine, shownOpen, step, targetFor, type AnimationConfig, type Openness } from "@/lib/vendor/animation";
import { MIN_SIZE, resized, sizeCm } from "@/lib/designs/resize";
import { restoreMaterial } from "@/lib/designs/materialRestore";
import { TurnIcon } from "./TurnIcon";
import { boardOnly, specClasses, woodBlocked } from "@/lib/designs/woodTargets";

export type Slot = { id: string; name: string; nameAr?: string | null; analysisId?: string; naming?: PartInfo["naming"]; variants?: PartVariant[]; mesh: Mesh; materialIndex: number };

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
  if (paintOf(edit.material)) return false; // painted: the edge is painted too
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
  // Painted (a painted-only part, or a board with its paint coat): a flat colour, no fabric or wood pattern under it.
  if (paintOf(edit.material)) {
    std.map = null;
    std.normalMap = null;
  }
  if (edit.color) std.color.set(edit.color);
  // The file's own coat (clearcoat on lacquered legs, sheen on fabric) stays only on what it suits: a wood or paint
  // picked by the customer shows as its swatch, a fabric keeps its soft sheen.
  const physical = std as MeshStandardMaterial & { clearcoat?: number; sheen?: number };
  if (edit.material?.kind === "wood" || edit.material?.kind === "paint") {
    if (physical.sheen != null) physical.sheen = 0;
    if (physical.clearcoat != null) physical.clearcoat = edit.material.finish?.wood_type === "lacquer" ? 0.3 : 0;
  }
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
// The part as it is in the file, before a variant took its place (what "Original" puts back).
const fileParts = new WeakMap<Mesh, { geometry: BufferGeometry; materials: Material[] }>();

/** A part's own mesh can take a variant (one material: a part sharing its mesh with others cannot change alone). */
export const takesVariants = (slot: Slot) => materials(slot.mesh).length === 1;

/** Put a variant in this part's place (fitted into the file part's box), or the file's part back (`null`). It becomes
 * the part's starting point: its material is what reset goes back to, and patterns lay out on its shape. Material
 * edits are put back by the caller. */
export async function setVariant(slot: Slot, variant: PartVariant | null) {
  const mesh = slot.mesh;
  if (!takesVariants(slot)) return;
  let file = fileParts.get(mesh);
  if (!file) {
    file = { geometry: originalGeometry.get(mesh) ?? mesh.geometry, materials: originals.get(mesh) ?? materials(mesh) };
    fileParts.set(mesh, file);
  }
  let geometry = file.geometry;
  let base = file.materials;
  if (variant) {
    const loaded = await loadVariant(variant.glb_url);
    file.geometry.computeBoundingBox();
    geometry = fitInto(loaded.geometry, file.geometry.boundingBox!);
    base = [loaded.material];
  }
  dropCore(mesh);
  // ponytail: replaced variant geometries are left to the garbage collector (a few per session), not disposed.
  originalGeometry.set(mesh, geometry);
  originals.set(mesh, base.map((mat) => mat.clone()));
  mesh.geometry = geometry;
  mesh.material = base[0].clone();
}

/** The other choices of this part (the original, "" here, and the other variants) that look exactly like
 * `variant` once in the part's place: picking it instead of them changes nothing on screen. */
export async function shapeTwins(slot: Slot, variant: PartVariant, others: PartVariant[]): Promise<string[]> {
  const file = fileParts.get(slot.mesh);
  if (!file) return [];
  file.geometry.computeBoundingBox();
  const box = file.geometry.boundingBox!;
  const mine = fitInto((await loadVariant(variant.glb_url)).geometry, box);
  const twins = sameShape(mine, file.geometry) ? [""] : [];
  for (const other of others) {
    if (other.id !== variant.id && sameShape(mine, fitInto((await loadVariant(other.glb_url)).geometry, box))) twins.push(other.name);
  }
  return twins;
}
/** Vendors: why a new variant file cannot be offered for this part (null: it can). It must open as one 3D part and
 * look different, once in the part's place, from the part itself and from every variant already offered. */
export async function variantFileProblem(slot: Slot, url: string, existing: PartVariant[], t: (s: string, v?: Record<string, string>) => string): Promise<string | null> {
  let loaded;
  try {
    loaded = await loadVariant(url);
  } catch (caught) {
    return t("This file cannot be offered: {error}", { error: caught instanceof Error ? caught.message : String(caught) });
  }
  const file = fileParts.get(slot.mesh) ?? { geometry: originalGeometry.get(slot.mesh) ?? slot.mesh.geometry };
  file.geometry.computeBoundingBox();
  const box = file.geometry.boundingBox!;
  const mine = fitInto(loaded.geometry, box);
  if (sameShape(mine, file.geometry)) return t("This file has the same shape as the part itself: customers would see no difference. Upload a different shape.");
  for (const other of existing) {
    try {
      if (sameShape(mine, fitInto((await loadVariant(other.glb_url)).geometry, box))) return t("This file has the same shape as “{name}”: customers would see no difference. Upload a different shape.", { name: other.name });
    } catch {
      // an older variant that no longer opens is reported by the publish check
    }
  }
  return null;
}
let maxAnisotropy = 8; // the renderer's maximum, read when the model loads

const DEFAULT_TILE = 0.3; // metres one pattern tile covers across

// How deep each surface's relief reads (normal map strength): open-pored solid woods most, pressed boards and
// printed or pressed decors barely; clear lacquer fills the pores of whatever it covers.
// A little flat light only: the room environment and the key light shade the model. More flattened every surface
// (wood grain and fabric weave read washed out).
/** The thumbnail's and the live views' light: one calibration (lib/vendor/studioLight). */
const THUMB_LIGHT = STUDIO_LIGHT;

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
  return ({ along, through, normalAxis, thickness }: { along: number; through: number; normalAxis: 0 | 1 | 2; thickness: number }): [number, number] => {
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
  // The saved part list is matched by mesh name when the file's meshes carry the parts' ids (the procedural wardrobe,
  // split models); by order only when none do, so one missing or extra mesh never shifts every name after it.
  const byId = new Map((server?.components ?? []).map((c) => [c.id, c]));
  const named = meshes.some((mesh) => byId.has(mesh.name));
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
      // The part id written into the file at export (glTF extras → userData) first: stable whatever the mesh order.
      const saved = (mesh.userData.partIds as string[] | undefined)?.[materialIndex] ?? (list.length === 1 ? (mesh.userData.partId as string | undefined) : undefined);
      const from: PartInfo | undefined = (saved ? byId.get(saved) ?? { id: saved, name: mesh.name, editable: true } : undefined) ?? (named ? (list.length === 1 ? byId.get(mesh.name) : undefined) : server?.components[n]);
      let id = from?.id || mesh.name || `part_${n}`;
      while (used.has(id)) id = `${id}_${n}`;
      used.add(id);
      const name = from?.name || mesh.name || (meshes.length === 1 && list.length === 1 ? "Whole model" : `Part ${n + 1}`);
      slots.push({ id, name, naming: from?.naming, ...(from?.nameAr ? { nameAr: from.nameAr } : {}), ...(from?.analysisId ? { analysisId: from.analysisId } : {}), ...(from?.variants?.length ? { variants: from.variants } : {}), mesh, materialIndex });
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
  restoreMaterial(to, from); // every loaded property, maps and transparency included
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

/** A part made here (an interior, a drawer box: lib/vendor/reconstruct.ts) set up like a loaded one (its rest pose,
 * its original material for resets) and listed with the parts. */
function adopt(slots: Slot[], part: Added) {
  const mesh = part.mesh;
  originals.set(mesh, materials(mesh).map((mat) => mat.clone()));
  originalGeometry.set(mesh, mesh.geometry);
  basePose.set(mesh, { position: mesh.position.clone(), quaternion: mesh.quaternion.clone(), scale: mesh.scale.clone() });
  slots.push({ id: part.id, name: part.name, nameAr: part.nameAr, naming: "estimated", mesh, materialIndex: 0 });
}

/** The movable parts of a loaded model (at rest), checked on its real meshes: found and hinged (refine), their
 * geometry and movement validated (checkMovers), and the body opened behind them where it is solid (openCavities;
 * the new parts join `slots`). Used by the viewer, the editor and the planner alike. */
export function movableParts(saved: AnimationConfig | null | undefined, slots: Slot[], root: Object3D, doc?: PartDocument | null): AnimationConfig | null {
  const model = authored(root);
  const checked = checkMovers(refine(saved, slots, model, attachmentsFrom(doc)), slots, model);
  if (!checked) return null;
  const added = openCavities(checked, slots, model);
  for (const part of added) {
    adopt(slots, part);
    if (part.follows) checked.animations.find((a) => a.id === part.follows)?.follow.push(part.id);
  }
  return added.length
    ? { ...checked, interior: { added: [...(checked.interior?.added ?? []), ...added.map((p) => p.id)], note: "The body was solid behind its doors: an estimated hollow interior was added there (the original file is unchanged). Edit or remove these parts." } }
    : checked;
}

/** Scale, slide and turn individual meshes. One mesh with several materials is moved once. Reset starts from the pose
 * captured in `prepare`. `assemblies` (part id → the parts attached to it: handles, trims, decorations…): a posed part
 * carries its attached parts along, each keeping its place on it and its own size (a handle is not stretched with
 * a resized door); a child's own pose is added on top. */
export function applyPoses(slots: Slot[], poses: Record<string, PartPose> | undefined, assemblies: Record<string, string[]> = {}) {
  const seen = new Set<Mesh>();
  const meshOf = new Map(slots.map((slot) => [slot.id, slot.mesh]));
  const rest = (mesh: Mesh) => {
    const base = basePose.get(mesh);
    if (!base) return false;
    mesh.position.copy(base.position);
    mesh.quaternion.copy(base.quaternion);
    mesh.scale.copy(base.scale);
    return true;
  };
  const own = (mesh: Mesh, pose: PartPose | undefined) => {
    if (!pose) return;
    if (pose.position) mesh.position.add(new Vector3(...pose.position));
    if (pose.rotation) mesh.quaternion.multiply(new Quaternion().setFromEuler(new Euler(...pose.rotation.map((deg) => (deg * Math.PI) / 180) as [number, number, number])));
    if (pose.scale) mesh.scale.multiply(new Vector3(...pose.scale));
  };
  for (const slot of slots) {
    if (seen.has(slot.mesh)) continue;
    seen.add(slot.mesh);
    if (rest(slot.mesh)) own(slot.mesh, poses?.[slot.id]);
  }
  for (const [parentId, children] of Object.entries(assemblies)) {
    const parent = meshOf.get(parentId);
    const base = parent && basePose.get(parent);
    if (!parent || !base || !poses?.[parentId]) continue;
    parent.parent?.updateMatrixWorld(true);
    const outer = parent.parent?.matrixWorld ?? new Matrix4();
    const now = { position: parent.position, quaternion: parent.quaternion, scale: parent.scale };
    for (const id of children) {
      const child = meshOf.get(id);
      const from = child && basePose.get(child);
      if (!child || !from || child === parent) continue;
      const to = carried(base, now, outer, from, child.parent?.matrixWorld ?? new Matrix4()); // its place on the part, its own size
      child.position.copy(to.position);
      child.quaternion.copy(to.quaternion);
      child.scale.copy(to.scale);
      own(child, poses?.[id]);
    }
  }
}

/** Part id → the parts attached to it (each animation's part and its `follow`): what moves as one assembly. */
export function assembliesOf(config: AnimationConfig | null | undefined): Record<string, string[]> {
  return Object.fromEntries((config?.animations ?? []).filter((a) => a.follow.length).map((a) => [a.component, a.follow]));
}

/** Plays the movable parts (lib/vendor/animation.ts): each frame while a part moves or stands open, the rest pose
 * (with the part poses) and then the animations on top. Idle when everything is closed. Independent of the camera. */
export function Animator({ slots, root, config, target, poses }: { slots: Slot[]; root: Object3D | null; config: AnimationConfig | null | undefined; target: Openness; poses?: Record<string, PartPose> }) {
  const now = useRef<Openness>({});
  useFrame((_, dt) => {
    if (!root || !slots.length || !config) return;
    const moving = step(now.current, target, config, Math.min(dt, 0.1));
    if (!moving && !Object.values(now.current).some((v) => v > 0)) return;
    applyPoses(slots, poses, assembliesOf(config));
    // Eased (slow out of rest, slow into place): a door swings like a door, no jolt at either end.
    const eased = Object.fromEntries(Object.entries(now.current).map(([id, t]) => [id, t * t * (3 - 2 * t)]));
    applyAnimations(slots, authored(root), config, eased);
  });
  return null;
}

/** One movable part's icon: the animation, the mesh it sits on (the handle, else the part itself) and what belongs to
 * the part (never counted as hiding its icon). */
export type PartIcon = { id: string; on: Mesh; handle: boolean; own: Set<Mesh> };

/** Every movable part's icon, with the explicit handle mesh → movable part association (handleOf: by geometry). */
export function partIcons(slots: Slot[], config: AnimationConfig | null | undefined, skip: Set<string>): { icons: PartIcon[]; handles: Map<string, string> } {
  const icons: PartIcon[] = [];
  const handles = new Map<string, string>(); // handle mesh uuid → movable part id
  for (const a of enabledAnimations(config)) {
    if (skip.has(a.component)) continue;
    const part = slots.find((s) => s.id === a.component)?.mesh;
    if (!part) continue;
    const handle = handleOf(part, slots.filter((s) => a.follow.includes(s.id)).map((s) => ({ id: s.id, mesh: s.mesh, name: `${s.name} ${s.nameAr ?? ""}` })));
    if (handle) handles.set(handle.mesh.uuid, a.component);
    const own = new Set(slots.filter((s) => s.id === a.component || a.follow.includes(s.id)).map((s) => s.mesh));
    icons.push({ id: a.id, on: handle?.mesh ?? part, handle: Boolean(handle), own });
  }
  return { icons, handles };
}

const ICON = 20; // px
/** Moves the icons (plain page elements above the canvas, `els`) to their handles every frame: each handle's world box
 * centre from its current world matrix, projected with the camera; icons closer than one icon apart pushed apart;
 * an icon behind other geometry or the camera hidden. No React render per frame. */
export function IconTracker({ icons, els }: { icons: PartIcon[]; els: { current: Map<string, HTMLButtonElement> } }) {
  const box = useMemo(() => new Box3(), []);
  const ray = useMemo(() => new Raycaster(), []);
  const frame = useRef(0);
  const hidden = useRef(new Map<string, boolean>());
  useFrame(({ camera, gl, scene }) => {
    const w = gl.domElement.clientWidth, h = gl.domElement.clientHeight;
    const at = icons.map((icon) => {
      box.setFromObject(icon.on);
      const world = box.getCenter(new Vector3());
      const p = world.clone().project(camera);
      return { icon, world, x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, behind: p.z > 1 };
    });
    // Apart: two icons closer than an icon's width move away from each other, half each (two passes).
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
        const dx = at[j].x - at[i].x, dy = at[j].y - at[i].y, d = Math.hypot(dx, dy);
        if (d >= ICON + 2) continue;
        const ux = d > 0.01 ? dx / d : 1, uy = d > 0.01 ? dy / d : 0, push = (ICON + 2 - d) / 2;
        at[i].x -= ux * push; at[i].y -= uy * push;
        at[j].x += ux * push; at[j].y += uy * push;
      }
    }
    // Hidden behind other geometry: rechecked every few frames (a ray to the handle; its own part does not count).
    if (frame.current++ % 4 === 0) {
      for (const a of at) {
        const to = a.world.clone().sub(camera.position);
        const distance = to.length();
        ray.set(camera.position, to.normalize());
        const hit = ray.intersectObject(scene, true).find((x) => blocksPartIcon(x.object as Mesh, a.icon.own));
        hidden.current.set(a.icon.id, Boolean(hit && hit.distance < distance - 0.01));
      }
    }
    for (const a of at) {
      const el = els.current.get(a.icon.id);
      if (!el) continue;
      const off = a.behind || hidden.current.get(a.icon.id);
      el.style.transform = `translate(${a.x - ICON / 2}px, ${a.y - ICON / 2}px)`;
      el.style.opacity = off ? "0" : a.icon.handle ? "1" : "0.75";
      el.style.pointerEvents = off ? "none" : "auto";
    }
  });
  return null;
}

const GLOW = new Color("#f2a33a");
/** A soft warm glow on a movable part under the pointer (and the parts on it), and the pointer cursor. */
export function glow(meshes: Mesh[], on: boolean, cursor = "pointer") {
  for (const mesh of meshes) {
    for (const mat of materials(mesh).map(standard)) {
      if (!mat) continue;
      if (on && mat.userData.glowFrom === undefined) {
        mat.userData.glowFrom = mat.emissive.getHex();
        mat.emissive.copy(GLOW).multiplyScalar(0.18);
      } else if (!on && mat.userData.glowFrom !== undefined) {
        mat.emissive.setHex(mat.userData.glowFrom);
        delete mat.userData.glowFrom;
      }
    }
  }
  if (typeof document !== "undefined") document.body.style.cursor = on ? cursor : "";
}

type PointerHit = { stopPropagation: () => void; object: Object3D; delta?: number; face?: { materialIndex?: number } | null };

/** The movable part (its animation) under the pointer: the part itself or a handle on it. */
export function movableHit(slots: Slot[], config: AnimationConfig | null | undefined, event: PointerHit) {
  const mesh = event.object as Mesh;
  if (!mesh.isMesh) return null;
  const id = slotHit(slots, mesh, Array.isArray(mesh.material) ? event.face?.materialIndex ?? 0 : 0)?.id;
  return id ? animationOf(config, id) : null;
}

/** A click (a tap) opens or closes the part hit, never after a drag of the view. True when it did. */
export function toggleHit(slots: Slot[], config: AnimationConfig | null | undefined, event: PointerHit, onToggle: (animationId: string) => void): boolean {
  if ((event.delta ?? 0) > DRAG) return false;
  const anim = movableHit(slots, config, event);
  if (!anim) return false;
  event.stopPropagation();
  onToggle(anim.id);
  return true;
}

/** Lights the movable part under the pointer (and the parts on it); `lit` keeps what is lit between moves. */
export function hoverHit(slots: Slot[], config: AnimationConfig | null | undefined, lit: { current: Mesh[] }, event: PointerHit | null, cursor = "pointer") {
  event?.stopPropagation(); // the nearest part only: not the body and back panel behind it
  const anim = event ? movableHit(slots, config, event) : null;
  const next = anim ? meshesOf(slots, anim) : [];
  if (next.length === lit.current.length && next.every((m, i) => m === lit.current[i])) return;
  glow(lit.current, false);
  lit.current = next;
  if (next.length) glow(next, true, cursor);
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
    // Calibrated so a front-facing matte colour renders as itself (#a9b99c sage → #aabb9c; #e8b7c0 → #e9b7c0). The
    // editor's lights on top of the full room environment turned pastels nearly white (sage → #d3e6c2) in every
    // catalogue picture. No ambient light: the environment already lights every side.
    scene.environmentIntensity = THUMB_LIGHT.environment;
    const key = new DirectionalLight(0xffffff, THUMB_LIGHT.key);
    key.position.set(...KEY_POSITION);
    const fill = new DirectionalLight(0xffffff, THUMB_LIGHT.fill);
    fill.position.set(...FILL_POSITION);
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
/** Pixels the pointer may move between press and release and still pick a part (more is a drag of the view). */
export const DRAG = 4;
const GRID = "editor-grid";
const GUIDES_KEY = "sha2ty.showDimensions";
const HANDS_KEY = "sha2ty.showHandIcons";
type Tab = "details" | "parts" | "properties" | "actions";
const TAB_ICON: Record<Tab, typeof Layers> = { details: FileText, parts: Layers, properties: Palette, actions: SlidersHorizontal };

/** Blender-style selection: a screen-space silhouette with a soft glow around the selected mesh only (three's
 * OutlinePass). The scene renders as without it (same colours); the pass then draws only its overlay on top, so the
 * outline is never in the model, the exported GLB or the thumbnail, and no material is touched. Built once;
 * selecting only swaps `selectedObjects`, so there is no flicker. */
export function SelectionOutline({ mesh, meshes }: { mesh?: Mesh | null; meshes?: Mesh[] }) {
  // Several selected parts are outlined together; the key keeps the effect from running for an equal list.
  const outlined = meshes ?? (mesh ? [mesh] : []);
  const key = outlined.map((m) => m.uuid).join(",");
  const { gl, scene, camera, size } = useThree();
  const pass = useRef<OutlinePass | null>(null);
  useEffect(() => {
    const outline = new OutlinePass(new Vector2(256, 256), scene, camera);
    // The overlay writes its colour straight to the screen (no sRGB conversion): stored as the sRGB values.
    outline.visibleEdgeColor.setStyle(SELECT, LinearSRGBColorSpace);
    // The whole part is outlined from every angle: edges behind other parts (a headboard behind its upholstery and
    // pillows) in a fainter orange (the overlay's alpha follows its brightness).
    outline.hiddenEdgeColor.setStyle(SELECT, LinearSRGBColorSpace).multiplyScalar(0.55);
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
    if (pass.current) pass.current.selectedObjects = outlined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names exactly the meshes in `outlined`
  }, [scene, camera, key]);
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
/** The neutral room environment (three's RoomEnvironment, untinted) at the studio strength. */
function NeutralRoom() {
  const get = useThree((state) => state.get);
  useEffect(() => {
    const { gl, scene } = get();
    const pmrem = new PMREMGenerator(gl);
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = texture;
    scene.environmentIntensity = STUDIO_LIGHT.environment;
    pmrem.dispose();
    return () => {
      if (scene.environment === texture) scene.environment = null;
      texture.dispose();
    };
  }, [get]);
  return null;
}

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
  frameUrl,
  dimensions,
  edit,
  server,
  saved,
  replay,
  onReport,
  onSlots,
  onPick,
  track,
  movable,
  liveSlots,
  choose,
}: {
  url: string;
  /** Another state's file (the closed wardrobe) whose fit this one takes: see alignLike. */
  frameUrl?: string;
  dimensions: CatalogSize | null;
  edit: boolean;
  server?: PartDocument | null;
  saved?: Record<string, MaterialEdit> | null;
  replay: boolean;
  onReport: (report: NormalizationReport) => void;
  onSlots: (slots: Slot[], root: Object3D, cleaned: boolean) => void;
  /** `add`: shift / ctrl / ⌘ held, adds the part to the selection (or takes it out). */
  onPick: (id: string, add?: boolean) => void;
  track: <T>(load: Promise<T>) => Promise<T>;
  /** Movable parts (refined): a click opens or closes one (in the editor a double click: a click selects). */
  movable?: AnimationConfig | null;
  /** The editor's parts as they are now (with parts added after loading): what clicks resolve to. */
  liveSlots?: () => Slot[];
  /** Which part a click selects among everything under the pointer (lib/vendor/parts3d.ts choosePart). */
  choose?: (hits: { object: Object3D; distance: number; face?: { materialIndex?: number } | null }[]) => string | null;
}) {
  const file = assetUrl(url);
  const frameFile = assetUrl(frameUrl ?? url);
  const { scene } = useGLTF(file);
  const { scene: frame } = useGLTF(frameFile); // the same file (already loaded) when there is no frame
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    maxAnisotropy = gl.capabilities.getMaxAnisotropy();
  }, [gl]);
  const w = dimensions?.width;
  const h = dimensions?.height;
  const d = dimensions?.depth;
  const slotsRef = useRef<Slot[]>([]);
  const { object, report } = useMemo(() => {
    const target = w && h ? { width: w, height: h, ...(d ? { depth: d } : {}) } : null;
    if (!frameUrl) return normalizeModel(scene, target, url);
    const reference = normalizeModel(frame, target, frameUrl);
    return { object: alignLike(scene, reference.object), report: reference.report };
  }, [scene, frame, frameUrl, w, h, d, url]);
  useEffect(() => onReport(report), [onReport, report]);
  // Viewing: the parts are needed only to find and play movable ones (a model of several parts).
  const animated = (server?.components?.length ?? 0) > 1 || enabledAnimations(server?.animation).length > 0;
  useEffect(() => {
    if (!edit && !animated) return;
    const { slots: next, cleaned } = prepare(object, server);
    slotsRef.current = next;
    if (edit && replay && saved) {
      for (const slot of next) {
        const editOf = saved[slot.id];
        if (!editOf) continue;
        paint(slotMaterial(slot), editOf);
        if (editOf.mapUrl) void track(loadMap(editOf.mapUrl, editOf).then((texture) => layPattern(slot, texture, editOf)));
      }
    }
    onSlots(next, object, cleaned);
  }, [edit, animated, object, onSlots, replay, saved, server, track]);
  const lit = useRef<Mesh[]>([]);
  const moves = enabledAnimations(movable).length > 0;
  return (
    <primitive
      object={object}
      onPointerMove={moves ? (event: PointerHit) => hoverHit(liveSlots?.() ?? slotsRef.current, movable, lit, event) : undefined}
      onPointerOut={moves ? () => hoverHit(liveSlots?.() ?? slotsRef.current, movable, lit, null) : undefined}
      onClick={(event: { stopPropagation: () => void; object: Object3D; delta: number; face?: { materialIndex?: number } | null; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
        if (event.delta > DRAG) return; // turning or panning the view is not a click
        if (!edit) return; // viewing: parts open and close from their icons
        event.stopPropagation();
        const mesh = event.object as Mesh;
        if (!mesh.isMesh) return;
        const materialIndex = Array.isArray(mesh.material) ? event.face?.materialIndex ?? 0 : 0;
        // Everything under the pointer, by priority (added parts, through open fronts); else the nearest part.
        const chosen = choose?.((event as unknown as { intersections?: { object: Object3D; distance: number; face?: { materialIndex?: number } | null }[] }).intersections ?? []);
        const hit = chosen ? { id: chosen } : slotHit(liveSlots?.() ?? slotsRef.current, mesh, materialIndex);
        if (hit) onPick(hit.id, Boolean(event.shiftKey || event.ctrlKey || event.metaKey)); // shift / ctrl / ⌘: add or remove
      }}
    />
  );
}

export function ModelViewer({
  url,
  frameUrl,
  dimensions = null,
  edit = false,
  parts: server = null,
  edits: saved = null,
  replay = false,
  onApi,
  designSize = null,
  fill = false,
  tall = false,
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
  onProportional,
  sizeNote,
  shopper = false,
  phoneAction,
  priceGuide,
  actions,
  actionsLabel = "Save",
  removedParts,
  removal,
  partVariants: savedVariants = null,
  onUploadVariant,
  onVariantChange,
  partSizes = null,
  pose = null,
}: {
  url: string;
  /** Show `url` as another state of `frameUrl`'s product (an open wardrobe): placed exactly like that file. */
  frameUrl?: string;
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
  /** With it, a "Lock proportions" switch beside the typed sizes. */
  onProportional?: (on: boolean) => void;
  /** What the size under the model is called, instead of the catalogue's (a request: "Requested size"). */
  sizeNote?: string;
  /** A customer customising a listing: no vendor set-up (movable parts, file download, renaming), sizes in cm, the
   * look (fabric, wood, styles) before adding parts. */
  shopper?: boolean;
  /** Customers: the per-piece range from earlier bids on this model (undefined while loading); shown with the
   * chosen variants' and added parts' price differences on top, or "Price determined by vendor bids". */
  priceGuide?: import("@/lib/designs/api").PriceGuide | null;
  /** Phones (`fill`): the page's main action (Save, Request bids) at the bottom of the screen, within thumb reach. */
  phoneAction?: ReactNode;
  /** Fill the parent's height on desktop (the parent sets it); each side panel then scrolls on its own. */
  fill?: boolean;
  /** Viewing as a page's centrepiece (the request page): a taller canvas. */
  tall?: boolean;
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
  /** The phone tab that shows `actions` (it holds more than Save on some pages). */
  actionsLabel?: string;
  /** Parts removed from the model (saved with the design). With it, the parts list can remove and restore parts. */
  removedParts?: string[] | null;
  /** yours: a customer's removal stays on their design. everyone: a vendor or admin removal is saved into the shared model. */
  removal?: "yours" | "everyone";
  /** The customer's saved variant per part (part id → variant id), put in place on load. */
  partVariants?: Record<string, string> | null;
  /** Vendors and admins: stores a part variant's GLB and returns its URL. With it, variants are added and removed
   * (saved in the part list); without it, a part's variants are offered to choose from. */
  onUploadVariant?: (file: File) => Promise<string>;
  /** A part variant was picked (part id → variant id, every choice). */
  onVariantChange?: (choices: Record<string, string>) => void;
  /** Each part measured (the parts in mesh order, by id): `show` puts their sizes on the model, `onSizes` gets the
   * table (soft furnishings like pillows and the mattress are left out). */
  partSizes?: {
    names: { id: string; name: string; skip?: boolean }[];
    show: boolean;
    onSizes?: (rows: ({ key: string; name: string } & import("@/lib/vendor/partSizes").PartSize)[]) => void;
    /** The part lit up on the model (a key from `onSizes`), and who lights one (a label click). */
    lit?: string | null;
    onLit?: (key: string | null) => void;
  } | null;
  /** Open or close every movable part. Unset: each part stays as the file shows it, including a door modelled open. */
  pose?: "open" | "closed" | null;
}) {
  const t = useT();
  const [downloading, setDownloading] = useState(false);
  const [report, setReport] = useState<NormalizationReport | null>(null);
  // Which file the report is for: until the current one has loaded, the canvas shows a spinner.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const onLoaded = useCallback((next: NormalizationReport | null) => {
    setReport(next);
    if (next) setLoadedUrl(url);
  }, [url]);
  const [slots, setSlots] = useState<Slot[]>([]);
  // Movable parts: the saved (or detected) configuration, edited here, and how far each is asked to be open.
  const [anim, setAnim] = useState<AnimationConfig | null>(() => server?.animation ?? null);
  // The part types the vendor lets customers add to this model (PartDocument.addable).
  const [addable, setAddable] = useState<AddablePart[]>(() => server?.addable ?? []);
  const [openTarget, setOpenTarget] = useState<Openness>({});
  const [modelRoot, setModelRoot] = useState<Object3D | null>(null); // root.current, for rendering
  const serverRef = useRef(server);
  useEffect(() => {
    serverRef.current = server;
  }, [server]);
  // Adding parts (shelves, drawers, doors…): the gallery, drag-and-drop placement and the selected part's toolbar.
  const partsEditor = useComponentEditor({
    slots,
    setSlots,
    root: modelRoot ? authored(modelRoot) : null,
    anim,
    setAnim,
    saved: server?.added,
    objectType: server?.analysis?.objectType ?? server?.modelType,
    onBuilt: (mesh, id) => {
      if (!originals.has(mesh)) originals.set(mesh, materials(mesh).map((mat) => mat.clone())); // reset goes to its first look
      originalGeometry.set(mesh, mesh.geometry);
      basePose.set(mesh, { position: mesh.position.clone(), quaternion: mesh.quaternion.clone(), scale: mesh.scale.clone() });
      // Rebuilt at a new size: its wood / fabric is laid out again for the new size (not stretched).
      const look = editsRef.current[id];
      if (look) paint(materials(mesh)[0], look); // its saved paint (a part rebuilt on reopening)
      if (look?.mapUrl) void loadMap(look.mapUrl, look).then((texture) => layPattern({ id, name: id, mesh, materialIndex: 0 }, texture, look));
    },
  });
  const [dimFocus, setDimFocus] = useState<0 | 1 | 2 | Side | null>(null);

  const modelMeshes = useCallback(() => [...new Set(slots.map((s) => s.mesh))], [slots]);
  // What clicks resolve against: the parts now (added ones included), which are added, which stand open.
  const live = useRef<{ slots: Slot[]; added: Set<string>; open: Set<string> }>({ slots: [], added: new Set(), open: new Set() });
  useEffect(() => {
    live.current = {
      slots,
      added: new Set(partsEditor.added.map((a) => a.id)),
      open: new Set((anim?.animations ?? []).filter((a) => shownOpen(a, openTarget[a.id] ?? 0)).flatMap((a) => [a.component, ...a.follow])),
    };
  }, [slots, partsEditor.added, anim, openTarget]);
  const liveSlots = () => live.current.slots;
  const choosePick = (hits: { object: Object3D; distance: number; face?: { materialIndex?: number } | null }[]) => {
    const { slots: now, added, open } = live.current;
    const parts = hits.flatMap((h) => {
      const mesh = h.object as Mesh;
      if (!mesh.isMesh) return [];
      const slot = slotHit(now, mesh, Array.isArray(mesh.material) ? h.face?.materialIndex ?? 0 : 0);
      return slot ? [{ id: slot.id, distance: h.distance, added: added.has(slot.id), open: open.has(slot.id), visible: mesh.visible }] : []; // helpers and overlays are no parts
    });
    return choosePart(parts, 0.003);
  };
  // Placement measures the STRUCTURE: every door / drawer (and what moves with it) is left out, open or closed.
  const movingIds = useMemo(() => new Set((anim?.animations ?? []).flatMap((a) => [a.component, ...a.follow])), [anim]);
  const structureMeshes = useCallback(() => [...new Set(slots.filter((s) => !movingIds.has(s.id)).map((s) => s.mesh))], [slots, movingIds]);
  const surroundings = useCallback((): Surroundings => {
    if (!modelRoot) return { front: () => null, sweeps: [] };
    const model = authored(modelRoot);
    model.updateMatrixWorld(true);
    const inv = model.matrixWorld.clone().invert();
    /** A part's box where it rests (closed), in model coordinates, whatever it shows now. */
    const rest = (mesh: Mesh) => {
      const base = basePose.get(mesh);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const local = base ? new Matrix4().compose(base.position, base.quaternion, base.scale) : mesh.matrix;
      return mesh.geometry.boundingBox!.clone().applyMatrix4(inv.clone().multiply(mesh.parent?.matrixWorld ?? new Matrix4()).multiply(local));
    };
    const meshOf = (id: string) => slots.find((s) => s.id === id)?.mesh;
    const fronts = (anim?.animations ?? []).map((a) => ({ id: a.component, box: meshOf(a.component) ? rest(meshOf(a.component)!) : null })).filter((f): f is { id: string; box: Box3 } => Boolean(f.box));
    const structure = structureMeshes().map((m) => new Box3().setFromObject(m, true).applyMatrix4(inv));
    const span = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    return {
      front: (x0, x1, y0, y1, from) => {
        const area = Math.max((x1 - x0) * (y1 - y0), 1e-9);
        const over = (b: Box3) => (span(b.min.x, b.max.x, x0, x1) * span(b.min.y, b.max.y, y0, y1)) / area;
        const door = fronts.filter((f) => over(f.box) > 0.3 && f.box.min.z >= from).sort((a, b) => a.box.min.z - b.box.min.z)[0];
        if (door) return { z: door.box.min.z, part: door.id };
        const shell = structure.filter((b) => over(b) > 0.3 && b.max.z > from);
        return shell.length ? { z: Math.max(...shell.map((b) => b.max.z)), part: null } : null;
      },
      sweeps: enabledAnimations(anim).flatMap((a) => {
        const meshes = [a.component, ...a.follow].map(meshOf).filter((m): m is Mesh => Boolean(m));
        if (!meshes.length) return [];
        const box = meshes.map(rest).reduce((all, b) => all.union(b), new Box3());
        return [{ label: a.label, component: a.component, boxes: [0, 0.25, 0.5, 0.75, 1].map((t) => movedBox(a.type === "rotation" ? { ...a, to: (a.to ?? 0) * t } : { ...a, distance: (a.distance ?? 0) * t }, box)) }];
      }),
    };
  }, [modelRoot, slots, anim, structureMeshes]);
  /** World now → world at rest for a part that may stand open (a handle dropped on an open door goes where the door
   * is closed; its opening then carries it, once). */
  const restOfMesh = useCallback((mesh: Mesh) => {
    const base = basePose.get(mesh);
    if (!base) return null;
    mesh.updateMatrixWorld(true);
    const rest = (mesh.parent?.matrixWorld.clone() ?? new Matrix4()).multiply(new Matrix4().compose(base.position, base.quaternion, base.scale));
    return rest.multiply(mesh.matrixWorld.clone().invert());
  }, []);
  const idOfMesh = useCallback((mesh: Mesh) => slots.find((s) => s.mesh === mesh)?.id ?? null, [slots]);
  const toggleOpen = useCallback((id: string) => setOpenTarget((now) => {
    const a = anim?.animations.find((item) => item.id === id);
    const open = a ? shownOpen(a, now[id] ?? 0) : (now[id] ?? 0) > 0;
    return { ...now, [id]: a ? targetFor(a, !open) : open ? 0 : 1 };
  }), [anim]);
  // The catalogue's Open / Closed choice. A door the file already shows open stays there until this is set.
  useEffect(() => {
    if (!pose || !anim) return;
    setOpenTarget(Object.fromEntries(enabledAnimations(anim).map((a) => [a.id, targetFor(a, pose === "open")])));
  }, [pose, anim]);
  // Each movable part's hand icon, on its handle (or the part when it has none), always shown; the page elements are
  // placed by IconTracker every frame.
  const iconEls = useRef(new Map<string, HTMLButtonElement>());
  // What was detected, checked against the real meshes (refine): the starting point and what Reset goes back to.
  const [detected, setDetected] = useState<AnimationConfig | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // More parts selected with it (shift / ctrl / ⌘ click, or "Select several" on touch screens): edits go to all of them.
  const [also, setAlso] = useState<Set<string>>(() => new Set());
  const [several, setSeveral] = useState(false);
  /** Select a part: on its own, or (`add`, or "Select several" on) added to / taken out of the selection. */
  const pick = (id: string | null, add = false) => {
    if (!id) {
      setSelected(null);
      setAlso(new Set());
      return;
    }
    if (!add && !several) {
      setSelected(id);
      setAlso(new Set());
      return;
    }
    if (id === selected) {
      const [first, ...rest] = [...also];
      setSelected(first ?? null);
      setAlso(new Set(rest));
    } else if (also.has(id)) {
      const next = new Set(also);
      next.delete(id);
      setAlso(next);
    } else if (!selected) setSelected(id);
    else setAlso(new Set(also).add(id));
  };
  // Saved edits are the starting record: a save keeps them (not only this session's), reset and undo work on them.
  const [edits, setEdits] = useState<Record<string, MaterialEdit>>(() => saved ?? {});
  const [past, setPast] = useState(0);
  const [future, setFuture] = useState(0);
  // Dimension lines on the model: off unless the user turns them on (remembered in this browser).
  // Parts hidden in the view (a view choice: exports and thumbnails always have every part).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  // Parts removed from the model: their meshes are switched off, so neither the export nor the thumbnail has them.
  const [removed, setRemoved] = useState<Set<string>>(() => new Set(removedParts ?? []));
  const icons = useMemo(() => partIcons(slots, anim, new Set([...removed, ...hidden])).icons, [slots, anim, removed, hidden]);
  const removedRef = useRef(removed);
  // The variant chosen per part, and the one each mesh shows now (so a re-render never swaps it again).
  const [choices, setChoices] = useState<Record<string, string>>(() => savedVariants ?? {});
  const choicesRef = useRef(choices);
  const shownVariant = useRef(new WeakMap<Mesh, string>());
  const [variantBusy, setVariantBusy] = useState<string | null>(null);
  const [variantError, setVariantError] = useState<string | null>(null);
  const [shapeTick, setShapeTick] = useState(0); // a part's shape changed: its area is measured again
  const toggle = (id: string, shown: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (shown) next.delete(id);
      else next.add(id);
      return next;
    });
  const [tab, setTab] = useState<Tab>("parts");
  // Phones (`fill`): the canvas fills the screen and the panels sit in a bottom sheet: peek (tabs only), half or full.
  const [sheet, setSheet] = useState<"peek" | "half" | "full">("peek");
  const orbit = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [turned, setTurned] = useState(false); // the rotate hint goes after the first drag or turn
  // Customers: a short note after each change ("Applied to Seat"), and the first-visit walkthrough.
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const say = (message: string) => {
    setFlash(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2400);
  };
  // Customers: the steps behind the help icon (closed until asked for), and one short tip when it helps.
  const [guideOpen, setGuideOpen] = useState(false);
  const [tipHidden, setTipHidden] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0); // the camera frames the whole model again when it changes
  const viewer = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === viewer.current && viewer.current !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void viewer.current?.requestFullscreen?.().catch(() => undefined);
  };
  /** One step closer (`in`) or further, as the mouse wheel does (OrbitControls' own dolly, within its limits). */
  const zoom = (closer: boolean) => {
    const controls = orbit.current as (ComponentRef<typeof OrbitControls> & { dollyIn?: (s: number) => void; dollyOut?: (s: number) => void }) | null;
    if (!controls) return;
    if (closer) controls.dollyOut?.(1.25);
    else controls.dollyIn?.(1.25);
    controls.update();
  };
  const [panelOpen, setPanelOpen] = useState(true);
  const turn = (dir: 1 | -1) => {
    const controls = orbit.current;
    if (!controls) return;
    controls.setAzimuthalAngle(controls.getAzimuthalAngle() + (dir * Math.PI) / 4);
    controls.update();
    setTurned(true);
  };
  const sheetDrag = useRef<number | null>(null);
  const openTab = (next: Tab) => {
    setTab(next);
    setSheet((s) => (s === "peek" ? "half" : s));
  };
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
  // The hand icons on the movable parts: shown unless turned off (remembered in this browser).
  const [hands, setHands] = useState(() => {
    try {
      return localStorage.getItem(HANDS_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const showHands = (on: boolean) => {
    setHands(on);
    try {
      localStorage.setItem(HANDS_KEY, on ? "1" : "0");
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  };
  const [guideUnit, setGuideUnit] = useState<"m" | "cm">(shopper ? "cm" : "m");
  // Phones: a tall, narrow canvas, so the size lines beside the model need more room to stay on screen.
  const [narrowCanvas] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches);
  const root = useRef<Object3D | null>(null);
  const sizer = useRef<Group>(null);
  const history = useRef<Record<string, MaterialEdit>[]>([]);
  const ahead = useRef<Record<string, MaterialEdit>[]>([]);
  const dirty = useRef(false);
  const cleanParts = useRef(0); // the added-parts version at the last save
  const removable = (id: string) => {
    const item = slots.find((entry) => entry.id === id);
    return Boolean(item && materials(item.mesh).length === 1); // one part of a shared mesh cannot leave the file alone
  };
  const removePart = (id: string) => {
    dirty.current = true;
    setRemoved((current) => new Set(current).add(id));
    setSelected((current) => (current === id ? null : current));
    setAlso((current) => (current.has(id) ? new Set([...current].filter((x) => x !== id)) : current));
  };
  const restoreParts = () => {
    dirty.current = true;
    setRemoved(new Set());
  };
  // Delete / Backspace on the selected part(s): asks first (the same question as the parts list's remove button), then
  // removes them from the model. Not while typing in a field, and only where parts can be removed at all.
  const canDelete = edit && removedParts !== undefined && slots.length > 1;
  useEffect(() => {
    if (!canDelete) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== "Delete" && event.key !== "Backspace") || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const ids = [...new Set([selected, ...also])].filter((id): id is string => Boolean(id) && !removed.has(id!));
      if (!ids.length) return;
      event.preventDefault();
      const ok = ids.filter(removable);
      if (!ok.length) {
        window.alert(t("This part shares one mesh with others in the file, so it cannot be removed alone. Hide it instead."));
        return;
      }
      const slot = slots.find((item) => item.id === ok[0]);
      const name = slot ? partLabel(t, slot.name, slot.nameAr) : ok[0];
      const question = ok.length === 1
        ? t(removal === "everyone" ? "Remove “{name}” from this model for everyone? After you save, every customer sees it gone. You can restore it before saving." : removal === "yours" ? "Remove “{name}” from your design only? Other people still see it on the original model. You can restore it." : "Remove “{name}” from this model? It is left out of the saved model and requests. You can restore it.", { name })
        : t(removal === "everyone" ? "Remove {n} parts from this model for everyone? After you save, every customer sees them gone. You can restore them before saving." : removal === "yours" ? "Remove {n} parts from your design only? Other people still see them on the original model. You can restore them." : "Remove {n} parts from this model? They are left out of the saved model and requests. You can restore them.", { n: ok.length });
      const skipped = ids.length - ok.length;
      if (!window.confirm(skipped ? `${question}\n${t("{n} selected parts share a mesh with others and stay.", { n: skipped })}` : question)) return;
      ok.forEach(removePart);
      say(ok.length === 1 ? t("Removed {name}", { name }) : t("Removed {n} parts", { n: ok.length }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
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
  // The model shown at exactly the size on screen (the customer's, else the catalogue's): one dimension source for
  // the product page, the editor and the request (lib/plan/modelNormalization fitScale).
  const factor = base ? fitScale(designSize ?? dimensions, base, !proportional) : ([1, 1, 1] as [number, number, number]);
  const factorKey = factor.map((v) => v.toFixed(3)).join(",");
  const firstFactor = useRef(factorKey);
  useEffect(() => {
    if (!shopper || factorKey === firstFactor.current) return;
    const timer = window.setTimeout(() => setFitKey((k) => k + 1), 600);
    return () => window.clearTimeout(timer);
  }, [factorKey, shopper]);
  // The size lines need room around the model: frame it again when they are turned on or off.
  const firstGuides = useRef(guides);
  useEffect(() => {
    if (shopper && guides !== firstGuides.current) setFitKey((k) => k + 1);
  }, [guides, shopper]);
  // Metres per model unit (the model at its real size, with the customer's size on top): sizes shown in m / cm.
  const realScale = useMemo(() => {
    if (!modelRoot) return null;
    const model = authored(modelRoot);
    model.updateMatrixWorld(true);
    return new Vector3().setFromMatrixScale(model.matrixWorld).multiply(new Vector3(...factor));
  }, [modelRoot, factor[0], factor[1], factor[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const size = base ? { width: base.width * factor[0], height: base.height * factor[1], depth: base.depth * factor[2] } : null;
  const slot = slots.find((item) => item.id === selected) ?? null;
  // Every selected part, the first-picked one first (its settings are the ones shown).
  const selection = useMemo(() => (slot ? [slot, ...slots.filter((item) => item.id !== slot.id && also.has(item.id))] : []), [slot, slots, also]);
  // Walks every triangle of the parts: only when the selection or the size changes, not on every render.
  const area = useMemo(() => (selection.length ? selection.reduce((sum, item) => sum + partArea(item, factor), 0) : null), [selection, factor[0], factor[1], factor[2], shapeTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // The model's wood goes on its wooden parts: shown, not removed, not upholstered (a fabric chosen) and not soft
  // by name (mattress, pillows, bedding…).
  // Upholstered in the file too: a part whose own material has a fabric sheen (glTF KHR_materials_sheen) is never
  // turned into wood, even before the customer picks its fabric.
  // A part painted or coloured (by the vendor, the customer or its own file), or made of glass, mirror, metal, fabric
  // or stone (its file's material or the photo reading's material spec), keeps that finish: wood is never laid over it.
  const woodBlock = (item: Slot) => {
    const loaded = (originals.get(item.mesh)?.[item.materialIndex] ?? slotMaterial(item)) as Material & { metalness?: number; transmission?: number; sheen?: number };
    const look = { name: loaded.name, materialClass: (loaded.userData?.materialClass as string | undefined) ?? null, metalness: loaded.metalness, opacity: loaded.opacity, transparent: loaded.transparent, transmission: loaded.transmission, sheen: loaded.sheen };
    return woodBlocked(look, edits[item.id], specClasses(server, item.analysisId, slots.length === 1));
  };
  const woodCandidates = slots.filter((item) => !removed.has(item.id) && !hidden.has(item.id) && !SOFT.test(item.name) && !NOT_WOOD.test(item.name));
  const woodParts = useMemo(
    () => woodCandidates.filter((item) => !woodBlock(item)),
    [slots, removed, hidden, edits, server], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Painted or coloured parts are made of the wood too: their board changes, their paint stays (materials.withBoard).
  const boardParts = useMemo(
    () => woodCandidates.filter((item) => boardOnly(woodBlock(item))),
    [slots, removed, hidden, edits, server], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Parts that could have been wood but keep their paint or material: said, not silently skipped.
  const woodKept = woodCandidates.length - woodParts.length;
  const woodEdit = [...woodParts, ...boardParts].map((item) => edits[item.id]).find((e) => e?.material?.kind === "wood") ?? null;
  const woodArea = useMemo(() => [...woodParts, ...boardParts].reduce((sum, item) => sum + partArea(item, factor), 0), [woodParts, boardParts, factor[0], factor[1], factor[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSlots = useMemo(() => (next: Slot[], object: Object3D, cleaned: boolean) => {
    root.current = object;
    setModelRoot(object);
    // At rest: every door and drawer found and checked on the real meshes (pivots, hinges, handles moving along).
    applyPoses(next, undefined);
    const found = movableParts(serverRef.current?.animation, next, object, serverRef.current); // may add interiors to `next`
    setDetected(found);
    setAnim(found);
    setOpenTarget(found?.state ?? {}); // as the user left it
    if (cleaned) dirty.current = true; // the next save writes the file without the stale glow
    setSlots(next);
    // Nothing is selected until the user picks a part (no outline or panel on load).
    setSelected((current) => (current && next.some((s) => s.id === current) ? current : null));
    setAlso(new Set());
  }, []);

  // A part the customer adds (a leg, a shelf…) is made of the model's wood once one is picked: what is shown is
  // what is requested (an added part with no material read "as in the catalogue model").
  useEffect(() => {
    const wood = Object.values(edits).find((e) => e.material?.kind === "wood");
    if (!wood) return;
    const missing = partsEditor.added.filter((a) => !edits[a.id] && !SOFT.test(a.type));
    if (!missing.length) return;
    const next = { ...edits };
    for (const a of missing) {
      next[a.id] = { ...wood };
      const item = slots.find((x) => x.id === a.id);
      if (!item) continue;
      paint(slotMaterial(item), next[a.id]);
      if (wood.mapUrl) void track(loadMap(wood.mapUrl, wood).then((texture) => layPattern(item, texture, next[a.id])));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an added part takes the wood picked before it
    setEdits(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsEditor.added, slots]);

  const applyAll = (map: Record<string, MaterialEdit>) => {
    for (const item of slots) restore(item);
    for (const item of slots) {
      const editOf = map[item.id];
      if (!editOf) continue;
      paint(slotMaterial(item), editOf);
      if (editOf.mapUrl) void track(loadMap(editOf.mapUrl, editOf).then((texture) => layPattern(item, texture, editOf)));
    }
  };

  /** The part's saved colour and pattern on its (new) shape. */
  const reapply = (item: Slot) => {
    const editOf = editsRef.current[item.id];
    if (!editOf) return;
    paint(slotMaterial(item), editOf);
    if (editOf.mapUrl) void track(loadMap(editOf.mapUrl, editOf).then((texture) => layPattern(item, texture, editOf)));
  };
  const showVariant = (item: Slot, variant: PartVariant | null) =>
    track(setVariant(item, variant)).then(() => {
      shownVariant.current.set(item.mesh, variant?.id ?? "");
      reapply(item);
      setShapeTick((n) => n + 1);
    });
  // Saved choices go in place once the parts are loaded (and again if the parts list is rebuilt).
  useEffect(() => {
    for (const item of slots) {
      const variant = item.variants?.find((v) => v.id === choicesRef.current[item.id]) ?? null;
      if ((shownVariant.current.get(item.mesh) ?? "") === (variant?.id ?? "")) continue;
      void showVariant(item, variant).catch((error: Error) => setVariantError(error.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);
  /** The customer picks a variant for the selected part (`null`: the original). Not an undo step. */
  const chooseVariant = (item: Slot, variant: PartVariant | null) => {
    setVariantBusy(variant?.id ?? "");
    setVariantError(null);
    showVariant(item, variant).then(
      () => {
        // Never a silent choice: a variant whose 3D file looks like another choice of this part is kept (it names
        // what the customer wants) but said, so the customer knows the model on screen does not show the difference.
        if (variant) {
          void shapeTwins(item, variant, item.variants ?? []).then((twins) => {
            if (twins.length) setVariantError(t("“{style}” has the same 3D shape as {others}, so the model looks the same. Your choice is saved and named in your request; the vendor confirms the shape.", { style: t(variant.name), others: twins.map((name) => (name ? `“${t(name)}”` : t("the original part"))).join(t(" and ")) }));
          });
        }
        dirty.current = true; // the saved GLB carries the new shape
        const next = { ...choicesRef.current };
        if (variant) next[item.id] = variant.id;
        else delete next[item.id];
        choicesRef.current = next;
        setChoices(next);
        setVariantBusy(null);
        onVariantChange?.(next);
      },
      (error: Error) => {
        setVariantError(t("Could not load this variant: {error}", { error: error.message }));
        setVariantBusy(null);
      },
    );
  };
  /** Vendors: the part's variant list changed (saved with the model's part list). */
  const setPartVariants = (id: string, variants: PartVariant[]) =>
    setSlots((current) => current.map((item) => (item.id === id ? { ...item, variants } : item)));

  /** A change to every selected part, in one undo step (`textures`: each part's own copy of a new pattern). */
  const changeSelected = (patch: MaterialEdit, textures?: Map<string, Texture>) => {
    if (!selection.length) return;
    history.current.push(editsRef.current);
    ahead.current = [];
    setPast(history.current.length);
    setFuture(0);
    dirty.current = true;
    const next = { ...editsRef.current };
    say(selection.length > 1 ? t("Applied to {n} parts", { n: selection.length }) : t("Applied to {part}", { part: partLabel(t, selection[0].name, selection[0].nameAr) }));
    const coat = patch.material?.kind === "paint" ? paintOf(patch.material) : null;
    for (const item of selection) {
      if (coat) {
        // A paint goes OVER the part's board (kept for making and pricing), and nothing of a pattern stays under it.
        const { mapUrl: _m, normalUrl: _n, mapping: _p, tile: _t, repeat: _r, rotation: _o, offset: _f, ...rest } = next[item.id] ?? {}; // eslint-disable-line @typescript-eslint/no-unused-vars
        next[item.id] = { ...rest, ...patch, material: withPaint(next[item.id]?.material, coat) };
      } else next[item.id] = { ...next[item.id], ...patch };
      const current = standard(slotMaterial(item))?.map;
      const pattern = textures?.get(item.id) ?? (patch.tile != null && next[item.id].mapUrl ? current : null);
      if (coat) dropCore(item.mesh);
      if (pattern) next[item.id] = { ...next[item.id], mapping: layPattern(item, pattern, next[item.id]) };
      else paint(slotMaterial(item), next[item.id]);
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
    say(t("Wood changed on the whole piece"));
    for (const item of woodParts) {
      next[item.id] = { ...next[item.id], ...patch };
      const texture = textures.get(item.id);
      if (texture) next[item.id] = { ...next[item.id], mapping: layPattern(item, texture, next[item.id]) };
    }
    // Painted parts: a new board under the same paint. The look (colour, no grain) is exactly what it was.
    for (const item of boardParts) if (patch.material) next[item.id] = { ...next[item.id], material: withBoard(next[item.id]?.material, patch.material) };
    setEdits(next);
  };

  const rename = (id: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    dirty.current = true; // the exported GLB carries the names
    setSlots((current) => current.map((item) => (item.id === id ? { ...item, name: clean, nameAr: null, naming: "vendor" } : item)));
  };

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    ahead.current.push(editsRef.current);
    setPast(history.current.length);
    setFuture(ahead.current.length);
    setEdits(prev);
    applyAll(prev);
    say(t("Undone"));
  };
  const redo = () => {
    const next = ahead.current.pop();
    if (!next) return;
    history.current.push(editsRef.current);
    setPast(history.current.length);
    setFuture(ahead.current.length);
    setEdits(next);
    applyAll(next);
    say(t("Redone"));
  };
  /** Every colour and material back to the original model's, in one undo step. */
  const resetLooks = () => {
    if (!Object.keys(editsRef.current).length) return;
    history.current.push(editsRef.current);
    ahead.current = [];
    setPast(history.current.length);
    setFuture(0);
    dirty.current = true;
    setEdits({});
    applyAll({});
    say(t("Original colours and materials back. Undo brings your changes back."));
  };

  // The edited model as a GLB (every part, the edits baked in, in the file's own units): saved by the page, or downloaded.
  const exportGlb = () => new Promise<Blob | null>((resolve, reject) => {
    if (!root.current) return resolve(null);
    const restoreView = showAll(slots); // the file has every part, whatever is hidden on screen
    // Saved at rest (closed), with the movable parts as glTF animation clips; the next frame opens them again.
    applyPoses(slots, undefined);
    const clips = animationClips(slots, authored(root.current), anim);
    // Names go into the file: one mesh, one material → the mesh carries the part's name.
    for (const item of slots) if (materials(item.mesh).length === 1) item.mesh.name = item.name;
    // Each mesh carries its part id(s) in the file (glTF extras): reopening finds every part, added ones included, by
    // id, never by position in the file.
    for (const item of slots) {
      if (materials(item.mesh).length === 1) item.mesh.userData.partId = item.id;
      else (item.mesh.userData.partIds ??= [])[item.materialIndex] = item.id;
    }
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
      { binary: true, maxTextureSize: 2048, animations: clips },
    );
  });

  useEffect(() => {
    if (!edit || !onApi) return;
    onApi({
      exportGlb,
      document: () => ({
        modelType: server?.modelType,
        separated: slots.filter((item) => !removedRef.current.has(item.id)).length > 1,
        components: slots.filter((item) => !removedRef.current.has(item.id)).map((item) => ({ id: item.id, name: item.name, editable: true, ...(item.naming ? { naming: item.naming } : {}), ...(item.nameAr ? { nameAr: item.nameAr } : {}), ...(item.analysisId ? { analysisId: item.analysisId } : {}), ...(item.variants?.length ? { variants: item.variants } : {}) })),
        limits: slots.length > 1 ? null : WHOLE,
        ...(anim ? { animation: { ...anim, state: Object.fromEntries(Object.entries(openTarget).filter(([, v]) => v > 0)) } } : {}),
        ...(partsEditor.added.length ? { added: partsEditor.added } : {}),
        ...(addable.length ? { addable } : {}),
        // The photo's vision analysis stays with the model (later editing and regeneration).
        ...(server?.analysis ? { analysis: server.analysis, modularity: server.modularity, conditioning: server.conditioning } : {}),
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
        const board = woodIds.length ? { ...editsRef.current[woodIds[0]].material! } : null;
        if (board) delete board.paint; // the board is bought for all wooden parts together; each part's paint is its own
        const whole = board ? quote(board, woodArea) : null;
        const share = (x: number | null | undefined, id: string) => (x == null ? x : Math.round((x * areas.get(id)!) / (woodArea || 1) * 1000) / 1000);
        return Object.fromEntries(Object.entries(editsRef.current).filter(([id]) => !removedRef.current.has(id)).map(([id, value]) => {
          if (!value.material || !areas.has(id)) return [id, value];
          if (value.material.kind === "wood" && whole) {
            const coat = value.material.paint ? quote({ ...value.material.paint, kind: "paint" }, areas.get(id)!) : null;
            const boardTotal = share(whole.total, id);
            const total = coat ? (boardTotal == null || coat.total == null ? null : Math.round((boardTotal + coat.total) * 100) / 100) : boardTotal;
            return [id, { ...value, material: { ...value.material, quantity: share(whole.quantity, id) ?? undefined, finish_quantity: share(whole.finish_quantity, id) ?? undefined, total,
              ...(coat && value.material.paint ? { paint: { ...value.material.paint, coats: coat.coats, quantity: coat.quantity, total: coat.total ?? null } } : {}) } }];
          }
          return [id, { ...value, material: quote(value.material, areas.get(id)!) }];
        }));
      },
      // Parts added or changed since the last save: a new file (not "ever", or a saved design would stay unsaved).
      dirty: () => dirty.current || partsEditor.version !== cleanParts.current,
      partVariants: () => Object.fromEntries(Object.entries(choicesRef.current).filter(([id, variant]) => slots.some((item) => item.id === id && item.variants?.some((v) => v.id === variant)))),
      visibleParts: () => slots.filter((item) => !hiddenRef.current.has(item.id) && !removedRef.current.has(item.id)).map((item) => item.id),
      removedParts: () => [...removedRef.current].filter((id) => slots.some((item) => item.id === id)),
      markClean: () => {
        dirty.current = false; // saved: the next save only re-exports after a new change
        cleanParts.current = partsEditor.version;
      },
      checkVariants: async () => {
        const out = variantProblems(slots.map((item) => ({ id: item.id, name: item.name, variants: item.variants }))).map((p) =>
          p.problem === "no-file" ? t("{part} · {variant}: no 3D file.", { part: p.part, variant: p.variant })
          : p.problem === "same-file" ? t("{part} · {variant}: the same 3D file as “{other}”.", { part: p.part, variant: p.variant, other: p.other ?? "" })
          : t("{part}: two variants are named “{variant}”.", { part: p.part, variant: p.variant }));
        for (const item of slots) {
          const vs = item.variants ?? [];
          for (let i = 0; i < vs.length; i++) {
            const problem = await variantFileProblem(item, vs[i].glb_url, vs.slice(0, i), t);
            if (problem) out.push(`${item.name} · ${vs[i].name}: ${problem}`);
          }
        }
        return [...new Set(out)];
      },
      thumbnail: async () => {
        if (!root.current) return null;
        while (loading.current.size) await Promise.all(loading.current);
        // The model as shown (oriented, at the customer's size); handles, guides and outline are not part of it.
        const restoreView = showAll(slots);
        applyPoses(slots, undefined); // the product's picture is closed; the player opens it again on the next frame
        try {
          return await renderThumbnail(root.current, sizer.current?.scale);
        } finally {
          restoreView();
        }
      },
    });
    // exportGlb reads only `slots` and refs: rebuilt with them, so it is not a dependency of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, onApi, server?.modelType, slots, anim, partsEditor.added, partsEditor.version, openTarget]); // the saved document follows every change


  const canvas = (
    // A soft studio backdrop (CSS gradient behind a transparent canvas): the model is the only thing that stands out.
    <div
      ref={viewer}
      {...(edit ? partsEditor.surface : {})}
      className={`relative w-full overflow-hidden ${details !== undefined || (shopper && fill) ? "" : "rounded-2xl border border-slate-200/80"} bg-[radial-gradient(ellipse_at_50%_35%,#ffffff_0%,#f1f5f9_55%,#e2e8f0_100%)] ${
        edit ? (details !== undefined ? "h-full min-h-[280px] md:min-h-[420px]" : fill ? "h-full min-h-0 max-lg:rounded-none max-lg:border-0" : "h-[52vh] min-h-[320px] lg:h-[calc(100dvh-12.5rem)] lg:min-h-[520px]") : tall ? "h-[min(78vh,780px)] min-h-[480px]" : "h-[min(70vh,640px)]"
      }`}
    >
      <Canvas
        camera={{ position: [2.4, 1.6, 3.2], fov: 45 }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: edit }}
        dpr={[1, 2]}
        onPointerMissed={() => edit && pick(null)}
      >
        {/* The thumbnail's light (lib/vendor/studioLight): what the shopper sees is what is saved and sent. */}
        <directionalLight position={KEY_POSITION} intensity={STUDIO_LIGHT.key} />
        <directionalLight position={FILL_POSITION} intensity={STUDIO_LIGHT.fill} />
        <Suspense fallback={null}>
          {/* Room for the floating size bar above the model while editing. */}
          <Bounds fit clip observe margin={shopper && fill ? (guides ? (narrowCanvas ? 1.8 : 1.6) : narrowCanvas ? 1.4 : 1.3) : edit && designSize ? (narrowCanvas ? 1.75 : 1.45) : 1.25}>
            <group ref={sizer} name={SIZER} scale={factor}>
              <LoadedModel url={url} frameUrl={frameUrl} dimensions={dimensions} edit={edit} server={server} saved={saved} replay={replay} onReport={onLoaded} onSlots={onSlots} movable={anim} liveSlots={liveSlots} choose={choosePick} onPick={(id, add) => {
                // Phones: tapping the selected part again while its properties show deselects it and lowers the sheet.
                if (fill && id === selected && !add && !several && also.size === 0 && sheet !== "peek" && window.matchMedia("(max-width: 1023px)").matches) {
                  pick(null);
                  setSheet("peek");
                  return;
                }
                pick(id, add);
                if (id) openTab("properties");
              }} track={track} />
            </group>
            <FitOnSignal signal={(resetView ?? 0) + fitKey} />
          </Bounds>
          <Animator slots={slots} root={modelRoot} config={anim} target={openTarget} />
          {hands && <IconTracker icons={icons} els={iconEls} />}
          {edit && modelRoot && <PickerBridge onReady={partsEditor.setPicker} root={authored(modelRoot)} meshes={modelMeshes} structure={structureMeshes} idOf={idOfMesh} around={surroundings} restOf={restOfMesh} />}
          {edit && modelRoot && realScale && partsEditor.preview && (
            <PlacementOverlay root={authored(modelRoot)} box={specBox(partsEditor.preview)} space={partsEditor.preview.space} valid={partsEditor.preview.valid} mpu={realScale} unit={guideUnit} ghost axis={offsetAxis(partsEditor.preview.type)} />
          )}
          {edit && modelRoot && realScale && !partsEditor.armed && (() => {
            const spec = partsEditor.added.find((a) => a.id === selected);
            return spec ? (
              <>
                <PlacementOverlay
                  root={authored(modelRoot)}
                  box={specBox(spec)}
                  space={spec.space ? new Box3(new Vector3(...spec.space[0]), new Vector3(...spec.space[1])) : undefined}
                  axis={offsetAxis(spec.type)}
                  valid={!partsEditor.blocked}
                  mpu={realScale}
                  unit={guideUnit}
                  ghost={false}
                  onLabel={(axis) => { setDimFocus(null); setTimeout(() => setDimFocus(axis), 0); }}
                  onOffset={(side) => { setDimFocus(null); setTimeout(() => setDimFocus(side), 0); }}
                />
                <ResizeHandles
                  root={authored(modelRoot)}
                  box={specBox(spec)}
                  mpu={realScale}
                  blocked={Boolean(partsEditor.blocked)}
                  onStart={() => partsEditor.beginResize(spec.id)}
                  onDrag={partsEditor.resizeDrag}
                  onEnd={partsEditor.endResize}
                  moveAxis={offsetAxis(spec.type)}
                  onMove={partsEditor.moveDrag}
                />
              </>
            ) : null;
          })()}
          {partSizes && <PartSizes target={sizer} names={partSizes.names} show={partSizes.show} onSizes={partSizes.onSizes} lit={partSizes.lit} onLit={partSizes.onLit} signal={`${url}|${factor}`} />}
          {edit && guides && designSize && onDesignSize && base && (
            <ResizeGizmo target={sizer} size={designSize} proportional={proportional} guides={guides} unit={guideUnit} onSize={onDesignSize} onDrag={() => undefined} draggable={!shopper} />
          )}
          <NeutralRoom />
        </Suspense>
        <ToneMapping />
        {/* Always mounted in the editor, not per selection: no flicker or colour shift on select. */}
        {edit && <SelectionOutline meshes={selection.map((item) => item.mesh)} />}
        {/* No grid: a soft contact shadow grounds the model on the backdrop. */}
        <ContactShadows name={GRID} position={[0, 0.001, 0]} scale={12} blur={2.4} far={4} opacity={0.35} resolution={1024} />
        {/* Never under the floor or upside down: a vertical drag stops just above the ground. */}
        <OrbitControls ref={orbit} makeDefault enableDamping autoRotate={autoRotate} autoRotateSpeed={1.2} minPolarAngle={0.1} maxPolarAngle={Math.PI / 2 - 0.02} onStart={() => setTurned(true)} />
      </Canvas>
      {/* The hand icons, one per movable part, on its handle (moved there every frame by IconTracker): above the canvas,
          so a click never turns the camera or selects a part. */}
      {!edit && enabledAnimations(anim).length > 0 && loadedUrl === url && (
        // The moving parts, docked on glass at the bottom of the canvas: how many, open all, close all.
        <div className="absolute bottom-3 end-3 z-20 flex items-center gap-1 rounded-2xl border border-white/70 bg-white/65 p-1 ps-3 text-xs shadow-lg shadow-slate-900/10 backdrop-blur-md">
          <DoorOpen className="size-4 text-[#b8731d]" aria-hidden />
          <span className="font-semibold text-brand-navy">{t("Movable parts")}</span>
          <span className="rounded-full bg-slate-900/5 px-1.5 font-semibold tabular-nums text-slate-600">{enabledAnimations(anim).length}</span>
          <button type="button" onClick={() => setOpenTarget(Object.fromEntries(enabledAnimations(anim).map((a) => [a.id, targetFor(a, true)])))} className="ms-1 rounded-xl bg-brand-amber px-3 py-1.5 font-semibold text-brand-navy transition hover:bg-[#e8952a]">
            {t("Open all")}
          </button>
          <button type="button" onClick={() => setOpenTarget(Object.fromEntries(enabledAnimations(anim).map((a) => [a.id, targetFor(a, false)])))} className="rounded-xl px-3 py-1.5 font-semibold text-slate-600 transition hover:bg-white">
            {t("Close all")}
          </button>
        </div>
      )}
      {icons.length > 0 && loadedUrl === url && (
        // Hide or show the hand icons.
        <label className="absolute start-3 top-3 z-20 flex cursor-pointer items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur">
          <input type="checkbox" checked={hands} onChange={(e) => showHands(e.target.checked)} className="size-3.5 accent-brand-amber" />
          <TurnIcon className="size-3.5" /> {t("Show hand icons")}
        </label>
      )}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" hidden={!hands}>
        {icons.map((icon) => {
          const part = anim?.animations.find((a) => a.id === icon.id);
          const open = part ? shownOpen(part, openTarget[icon.id] ?? 0) : (openTarget[icon.id] ?? 0) > 0;
          return (
            <button
              key={icon.id}
              ref={(el) => {
                if (el) iconEls.current.set(icon.id, el);
                else iconEls.current.delete(icon.id);
              }}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleOpen(icon.id);
              }}
              aria-label={t(open ? "Close" : "Open")}
              aria-pressed={open}
              style={{ opacity: 0 }}
              className={`group absolute left-0 top-0 grid size-5 place-items-center rounded-full border border-white/90 shadow shadow-slate-900/30 transition-colors ${open ? "bg-brand-amber text-brand-navy" : "bg-brand-navy/85 text-white"}`}
            >
              <span className="pointer-events-none absolute inset-0 rounded-full bg-brand-amber/60 opacity-0 group-hover:animate-ping group-hover:opacity-100" aria-hidden />
              <TurnIcon className="relative size-3" />
            </button>
          );
        })}
      </div>
      {edit && designSize && onDesignSize && !(shopper && fill) && (
        // Floating toolbar: typed sizes, the handles / dimensions switch and the unit. Phones: none (the sizes are in "Size & more").
        <div className={`absolute inset-x-3 top-3 flex justify-center ${fill ? "max-lg:hidden" : ""}`}>
          <div className="flex max-w-full flex-wrap items-end gap-3 rounded-2xl border border-white/70 bg-white/80 px-3 py-2 shadow-lg shadow-slate-900/5 backdrop-blur-md">
            <SizeInputs size={designSize} unit={guideUnit} proportional={proportional} onSize={onDesignSize} />
            {onProportional && (
              // Locked: one size changes all three (the model keeps its shape). Unlocked: each side on its own.
              <button type="button" aria-pressed={proportional} onClick={() => onProportional(!proportional)} title={t(proportional ? "Changing one size changes the others" : "Width, height and depth change separately")} className={`inline-flex h-8 items-center gap-1.5 self-end rounded-lg px-2 text-xs font-semibold transition ${proportional ? "bg-brand-navy text-white" : "border border-slate-200 bg-white text-slate-600"}`}>
                <Link2 className="size-3.5" aria-hidden /> {t("Lock proportions")}
              </button>
            )}
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
      {edit && fill && loadedUrl === url && !shopper && (
        // Phones: turn the model by hand (a one-finger drag), or 45° at a time with these.
        <>
          {!turned && sheet === "peek" && (
            <p className="pointer-events-none absolute inset-x-0 bottom-16 mx-auto w-fit rounded-full bg-brand-navy/80 px-3 py-1.5 text-xs font-medium text-white backdrop-blur lg:hidden">{t("Drag to rotate · pinch to zoom")}</p>
          )}
          {/* Top corner: the size lines and labels live along the bottom of the model. */}
          <div className="absolute end-3 top-3 flex gap-2 lg:hidden">
            {([1, -1] as const).map((dir) => (
              <button key={dir} type="button" onClick={() => turn(dir)} aria-label={t(dir === 1 ? "Rotate left" : "Rotate right")} className="flex size-11 items-center justify-center rounded-full border border-white/70 bg-white/90 text-brand-navy shadow-lg shadow-slate-900/10 backdrop-blur-md active:scale-95">
                {dir === 1 ? <RotateCcw className="size-5" aria-hidden /> : <RotateCw className="size-5" aria-hidden />}
              </button>
            ))}
          </div>
        </>
      )}
      {shopper && edit && loadedUrl === url && (
        <>
          {/* Phones: undo, redo and reset beside the model (on wide screens they head the panel). */}
          <div className="absolute start-3 top-3 flex gap-2 lg:hidden" role="toolbar" aria-label={t("Edit history")}>
            <ToolButton icon={Undo2} label="Undo" hint="Undo the last change" onClick={undo} off={past === 0} />
            <ToolButton icon={Redo2} label="Redo" hint="Redo the change you undid" onClick={redo} off={future === 0} />
            <ToolButton icon={Eraser} label="Reset looks" hint="Put back the original colours and materials (you can undo this)" onClick={resetLooks} off={!Object.keys(edits).length} />
          </div>
          {/* The camera: in a corner, out of the model's way. */}
          <div className="absolute end-3 top-3 flex gap-2 lg:bottom-4 lg:end-4 lg:top-auto lg:flex-col lg:gap-1 lg:rounded-2xl lg:border lg:border-white/70 lg:bg-white/85 lg:p-1 lg:shadow-lg lg:shadow-slate-900/10 lg:backdrop-blur-md" role="toolbar" aria-label={t("View controls")}>
            <CamButton icon={ZoomIn} label="Zoom in" onClick={() => zoom(true)} wide />
            <CamButton icon={ZoomOut} label="Zoom out" onClick={() => zoom(false)} wide />
            <CamButton icon={RotateCcw} label="Rotate" onClick={() => turn(1)} />
            <CamButton icon={Focus} label="Fit the whole model" onClick={() => setFitKey((k) => k + 1)} />
            {designSize && onDesignSize && <CamButton icon={Ruler} label={guides ? "Hide dimensions" : "Show dimensions"} onClick={() => showGuides(!guides)} on={guides} wide />}
            <CamButton icon={fullscreen ? Minimize : Maximize} label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen} />
            {fill && <CamButton icon={panelOpen ? PanelLeftClose : PanelLeftOpen} label={panelOpen ? "Hide the panel" : "Show the panel"} onClick={() => setPanelOpen((o) => !o)} wide mirror />}
          </div>
          {!turned && sheet === "peek" && (
            <p className="pointer-events-none absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full bg-brand-navy/75 lg:hidden px-3 py-1.5 text-xs font-medium text-white backdrop-blur">{t("Drag to rotate · pinch or scroll to zoom")}</p>
          )}
          {flash && (
            <p role="status" className="pointer-events-none absolute inset-x-0 top-16 z-10 mx-auto w-fit max-w-[80%] rounded-full bg-emerald-600 px-4 py-2 text-center text-xs font-semibold text-white shadow-lg lg:top-4">{flash}</p>
          )}
        </>
      )}
      {loadedUrl !== url && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/70 bg-white/85 px-5 py-4 shadow-lg backdrop-blur">
            <Loader2 className="size-7 animate-spin text-brand-amber" aria-hidden />
            <span className="text-xs font-medium text-slate-600">{t("Loading 3D model…")}</span>
          </div>
        </div>
      )}
      <div className={`pointer-events-none absolute inset-x-3 flex flex-col items-center gap-1 text-[11px] ${overlay ? "top-12" : "bottom-3"} ${fill ? "max-lg:bottom-auto max-lg:top-16" : ""}`}>
        {/* With the page's own overlay (studio) its size pill replaces this one; on phones the size pill on top does. */}
        <p className={`${overlay ? "hidden" : ""} ${fill ? "max-lg:hidden" : ""} rounded-full border border-white/70 bg-white/85 px-3 py-1 font-medium tabular-nums text-slate-700 shadow-sm backdrop-blur`}>
          {size
            ? `${designSize ? t("Your size") : sizeNote ?? (dimensions ? t("Catalogue size") : t("No catalogue size yet: authored size"))} · ${sizeCm(size)} ${t("cm")} (${t("W × H × D")})`
            : t("Loading…")}
        </p>
        {report?.warnings.map((warning) => (
          <p key={warning} className="rounded-lg border border-amber-200 bg-amber-50/95 px-2.5 py-1 text-amber-800 shadow-sm">{t(warning)}</p>
        ))}
      </div>
    </div>
  );

  const animationPanel = (editing: boolean) =>
    modelRoot && slots.length > 1 ? (
      <AnimationPanel
        config={anim ?? { version: 1, movable: false, animations: [], flagged: [], answer: null }}
        detected={detected}
        onChange={(next) => { dirty.current = true; setAnim(next); }}
        parts={[...new Map(slots.map((s) => [s.id, { id: s.id, name: s.name, nameAr: s.nameAr, mesh: s.mesh }])).values()]}
        boxOf={(mesh) => { applyPoses(slots, undefined); return boxInModel(mesh, authored(modelRoot)); }}
        target={openTarget}
        onTarget={setOpenTarget}
        edit={editing}
        onRebuild={(id) => {
          const slot = slots.find((s) => s.id === id);
          if (!slot || !anim || !rebuildPanel(slot.mesh)) return;
          dirty.current = true; // the saved file carries the clean panel; the stored original is unchanged
          applyPoses(slots, undefined);
          const cleared = { ...anim, animations: anim.animations.map((a) => (a.component === id ? { ...a, issues: [], enabled: true } : a)) };
          setAnim(checkMovers(cleared, slots, authored(modelRoot!)));
          setOpenTarget({});
        }}
      />
    ) : null;
  if (!edit) {
    return canvas; // the moving parts are on the canvas (their hand icons, and the bar to open or close them all)
  }

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

  const list: PartInfo[] = slots.filter((item) => !removed.has(item.id)).map((item) => ({ id: item.id, name: item.name, nameAr: item.nameAr, editable: true, naming: item.naming }));
  // The parts list takes the room left; download and the page's footer (e.g. "Have it made") stay under it.
  const partsPanel = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
    {/* At least a few parts in view: on a short window the column scrolls instead of squeezing the list away. */}
    <div className="flex min-h-48 flex-1 flex-col [&>aside]:flex-1">
    <PartList parts={list} selected={selected} also={also} several={slots.length > 1 ? several : undefined} onSeveral={setSeveral} limits={slots.length > 1 ? null : WHOLE} onSelect={(id, add) => { pick(id, add); openTab("properties"); }} onRename={shopper ? undefined : rename} hidden={hidden} onToggle={slots.length > 1 ? toggle : undefined} flat={(shopper && fill) || details !== undefined}
      {...(removedParts !== undefined && slots.length > 1 ? { onRemove: removePart, canRemove: removable, removedCount: removed.size, onRestore: restoreParts, removal } : {})} />
    </div>
    {!shopper && <button type="button" onClick={() => void download()} disabled={downloading} className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-brand-navy shadow-sm hover:bg-slate-50 disabled:opacity-60">
      <Download className="size-4" aria-hidden />
      {downloading ? t("Preparing the file…") : t("Download 3D model (.glb)")}
    </button>}
    {/* Its own scroll, at most 45% of the column: the parts list above always keeps its room. */}
    {modelRoot && slots.length > 1 && !shopper && <div className="max-h-[45%] min-h-0 shrink-0 overflow-y-auto overscroll-contain [scrollbar-width:thin]">{animationPanel(true)}</div>}
    {partsFooter && <div className="shrink-0">{partsFooter}</div>}
    </div>
  );
  // Side panels: their own thin scrollbar, the height of the canvas.
  const panel = `lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:thin] ${fill ? "lg:h-full lg:min-h-0" : "lg:sticky lg:top-20 lg:max-h-[calc(100dvh-12.5rem)]"}`;
  const columns = `${leftOpen ? "260px" : "0px"}_minmax(0,1fr)_${rightOpen ? "320px" : "0px"}`;
  // The customer's options that change the price: each chosen variant's and each added part's difference.
  const optionDeltas = [
    ...Object.entries(choices).map(([id, v]) => slots.find((s) => s.id === id)?.variants?.find((x) => x.id === v)?.price_delta),
    ...partsEditor.added.map((a) => addable.find((x) => x.type === a.type)?.price_delta),
  ];
  const estimate = guideWithOptions(priceGuide, optionDeltas);
  const controls = (
    <>
      {shopper && priceGuide !== undefined && !(fill && phoneAction) && (
        // An estimate, said as one, with what it rests on; no figure without enough earlier bids.
        <section className="rounded-2xl border border-slate-200/80 bg-white p-3 text-sm shadow-sm" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Estimated price")}</p>
          {estimate ? (
            <>
              <p className="mt-1 text-lg font-bold tabular-nums text-brand-navy"><bdi>{formatPrice(estimate.low)} – {formatPrice(estimate.high)}</bdi> <span className="text-xs font-medium text-slate-500">{t("per piece")}</span></p>
              {estimate.extra !== 0 && <p className="text-xs text-slate-600">{t("Includes {amount} for your options", { amount: formatPrice(estimate.extra) })}</p>}
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{t("From {n} vendor bids on {r} earlier requests for this model, adjusted to your size. An estimate only: the final price comes from vendors' bids.", { n: priceGuide!.count, r: priceGuide!.requests })}</p>
            </>
          ) : (
            <>
              <p className="mt-1 font-semibold text-brand-navy">{t("Price determined by vendor bids")}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{t("Not enough earlier bids on this model to estimate a price yet.")}</p>
            </>
          )}
        </section>
      )}
      <div id="sha2ty-part-controls" className="scroll-mt-4" />
      <PartControls
        flat={(shopper && fill) || details !== undefined}
        onBrowse={() => openTab("parts")}
        edited={selection.some((item) => Boolean(edits[item.id]))}
        look={slot ? { url: edits[slot.id]?.mapUrl ?? undefined, color: edits[slot.id]?.color ?? `#${standard(slotMaterial(slot))?.color.getHexString() ?? "cccccc"}` } : undefined}
        name={slot ? (selection.length > 1 ? t("{n} parts selected", { n: selection.length }) : partLabel(t, slot.name, slot.nameAr)) : null}
        edit={slot ? { color: `#${(standard(slotMaterial(slot))?.color.getHexString() ?? "cccccc")}`, roughness: standard(slotMaterial(slot))?.roughness, metalness: standard(slotMaterial(slot))?.metalness, ...edits[slot.id] } : null}
        mapping={slot ? edits[slot.id]?.mapping : undefined}
        area={area}
        canUndo={past > 0}
        canRedo={future > 0}
        onUndo={shopper && fill ? undefined : undo}
        onRedo={shopper && fill ? undefined : redo}
        onLibrary={(mapUrl, tile, picked) => {
          if (!slot) return;
          const next = { ...picked, mapUrl, color: "#ffffff", tile };
          // Each selected part its own texture (its tiling is its own); the image is loaded and prepared once.
          void track(Promise.all(selection.map((item) => loadMap(mapUrl, next).then((texture) => [item.id, texture] as const))).then((pairs) => changeSelected(next, new Map(pairs))));
        }}
        onPaint={(picked) => slot && changeSelected({ ...picked, mapUrl: undefined, normalUrl: undefined, mapping: undefined, tile: undefined, repeat: undefined })}
        onRepeat={(repeat) => slot && changeSelected({ repeat })}
        onTile={(tile) => slot && changeSelected({ tile })}
        onRotation={(rotation) => slot && changeSelected({ rotation })}
        onOffset={(offset) => slot && changeSelected({ offset })}
        onReset={() => {
          if (!slot) return;
          history.current.push(editsRef.current);
          ahead.current = [];
          dirty.current = true;
          const next = { ...editsRef.current };
          for (const item of selection) delete next[item.id];
          applyAll(next);
          setEdits(next);
          setPast(history.current.length);
          setFuture(0);
        }}
      />
      {slot && selection.length === 1 && takesVariants(slot) && (onUploadVariant || slot.variants?.some((v) => v.offered !== false)) && (
        <PartVariants
          key={slot.id}
          flat={(shopper && fill) || details !== undefined}
          // Customers see the variants the vendor offers; vendors all of theirs.
          variants={onUploadVariant ? slot.variants ?? [] : (slot.variants ?? []).filter((v) => v.offered !== false)}
          onValidate={(url) => variantFileProblem(slot, url, slot.variants ?? [], t)}
          chosen={choices[slot.id] ?? null}
          busy={variantBusy}
          error={variantError}
          onChoose={onUploadVariant ? undefined : (variant) => chooseVariant(slot, variant)}
          onUpload={onUploadVariant}
          onChange={(next) => setPartVariants(slot.id, next)}
        />
      )}
      {shopper ? (
        <>
      {woodParts.length === 0 && boardParts.length === 0 && woodKept > 0 && (
        <p className="rounded-2xl border border-slate-200/80 bg-white p-3 text-xs text-slate-500 shadow-sm">{t("Wood is not applied: this model's finish is paint, a chosen colour or another material. Change each part's paint or material instead.")}</p>
      )}
      {woodParts.length === 0 && boardParts.length > 0 && (
        <p className="text-xs text-slate-500">{t("The painted parts keep their paint: the wood you choose is what they are made of (and priced as).")}</p>
      )}
      {woodParts.length > 0 && woodKept > 0 && (
        <p className="text-xs text-slate-500">{t("Wood goes on the wooden parts only: {n} painted or other-material parts keep their finish.", { n: woodKept })}</p>
      )}
      {woodParts.length + boardParts.length > 0 && (
        <div className={fill ? "text-sm" : "rounded-2xl border border-slate-200/80 bg-white p-3 text-sm shadow-sm"}>
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
          {/* Adding parts: only the types the vendor offers for this model, folded until asked for. */}
          {addable.length > 0 && <details className={`group ${fill ? "" : "rounded-2xl border border-slate-200/80 bg-white shadow-sm"}`}>
            <summary className={`flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-semibold text-brand-navy [&::-webkit-details-marker]:hidden ${fill ? "py-1" : "px-4 py-3"}`}>
              {t("Add parts (shelves, drawers, legs…)")}
              <ChevronDown className="size-4 text-slate-400 transition-transform duration-200 group-open:rotate-180" aria-hidden />
            </summary>
            <div className={fill ? "pt-3" : "px-1 pb-1"}>
      <AddComponentsPanel
        allowed={addable}
        editor={partsEditor}
        selected={selected}
        mpu={realScale}
        unit={guideUnit}
        focus={dimFocus}
        // The part's own paint and material controls (colour, presets, woods, textures, roughness, reset).
        onPaint={() => {
          openTab("properties");
          document.getElementById("sha2ty-part-controls")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
            </div>
          </details>}
        </>
      ) : (
        <>
      <AddComponentsPanel
        editor={partsEditor}
        selected={selected}
        mpu={realScale}
        unit={guideUnit}
        focus={dimFocus}
        // The part's own paint and material controls (colour, presets, woods, textures, roughness, reset).
        onPaint={() => {
          openTab("properties");
          document.getElementById("sha2ty-part-controls")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
      {woodParts.length === 0 && boardParts.length === 0 && woodKept > 0 && (
        <p className="rounded-2xl border border-slate-200/80 bg-white p-3 text-xs text-slate-500 shadow-sm">{t("Wood is not applied: this model's finish is paint, a chosen colour or another material. Change each part's paint or material instead.")}</p>
      )}
      {woodParts.length === 0 && boardParts.length > 0 && (
        <p className="text-xs text-slate-500">{t("The painted parts keep their paint: the wood you choose is what they are made of (and priced as).")}</p>
      )}
      {woodParts.length > 0 && woodKept > 0 && (
        <p className="text-xs text-slate-500">{t("Wood goes on the wooden parts only: {n} painted or other-material parts keep their finish.", { n: woodKept })}</p>
      )}
      {woodParts.length + boardParts.length > 0 && (
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
          {onUploadVariant && <AddableEditor value={addable} onChange={(next) => { setAddable(next); dirty.current = true; }} />}
        </>
      )}
    </>
  );
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
  // The customer's editor and the vendor's / admin's model page share one layout: a tabbed panel beside the 3D view.
  const panelLayout = (shopper && fill) || details !== undefined;
  const TABS = [...(details !== undefined ? [["details", "Details"]] : []), ["parts", "Parts"], ["properties", panelLayout ? "Materials & colours" : "Properties"], ...(actions ? [["actions", actionsLabel]] : [])] as [Tab, string][];
  if (panelLayout) {
    const SHEET_H = { peek: "", half: "max-lg:h-[55%]", full: "max-lg:h-[calc(100%-3.5rem)]" } as const;
    const step = (dir: 1 | -1) => setSheet((now) => (["peek", "half", "full"] as const)[Math.min(2, Math.max(0, ["peek", "half", "full"].indexOf(now) + dir))]);
    const tip = !shopper ? null : tab === "parts" && !slot
      ? t("Tap a part on the model or in the list to change its look.")
      : past > 0 && tab !== "parts"
        ? t("Done? Save your design, then request offers from the bar below.")
        : null;
    const priceLine = priceGuide !== undefined && (
      <div className="min-w-0 max-lg:flex max-lg:items-baseline max-lg:gap-1.5" title={estimate ? t("From {n} vendor bids on {r} earlier requests for this model, adjusted to your size. An estimate only: the final price comes from vendors' bids.", { n: priceGuide!.count, r: priceGuide!.requests }) : t("Not enough earlier bids on this model to estimate a price yet.")}>
        <p className="shrink-0 text-[11px] font-medium text-slate-500 lg:text-xs">{t("Estimated price")}</p>
        <p className="truncate text-sm font-bold tabular-nums text-brand-navy lg:text-lg" aria-live="polite">
          {estimate ? <><bdi>{formatPrice(estimate.low)} – {formatPrice(estimate.high)}</bdi> <span className="text-xs font-medium text-slate-500">{t("per piece")}</span></> : <span className="text-sm">{t("Price determined by vendor bids")}</span>}
        </p>
      </div>
    );
    const bar = (priceLine || phoneAction) && (
      <div className="flex w-full items-center gap-4 max-lg:flex-col max-lg:items-stretch max-lg:gap-1.5">
        <div className="min-w-0 flex-1">{priceLine}</div>
        {phoneAction && <div className="shrink-0 lg:w-[28rem]">{phoneAction}</div>}
      </div>
    );
    const historyTools = (
      <div className="flex items-center gap-1" role="toolbar" aria-label={t("Edit history")}>
        <PanelIcon icon={Undo2} label="Undo" onClick={undo} off={past === 0} mirror />
        <PanelIcon icon={Redo2} label="Redo" onClick={redo} off={future === 0} mirror />
        <PanelIcon icon={Eraser} label="Reset looks" hint="Put back the original colours and materials (you can undo this)" onClick={resetLooks} off={!Object.keys(edits).length} />
        <PanelIcon icon={CircleHelp} label="How it works" onClick={() => setGuideOpen(!guideOpen)} on={guideOpen} />
      </div>
    );
    return (
      // Wide screens: the customisation panel (a third) beside the 3D view (the rest), a bar with the price, Save and
      // Request offers under both. Phones: the view fills the screen and the panel is a bottom sheet.
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1 lg:grid lg:grid-rows-[minmax(0,1fr)] lg:[grid-template-columns:var(--cols)]" style={{ "--cols": panelOpen ? "minmax(20rem,32%) minmax(0,1fr)" : "0px minmax(0,1fr)" } as CSSProperties}>
          <section aria-label={t("Customise")} className={`z-20 flex flex-col bg-white max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:rounded-t-3xl max-lg:border-t max-lg:border-slate-200/70 max-lg:shadow-[0_-12px_32px_-12px_rgba(15,23,42,0.25)] max-lg:transition-[height] max-lg:duration-300 ${SHEET_H[sheet]} lg:h-full lg:min-h-0 lg:border-e lg:border-slate-200 ${panelOpen ? "" : "lg:invisible"}`}>
            <button
              type="button"
              onClick={() => step(sheet === "full" ? -1 : 1)}
              onPointerDown={(e) => (sheetDrag.current = e.clientY)}
              onPointerUp={(e) => {
                const start = sheetDrag.current;
                sheetDrag.current = null;
                if (start !== null && Math.abs(e.clientY - start) > 30) {
                  e.preventDefault();
                  step(e.clientY < start ? 1 : -1);
                }
              }}
              aria-label={t(sheet === "full" ? "Collapse panel" : "Expand panel")}
              className="flex h-6 shrink-0 touch-none items-center justify-center lg:hidden"
            >
              <span className="h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
            </button>
            <div className="relative hidden shrink-0 items-center justify-between gap-2 px-5 pb-1 pt-4 lg:flex">
              <div className="min-w-0">
                <p className="text-base font-bold tracking-tight text-brand-navy">{t(shopper ? "Customise your piece" : "Edit the model")}</p>
                <p className="truncate text-xs text-slate-500">{slot ? t("Customising {part}", { part: selection.length > 1 ? t("{n} parts selected", { n: selection.length }) : partLabel(t, slot.name, slot.nameAr) }) : t("No part selected")}</p>
              </div>
              {historyTools}
            </div>
            {guideOpen && (
              <div className="relative z-10 mx-3 mb-2 rounded-2xl bg-brand-navy p-4 text-white shadow-xl lg:mx-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{t("How it works")}</p>
                  <button type="button" onClick={() => setGuideOpen(false)} aria-label={t("Close")} className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white"><X className="size-4" aria-hidden /></button>
                </div>
                <ol className="mt-2 space-y-1.5 text-[13px] text-white/85">
                  {(["Tap a part on the model or in the list.", "Choose its wood, fabric or colour.", "Turn the model to see it from every side.", "Save your design.", "Request offers: makers reply with a price and a timeline."] as const).map((line, i) => (
                    <li key={line} className="flex gap-2"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-amber text-[11px] font-bold text-brand-navy tabular-nums">{i + 1}</span>{t(line)}</li>
                  ))}
                </ol>
              </div>
            )}
            <div className="flex shrink-0 border-b border-slate-200 px-2 lg:px-4" role="tablist">
              {TABS.map(([id, label]) => {
                const Icon = TAB_ICON[id];
                const on = tab === id;
                return (
                  <button key={id} type="button" role="tab" aria-selected={on} onClick={() => (on && sheet !== "peek" && window.matchMedia("(max-width: 1023px)").matches ? setSheet("peek") : openTab(id))} className={`relative flex h-12 min-w-0 flex-1 items-center justify-center gap-1.5 px-1.5 text-[13px] font-semibold transition-colors after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors ${on ? "text-brand-navy after:bg-brand-amber" : "text-slate-500 after:bg-transparent hover:text-brand-navy"}`}>
                    <Icon className={`size-4 shrink-0 lg:max-xl:hidden ${on ? "text-brand-amber" : ""}`} aria-hidden />
                    <span className="truncate max-sm:hidden">{t(label)}</span>
                    <span className="truncate sm:hidden">{t(({ details: "Details", parts: "Parts", properties: "Materials", actions: "Dimensions" } as const)[id])}</span>
                  </button>
                );
              })}
            </div>
            <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 pt-4 [scrollbar-width:thin] lg:px-5 ${sheet === "peek" ? "max-lg:hidden" : ""}`}>
              {tip && tipHidden !== tip && (
                <p className="mb-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
                  <Lightbulb className="mt-px size-4 shrink-0 text-brand-amber" aria-hidden />
                  <span className="flex-1">{tip}</span>
                  <button type="button" onClick={() => setTipHidden(tip)} aria-label={t("Hide")} className="-m-1 rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-600"><X className="size-3.5" aria-hidden /></button>
                </p>
              )}
              {/* One workspace: sections divided by hairlines, not cards. */}
              <div className="divide-y divide-slate-100 [&>*:empty]:hidden [&>*]:py-5 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
                {tab === "details" && details}
                {tab === "parts" && partsPanel}
                {tab === "properties" && controls}
                {tab === "actions" && actions}
              </div>
            </div>
            {bar && <div className="mx-3 mb-[max(0.75rem,env(safe-area-inset-bottom))] mt-1 shrink-0 lg:hidden">{bar}</div>}
          </section>
          <div className={`relative max-lg:absolute max-lg:inset-x-0 max-lg:top-0 max-lg:transition-[bottom] max-lg:duration-300 ${sheet === "peek" ? (bar ? "max-lg:bottom-[11.5rem]" : "max-lg:bottom-[5.5rem]") : "max-lg:bottom-[55%]"} lg:h-full lg:min-h-0`}>
            {canvas}
            {overlay}
          </div>
        </div>
        {bar && <div className="hidden shrink-0 border-t border-slate-200 bg-white px-6 py-3 shadow-[0_-8px_24px_-16px_rgba(15,23,42,0.25)] lg:flex">{bar}</div>}
      </div>
    );
  }
  const SHEET = { peek: "", half: "max-lg:h-[52%]", full: "max-lg:h-[calc(100%-3.5rem)]" } as const;
  const sheetStep = (dir: 1 | -1) => setSheet((s) => (["peek", "half", "full"] as const)[Math.min(2, Math.max(0, ["peek", "half", "full"].indexOf(s) + dir))]);
  return (
    // Desktop: parts | canvas | properties (+ the page's actions), side panels collapsible. Below 1024 px with `fill`
    // (the editor pages, the app): the canvas fills the screen and the panels sit in a bottom sheet (peek / half /
    // full; drag or tap its handle) with a floating toolbar for the selected part. Without `fill`: the canvas on top
    // and one panel under it, chosen with tabs.
    <div
      className={`flex flex-col gap-3 lg:grid lg:gap-4 lg:[grid-template-columns:var(--cols)] ${fill ? "max-lg:relative max-lg:min-h-0 max-lg:flex-1 max-lg:gap-0 max-lg:overflow-hidden lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]" : "lg:items-start"}`}
      style={{ "--cols": columns.replace(/_/g, " ") } as CSSProperties}
    >
      {/* Full height: no scroll of its own, only the parts list inside scrolls. */}
      <div className={`hidden ${fill ? "lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-y-auto lg:overscroll-contain [scrollbar-width:thin]" : `lg:block ${panel}`} ${leftOpen ? "" : "lg:invisible lg:w-0"}`}>{leftOpen && partsPanel}</div>
      {/* Phones: the 3D view ends where the sheet starts (full: stays above the half height), so the camera fits
          the model into what is visible and a selected part is never under the sheet. */}
      <div className={`relative ${fill ? `max-lg:absolute max-lg:inset-x-0 max-lg:top-0 max-lg:transition-[bottom] max-lg:duration-300 ${sheet === "peek" ? (phoneAction ? "max-lg:bottom-[9rem]" : "max-lg:bottom-[5.5rem]") : "max-lg:bottom-[52%]"} lg:h-full lg:min-h-0` : "max-lg:sticky max-lg:top-16 max-lg:z-10"}`}>
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
      {/* Phones with `fill`: the bottom sheet. Wide screens: its wrappers vanish (contents), so its panels are the grid's. */}
      <div
        className={fill ? `max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:flex max-lg:flex-col max-lg:rounded-t-3xl max-lg:border-t max-lg:border-slate-200/70 max-lg:bg-white/95 max-lg:shadow-[0_-12px_32px_-12px_rgba(15,23,42,0.25)] max-lg:backdrop-blur-xl max-lg:transition-[height] max-lg:duration-300 ${SHEET[sheet]} lg:contents` : "contents"}
      >
        {fill && (
          <button
            type="button"
            onClick={() => sheetStep(sheet === "full" ? -1 : 1)}
            onPointerDown={(e) => (sheetDrag.current = e.clientY)}
            onPointerUp={(e) => {
              const start = sheetDrag.current;
              sheetDrag.current = null;
              if (start !== null && Math.abs(e.clientY - start) > 30) {
                e.preventDefault();
                sheetStep(e.clientY < start ? 1 : -1);
              }
            }}
            aria-label={t(sheet === "full" ? "Collapse panel" : "Expand panel")}
            className="flex h-6 shrink-0 touch-none items-center justify-center lg:hidden"
          >
            <span className="h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
          </button>
        )}
        {/* Segmented control: a soft track, the open tab a raised white pill; icon + one-line label each. */}
        <div className={`flex gap-1 rounded-2xl bg-slate-100 p-1 lg:hidden ${fill ? "mx-3 mb-3 shrink-0" : ""}`} role="tablist">
          {TABS.map(([id, label]) => {
            const Icon = TAB_ICON[id];
            const on = tab === id;
            return (
              <button key={id} type="button" role="tab" aria-selected={on} onClick={() => (fill ? (on && sheet !== "peek" ? setSheet("peek") : openTab(id)) : setTab(id))} className={`flex h-11 flex-auto items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition ${on ? "bg-white text-brand-navy shadow-[0_1px_3px_rgba(15,23,42,0.12)]" : "text-slate-500 active:bg-white/60"}`}>
                <Icon className={`size-4 shrink-0 ${on ? "text-brand-amber" : ""}`} aria-hidden />
                <span className="whitespace-nowrap">{t(label)}</span>
              </button>
            );
          })}
        </div>
        <div className={fill ? `max-lg:min-h-0 max-lg:flex-1 max-lg:overflow-y-auto max-lg:overscroll-contain max-lg:px-3 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))] lg:contents ${sheet === "peek" ? "max-lg:hidden" : ""}` : "contents"}>
          <div className="lg:hidden">{tab === "parts" && partsPanel}</div>
          <div className={`space-y-3 lg:block ${panel} ${tab === "parts" ? "max-lg:hidden" : ""} ${rightOpen ? "" : "lg:invisible lg:w-0"}`}>
          <div className={`space-y-3 ${tab === "actions" ? "max-lg:hidden" : ""}`}>{controls}</div>
          {actions && <div className={tab === "properties" ? "max-lg:hidden" : ""}>{actions}</div>}
          </div>
        </div>
        {fill && phoneAction && <div className="mx-3 mb-[max(0.75rem,env(safe-area-inset-bottom))] mt-1 shrink-0 lg:hidden">{phoneAction}</div>}
      </div>
    </div>
  );
}

/** Vendors: which parts customers may add to this model (none ticked: they add nothing), and what each adds to
 * the price. Saved with the model's part list; the backend refuses customer designs with anything else. */
function AddableEditor({ value, onChange }: { value: AddablePart[]; onChange: (next: AddablePart[]) => void }) {
  const t = useT();
  const ar = t("Part") === "جزء";
  const on = new Map(value.map((a) => [a.type, a]));
  return (
    <section className="space-y-2 rounded-2xl border border-slate-200/80 bg-white p-3 text-sm shadow-sm">
      <p className="text-[13px] font-semibold text-brand-navy">{t("Parts customers can add")}</p>
      <p className="text-[11px] text-slate-500">{t("Only what you can make and price. Customers see these as optional parts with your price difference.")}</p>
      <ul className="space-y-1.5">
        {REGISTRY.map((d) => {
          const entry = on.get(d.type);
          return (
            <li key={d.type} className="flex items-center gap-2">
              <label className="flex flex-1 items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={Boolean(entry)} onChange={(e) => onChange(e.target.checked ? [...value, { type: d.type }] : value.filter((a) => a.type !== d.type))} className="size-4 accent-brand-amber" />
                {ar ? d.nameAr : t(d.name)}
              </label>
              {entry && (
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder={t("± EGP")}
                  aria-label={t("Price difference (EGP)")}
                  value={entry.price_delta ?? ""}
                  onChange={(e) => onChange(value.map((a) => (a.type === d.type ? { ...a, price_delta: e.target.value === "" ? null : Number(e.target.value) } : a)))}
                  className="h-8 w-24 rounded-lg border border-slate-200 px-2 text-xs tabular-nums"
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}


/** A camera button over the 3D view: its name in a tooltip (wide screens), large enough for a finger. `wide`: wide
 * screens only (phones pinch to zoom, and have no side panel). */
function CamButton({ icon: Icon, label, onClick, on = false, wide = false, mirror = false }: { icon: typeof Undo2; label: string; onClick: () => void; on?: boolean; wide?: boolean; mirror?: boolean }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} title={t(label)} aria-label={t(label)} aria-pressed={on || undefined} className={`group relative size-11 items-center justify-center rounded-full border border-white/70 bg-white/90 text-brand-navy shadow-lg shadow-slate-900/10 backdrop-blur-md transition active:scale-95 lg:size-9 lg:rounded-xl lg:border-0 lg:bg-transparent lg:shadow-none lg:hover:bg-slate-100 ${wide ? "hidden lg:flex" : "flex"} ${on ? "lg:bg-brand-amber-soft lg:text-brand-navy" : ""}`}>
      <Icon className={`size-[18px] ${mirror ? "rtl:-scale-x-100" : ""}`} aria-hidden />
      <span className="pointer-events-none absolute end-full top-1/2 me-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-brand-navy px-2 py-1 text-xs font-medium text-white opacity-0 shadow transition group-hover:opacity-100 lg:block">{t(label)}</span>
    </button>
  );
}

/** A small icon button in the panel's header, named in its tooltip. */
function PanelIcon({ icon: Icon, label, hint, onClick, off = false, on = false, mirror = false }: { icon: typeof Undo2; label: string; hint?: string; onClick: () => void; off?: boolean; on?: boolean; mirror?: boolean }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} disabled={off} title={t(hint ?? label)} aria-label={t(label)} aria-pressed={on || undefined} className={`flex size-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-brand-navy disabled:opacity-35 disabled:hover:bg-transparent ${on ? "bg-brand-amber-soft text-brand-navy" : ""}`}>
      <Icon className={`size-[18px] ${mirror ? "rtl:-scale-x-100" : ""}`} aria-hidden />
    </button>
  );
}

function ToolButton({ icon: Icon, label, hint, onClick, off }: { icon: typeof Undo2; label: string; hint: string; onClick: () => void; off: boolean }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} disabled={off} title={t(hint)} aria-label={t(label)} className="group relative flex size-11 items-center justify-center rounded-full border border-white/70 bg-white/90 text-brand-navy shadow-lg shadow-slate-900/10 backdrop-blur-md transition hover:bg-white active:scale-95 disabled:opacity-40 lg:size-10">
      <Icon className="size-[18px] rtl:-scale-x-100" aria-hidden />
      <span className="pointer-events-none absolute start-full top-1/2 ms-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-brand-navy px-2 py-1 text-xs font-medium text-white opacity-0 shadow transition group-hover:opacity-100 lg:block">{t(label)}</span>
    </button>
  );
}
