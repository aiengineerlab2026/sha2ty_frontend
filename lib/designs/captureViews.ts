import { Box3, DirectionalLight, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, NeutralToneMapping, OrthographicCamera, PerspectiveCamera, PMREMGenerator, Raycaster, SRGBColorSpace, Scene, Vector3, WebGLRenderer, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { normalizeModel, uniformFactor } from "@/lib/plan/modelNormalization";
import { applyAnimations, attachmentsFrom, enabledAnimations, refine } from "@/lib/vendor/animation";
import type { ItemDesign } from "@/lib/designs/schema";
import { axisTexts, checkMeasurements, partSize, tableRows, type Check, type RestBox } from "@/lib/designs/measure";
import { shopName } from "@/lib/designs/partNames";
import { ARROW, DimLayout, fmt, partsTable, PARTS_SHEET, PICTURE, VIEWS_VERSION, type Dim, type Mask, type Pt, type Rect, type ViewPart } from "@/lib/designs/viewParts";

/** The pictures of a saved customised model for its implementation request: closed with its overall width, height
 * and depth; front, side and top orthographic views with the same; opened (every movable part); and a close-up of each
 * row of the parts table (one part, "× n" for alike ones) with that row's own width, height and depth as dimension
 * lines outside the model. Every number comes from the mesh geometry and its transforms (lib/designs/measure.ts),
 * never from a picture, and is the table's own. Also the measurement checks the PDF lists. Rendered from the saved version's own file in a scene of their own (the editor's
 * scene and open / closed state are never touched), the same way every time. Throws when the file or any saved part
 * is missing: a request never goes out with an incomplete report. */
export type CapturedViews = { pictures: Blob; overall: { width: number; height: number; depth: number }; closed: Blob; open: Blob; details: Blob[]; detailGroups: string[]; ortho: Blob; checks: Check[]; parts: ViewPart[]; scaleKnown: boolean; opened: number; version: number };

const { W, H } = PICTURE;
const MAX_DETAILS = 60;
/** A close-up's size (px): smaller than the overall views with the same 54 px text, so four fit on a PDF page with the
 * text still about 8–10 pt printed (backend request_report LABEL_PX, MIN_LABEL_PT). */
const DETAIL = 1600; // pages of close-ups at most (backend DesignViews.detail_urls)
const NAVY = "#172033";
const FONT = "system-ui, 'Segoe UI', Tahoma, Arial, sans-serif";

export async function captureViews({ glbUrl, item, lang }: { glbUrl: string; item: ItemDesign; lang: "ar" | "en" }): Promise<CapturedViews> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl); // resolves once every embedded texture is decoded
  const source = item.source;
  const original = source.width_m && source.height_m && source.depth_m ? { width: source.width_m, height: source.height_m, depth: source.depth_m } : null;
  // As the editor shows it: fitted to the catalogue size, then the customer's size on top (one factor).
  const { object, report } = normalizeModel(gltf.scene, original);
  const dims = item.dimensions ?? original;
  if (dims) object.scale.setScalar(uniformFactor([dims.width / report.finalSize.width, dims.height / report.finalSize.height, dims.depth / report.finalSize.depth]));
  const sized = new Group().add(object);
  sized.updateMatrixWorld(true);
  const model = (object.children[0]?.children[0]?.children[0] ?? object) as Object3D; // the file's own frame (ModelViewer authored)

  // Parts by the ids saved in the file (glTF extras), else by name, else by order (files saved before ids).
  const doc = item.components;
  const comps = doc?.components ?? [];
  const removed = new Set(item.removed_parts ?? []);
  const meshes: Mesh[] = [];
  model.traverse((o) => (o as Mesh).isMesh && meshes.push(o as Mesh));
  const byId = new Map(comps.map((c) => [c.id, c]));
  const slots = meshes.map((mesh, i) => {
    const saved = (mesh.userData.partId as string | undefined) ?? (mesh.userData.partIds as string[] | undefined)?.[0];
    const id = saved ?? (byId.has(mesh.name) ? mesh.name : comps.find((c) => c.name === mesh.name)?.id) ?? comps[i]?.id ?? mesh.name;
    const info = byId.get(id);
    return { id, mesh, name: info?.name ?? mesh.name, nameAr: info?.nameAr ?? null };
  });
  const found = new Set(slots.map((s) => s.id));
  const added = doc?.added ?? [];
  const missing = [...added.map((a) => a.id), ...(meshes.some((m) => m.userData.partId) ? comps.map((c) => c.id).filter((id) => !removed.has(id)) : [])].filter((id) => !found.has(id));
  if (missing.length) throw new Error(`The saved model file is missing ${missing.length} part(s) (${missing.slice(0, 3).join(", ")}). Save the design again, then send the request.`);

  const scaleKnown = Boolean(original);
  const mpu = new Vector3().setFromMatrixScale(model.matrixWorld);
  const whole = new Box3().setFromObject(sized);
  const config = refine(doc?.animation, slots, model, attachmentsFrom(doc));
  const accessories = new Set(enabledAnimations(config).flatMap((a) => a.follow));
  const names = new Map(slots.map((s) => [s.id, s.name]));
  const namesAr = new Map(slots.map((s) => [s.id, s.nameAr]));
  const moving = new Map(enabledAnimations(config).map((a) => [a.component, a.type] as const));
  const parts = partsTable({ moving, bounds: whole, slots, names, namesAr, added, mpu, edits: item.material_edits ?? {}, accessories, whole: whole.getSize(new Vector3()) });

  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0xffffff, 1);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping; // hues as they are: brighter light, same colours
    const scene = new Scene();
    scene.environment = environment;
    scene.environmentIntensity = 0.95;
    // A studio set: a strong key from the front right, a soft fill, a rim from behind that lifts the edges off the white.
    const key = new DirectionalLight(0xffffff, 1.1);
    key.position.set(4, 8, 6);
    const fill = new DirectionalLight(0xffffff, 0.45);
    fill.position.set(-5, 3, 4);
    const rim = new DirectionalLight(0xffffff, 0.4);
    rim.position.set(0, 5, -7);
    scene.add(key, fill, rim, sized);
    const meshesOf = new Map<string, Mesh[]>();
    for (const s of slots) meshesOf.set(s.id, [...(meshesOf.get(s.id) ?? []), s.mesh]);
    // At rest (before anything opens): each part's box in cm for the checks, and how its own axes lie on the
    // furniture's (what each dimension line in its close-up is labelled).
    const restBoxes = new Map<string, RestBox>();
    const axesOf = new Map<string, ReturnType<typeof partSize>["axes"]>();
    for (const [id, ms] of meshesOf) {
      const b = ms.reduce((box, m) => box.union(new Box3().setFromObject(m)), new Box3());
      restBoxes.set(id, { min: b.min.toArray().map((v) => v * 100) as RestBox["min"], max: b.max.toArray().map((v) => v * 100) as RestBox["max"] });
      axesOf.set(id, partSize(ms).axes);
    }

    // 0. Each main part on its own (the model at rest): the others hidden, the part turned to show its face and
    // its thickness, fitted to its square, with its own material. One sheet (PARTS_SHEET), cell `pic`.
    // A part's picture shows what rides on it too (a door with its mirror, frame and handle), as it is built.
    const carried = new Map(enabledAnimations(config).map((a) => [a.component, a.follow]));
    const pictures = await partPictures(renderer, scene, parts, (id) => [id, ...(carried.get(id) ?? [])].flatMap((x) => meshesOf.get(x) ?? []), slots.map((s) => s.mesh));
    renderer.setSize(W, H, false);

    const camera = new PerspectiveCamera(30, W / H, 0.01, 1000);
    const all = slots.map((s) => s.mesh);
    const shot: Shot = { renderer, scene, camera, all };
    const word = lang === "ar" ? { w: "العرض", h: "الارتفاع", d: "العمق", cm: "سم" } : { w: "Width", h: "Height", d: "Depth", cm: "cm" };

    // 1. Closed: the model as large as its three overall dimensions (width, height, depth: each its own line) allow.
    const s = whole.getSize(new Vector3());
    const approx = scaleKnown ? "" : "≈";
    const overallMeasure: Measure = {
      corners: corners(whole),
      texts: [[word.w, s.x], [word.h, s.y], [word.d, s.z]].map(([k, v]) => `${k} ${approx}${fmt((v as number) * 100)} ${word.cm}`),
      color: NAVY,
    };
    const warning = scaleKnown ? undefined : lang === "ar" ? "المقاس الحقيقي غير معروف: أكّد كل المقاسات" : "Real size unknown: confirm every dimension";
    const closed = await view(shot, { keep: new Set(all), hide: new Set(), outline: all, measures: [overallMeasure], frame: whole, fills: [0.8, 0.7, 0.6, 0.5], dirs: DIRS, lang, warning });
    if (!closed) throw new Error("The model's overall dimensions could not be drawn clearly.");
    // Front, side and top, orthographic: each with the two overall sizes it shows true to length.
    const ortho = await orthoViews(shot, whole, overallMeasure.texts, lang);

    // 2. Opened: every movable part open, from the front angle that shows the most parts; the whole model large and
    // clean (no dimensions: each part gets its own close-up below).
    const opened = enabledAnimations(config);
    const doors = new Set(opened.filter((a) => a.type === "rotation").flatMap((a) => [a.component, ...a.follow]));
    applyAnimations(slots, model, config, Object.fromEntries(opened.map((a) => [a.id, 1])));
    sized.updateMatrixWorld(true);
    const openBox = new Box3().setFromObject(sized);
    const boxes = new Map<string, Box3>();
    for (const sl of slots) boxes.set(sl.id, (boxes.get(sl.id) ?? new Box3()).union(new Box3().setFromObject(sl.mesh)));
    const labelled = parts.filter((p) => p.shown && boxes.has(p.id));
    const dirs = opened.length ? [[0.55, 0.45, 1.5], [-0.55, 0.45, 1.5], [0.25, 0.3, 1.6], [0.9, 0.6, 1.3], [-0.9, 0.6, 1.3]] : [[-1, 0.55, 1.4], [-0.6, 0.9, 1.2]];
    let best = { dir: new Vector3(...dirs[0]), seen: -1 };
    for (const v of dirs) {
      const dir = new Vector3(...v);
      fit(camera, openBox, dir, 0.86);
      const seen = labelled.filter((p) => visible(camera, boxes.get(p.id)!, meshesOf.get(p.id)!, sized)).length;
      if (seen > best.seen) best = { dir, seen };
    }
    const open = (await view(shot, { keep: new Set(all), hide: new Set(), outline: all, measures: [], frame: openBox, fills: [0.86], dirs: [best.dir], lang }))!;

    // 3. Close-ups: one a row of the parts table (tableRows: alike parts once, "× n", the range of their sizes), in
    // its order, so each picture shows exactly its row's numbers. One part a picture (never two parts' measurements
    // together), its own width, height and depth on its own edges; a board's thinnest side (its thickness) left out.
    // Doors hidden for what is inside them, the other parts faint. A part that does not fit cleanly gets a wider view;
    // the text is never made smaller.
    const rows = tableRows(parts.filter((p) => p.main && boxes.has(p.id)), lang);
    if (rows.length > MAX_DETAILS) throw new Error(`Too many parts to show clearly (${rows.length} close-ups; at most ${MAX_DETAILS}).`);
    const details: Blob[] = [];
    const detailGroups: string[] = [];
    const hideDoors = new Set([...doors].flatMap((id) => meshesOf.get(id) ?? []));
    for (const row of rows) {
      const p = row.parts[0];
      const ms = meshesOf.get(p.id)!;
      const material = p.material || p.board || p.paint;
      const names = [...new Set(row.parts.map((part) => shopName(part, lang)))].join(" / ");
      const name = `${names} × ${row.quantity}` + (material ? ` · ${material}` : "") + (p.added ? (lang === "ar" ? " (مضاف)" : " (added)") : "");
      const blob = await view(shot, {
        keep: new Set(ms), hide: p.group === "doors" ? new Set() : hideDoors, outline: ms,
        measures: [{ corners: partCorners(ms, p.quantity > 1, boxes.get(p.id)!), texts: axisTexts(row, axesOf.get(p.id)!, lang), color: NAVY, name, meshes: ms }],
        frame: frameOf([p], boxes, openBox), fills: [0.62, 0.5, 0.4, 0.32], dirs: DIRS, lang, legend: true, size: DETAIL,
      });
      if (!blob) throw new Error(`The dimensions of ${p.name} could not be drawn clearly.`);
      details.push(blob);
      detailGroups.push(p.group);
    }
    // The model's own size (cm, closed), as measured from the same geometry as every part's.
    const size = s.clone().multiplyScalar(100);
    const measured = { width: Math.round(size.x * 10) / 10, height: Math.round(size.y * 10) / 10, depth: Math.round(size.z * 10) / 10 };
    const requested = item.dimensions ? { width: item.dimensions.width * 100, height: item.dimensions.height * 100, depth: item.dimensions.depth * 100 } : null;
    const checks = checkMeasurements({ parts, model: measured, requested, scaleKnown, boxes: restBoxes });
    return { pictures, overall: measured, closed, ortho, open, details, detailGroups, checks, parts, scaleKnown, opened: opened.length, version: VIEWS_VERSION };
  } finally {
    environment.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** The main parts' pictures (see the call). Every mesh's visibility and the background are put back. */
async function partPictures(renderer: WebGLRenderer, scene: Scene, parts: ViewPart[], meshesOf: (id: string) => Mesh[], all: Mesh[]): Promise<Blob> {
  const { size, cols } = PARTS_SHEET;
  const shown = parts.filter((p) => p.pic !== null);
  const sheet = document.createElement("canvas");
  sheet.width = cols * size;
  sheet.height = Math.max(1, Math.ceil(shown.length / cols)) * size;
  const ctx = sheet.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the part pictures.");
  ctx.fillStyle = "#f1f3f4";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0xf1f3f4, 1); // a light grey: white and pale wood stand out
  const camera = new PerspectiveCamera(30, 1, 0.01, 1000);
  const was = all.map((m) => m.visible);
  try {
    for (const part of shown) {
      const own = meshesOf(part.id);
      for (const m of all) m.visible = own.includes(m);
      const box = own.reduce((b, m) => b.union(new Box3().setFromObject(m)), new Box3());
      if (box.isEmpty()) continue;
      // Facing its largest side, turned enough to see its thickness: a door from the front, a shelf from above.
      const s = box.getSize(new Vector3());
      const dir = s.y <= Math.min(s.x, s.z) ? new Vector3(0.6, 1.6, 0.9) : s.x <= s.z ? new Vector3(1.6, 0.5, 0.7) : new Vector3(0.7, 0.5, 1.6);
      fit(camera, box, dir, 0.86, 0.86);
      renderer.render(scene, camera);
      ctx.drawImage(renderer.domElement, (part.pic! % cols) * size, Math.floor(part.pic! / cols) * size, size, size);
    }
  } finally {
    all.forEach((m, i) => (m.visible = was[i]));
    renderer.setClearColor(0xffffff, 1);
  }
  const blob = await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("This browser could not encode the part pictures.");
  return blob;
}

/** Whether the part shows: a ray from the camera to its centre (or the middle of its front) meets it first. */
function visible(camera: PerspectiveCamera, box: Box3, own: Mesh[], scene: Object3D): boolean {
  const ray = new Raycaster();
  const targets = [box.getCenter(new Vector3()), box.getCenter(new Vector3()).setZ(box.max.z)];
  return targets.some((t) => {
    ray.set(camera.position, t.clone().sub(camera.position).normalize());
    const hit = ray.intersectObject(scene, true)[0];
    return Boolean(hit && own.includes(hit.object as Mesh));
  });
}

/** The camera looking at `box` from `direction`, as close as keeps every corner of the box within `fill` of the
 * picture's half-height and `fillX` of its half-width (the model as big as the picture allows; with labels, the
 * middle of the picture, the labels in the margins beside it). */
function fit(camera: PerspectiveCamera, box: Box3, direction: Vector3, fill: number, fillX = fill) {
  const center = box.getCenter(new Vector3());
  const dir = direction.clone().normalize();
  let distance = (box.getSize(new Vector3()).length() / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.2;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  for (let i = 0; i < 6; i++) {
    camera.position.copy(center).addScaledVector(dir, distance);
    camera.near = distance / 100;
    camera.far = distance * 10;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const reach = Math.max(...corners.map((c) => { const p = c.clone().project(camera); return Math.max(Math.abs(p.x) / fillX, Math.abs(p.y) / fill); }));
    distance *= 1 + (reach - 1) * 0.9; // a few steps converge (perspective is not linear in the distance)
  }
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
}


type Shot = { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; all: Mesh[] };
/** What one picture measures: a box's 8 world corners (corner i at the max of axis k when bit k is set; the axes are
 * the part's own, rotation included), the label of each axis (width, height, depth) and the colour of its lines. */
type Measure = { corners: Vector3[]; texts: string[]; color: string; name?: string; meshes?: Mesh[] };

/** Front three-quarter angles the camera picks from (the front of the furniture always in view). */
const DIRS = [[1.1, 0.7, 1.9], [-1.1, 0.7, 1.9], [0.5, 0.45, 2], [-0.5, 0.45, 2], [1.6, 0.9, 1.2], [-1.6, 0.9, 1.2], [0.6, 1.6, 1.2], [-0.6, 1.6, 1.2]].map((d) => new Vector3(...d));
const TEXT = { size: 54, height: 84, pad: 24 }; // px on the 2400 px picture: about 11 pt printed

const corners = (box: Box3) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));

/** A part's box along its own axes: its geometry's box through its world matrix (an open door's box turns with it).
 * Alike pieces (`alike`): the first one's. Several different pieces: their world box. */
function partCorners(meshes: Mesh[], alike: boolean, world: Box3): Vector3[] {
  if (meshes.length > 1 && !alike) return corners(world);
  const mesh = meshes[0];
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  mesh.updateWorldMatrix(true, false);
  return corners(mesh.geometry.boundingBox!).map((c) => c.applyMatrix4(mesh.matrixWorld));
}

const toScreen = (camera: PerspectiveCamera | OrthographicCamera, p: Vector3, size = W): Pt => {
  const v = p.clone().project(camera);
  return { x: ((v.x + 1) / 2) * size, y: ((1 - v.y) / 2) * size };
};

/** How well a camera shows the measures: every axis of every box long enough on the picture to measure (the sum of
 * the logs: a short side counts as much as a long one; sides not measured do not count). */
function score(camera: PerspectiveCamera, measures: Measure[]): number {
  let total = 0;
  for (const m of measures) {
    const s = m.corners.map((c) => toScreen(camera, c));
    for (const bit of [1, 2, 4].filter((_, axis) => m.texts[axis])) total += Math.log(1 + Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !(i & bit)).map((i) => Math.hypot(s[i | bit].x - s[i].x, s[i | bit].y - s[i].y))));
  }
  return total;
}

let measureCtx: CanvasRenderingContext2D | null = null; // made on first use: this module is also loaded on the server
const textWidth = (text: string, font: string) => {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
};

/** One picture: the scene staged (`keep` as it is and outlined, `hide` hidden, the rest faint), from the best of
 * `dirs` at the largest of `fills` where every dimension finds a clean place (DimLayout); null when none does. */
async function view(shot: Shot, o: { keep: Set<Mesh>; hide: Set<Mesh>; outline: Mesh[]; measures: Measure[]; frame: Box3; fills: number[]; dirs: Vector3[]; lang: "ar" | "en"; warning?: string; legend?: boolean; size?: number }): Promise<Blob | null> {
  const { renderer, scene, camera, all } = shot;
  const size = o.size ?? W; // square, px; the text stays TEXT.size, so a smaller picture reads larger on the page
  renderer.setSize(size, size, false);
  const colorOf = new Map<Mesh, string>();
  for (const m of o.measures) for (const mesh of m.meshes ?? []) colorOf.set(mesh, m.color);
  const restore = stage(all, o.keep, o.hide, o.outline, scene, (mesh) => (o.legend ? colorOf.get(mesh) ?? NAVY : "#334155"));
  try {
    const font = `700 ${TEXT.size}px ${FONT}`;
    const keyRows = o.legend ? o.measures.map((m) => m.name ?? "") : [];
    const ranked = o.measures.length
      ? [...o.dirs].map((dir) => { fit(camera, o.frame, dir, o.fills[0]); return { dir, score: score(camera, o.measures) }; }).sort((a, b) => b.score - a.score).slice(0, 3).map((r) => r.dir)
      : o.dirs;
    for (const fill of o.fills) {
      for (const dir of ranked) {
        fit(camera, o.frame, dir, fill);
        const layout = new DimLayout({ w: size, h: size }, mask(shot, o.keep, camera, size));
        const key = keyRect(keyRows, o.lang, size);
        if (key) layout.block(key);
        const notice = o.warning ? { x: size / 2 - textWidth(o.warning, font) / 2 - TEXT.pad, y: 30, width: textWidth(o.warning, font) + 2 * TEXT.pad, height: TEXT.height } : null;
        if (notice) layout.block(notice);
        const ok = o.measures.every((m) => {
          const s = m.corners.map((c) => toScreen(camera, c, size));
          return m.texts.every((text, axis) => !text || layout.place(s, axis as 0 | 1 | 2, text, textWidth(text, font) + 2 * TEXT.pad, TEXT.height, m.color));
        });
        if (!ok) continue;
        renderer.render(scene, camera);
        return await annotate(renderer.domElement, size, (ctx) => {
          drawDims(ctx, layout.dims, o.lang);
          if (key) drawKey(ctx, key, o.measures, o.lang);
          if (notice && o.warning) label(ctx, notice, o.warning, "#b42318", o.lang);
        });
      }
    }
    return null;
  } finally {
    restore();
    renderer.setSize(W, H, false);
  }
}

const BLACK = new MeshBasicMaterial({ color: 0x000000 });
const MASK_CELL = 8;
/** Where `keep` covers the picture from the camera: rendered flat black on white, scaled down to MASK_CELL squares
 * (a square is covered when any of its pixels is). The faint and hidden parts are free space. */
function mask(shot: Shot, keep: Set<Mesh>, camera: PerspectiveCamera | OrthographicCamera = shot.camera, size = W): Mask {
  const { renderer, scene, all } = shot;
  const was = all.map((m) => m.visible);
  const env = scene.environment;
  all.forEach((m) => (m.visible = keep.has(m)));
  scene.overrideMaterial = BLACK;
  scene.environment = null;
  try {
    renderer.render(scene, camera);
  } finally {
    scene.overrideMaterial = null;
    scene.environment = env;
    all.forEach((m, i) => (m.visible = was[i]));
  }
  const cols = Math.ceil(size / MASK_CELL), rows = Math.ceil(size / MASK_CELL);
  const small = document.createElement("canvas");
  small.width = cols;
  small.height = rows;
  const ctx = small.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "low";
  ctx.drawImage(renderer.domElement, 0, 0, cols, rows);
  const px = ctx.getImageData(0, 0, cols, rows).data;
  const data = new Uint8Array(cols * rows);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4] < 250 ? 1 : 0;
  return { cell: MASK_CELL, cols, rows, data };
}

/** The key's place (top corner on the reading side): one line a part, its colour and name. */
function keyRect(rows: string[], lang: "ar" | "en", size = W): Rect | null {
  if (!rows.length) return null;
  const width = Math.max(...rows.map((r) => textWidth(r, `700 ${TEXT.size}px ${FONT}`))) + 2 * TEXT.pad + 70;
  const height = rows.length * TEXT.height + 24;
  return { x: lang === "ar" ? size - 30 - width : 30, y: 30, width, height };
}

function drawKey(ctx: CanvasRenderingContext2D, r: Rect, measures: Measure[], lang: "ar" | "en") {
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, 18);
  ctx.fill();
  ctx.stroke();
  ctx.font = `700 ${TEXT.size}px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.direction = lang === "ar" ? "rtl" : "ltr";
  measures.forEach((m, i) => {
    const y = r.y + 12 + TEXT.height * (i + 0.5);
    const dot = lang === "ar" ? r.x + r.width - TEXT.pad - 18 : r.x + TEXT.pad + 18;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(dot, y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = lang === "ar" ? "right" : "left";
    ctx.fillText(m.name ?? "", lang === "ar" ? dot - 36 : dot + 36, y + 2);
  });
  ctx.direction = "ltr";
}

function label(ctx: CanvasRenderingContext2D, r: Rect, text: string, color: string, lang: "ar" | "en") {
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, 16);
  ctx.fill();
  ctx.stroke();
  ctx.font = `700 ${TEXT.size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = lang === "ar" ? "rtl" : "ltr";
  ctx.fillText(text, r.x + r.width / 2, r.y + r.height / 2 + 2);
  ctx.direction = "ltr";
}

function arrowHead(ctx: CanvasRenderingContext2D, tip: Pt, toward: Pt) {
  const angle = Math.atan2(tip.y - toward.y, tip.x - toward.x);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - ARROW * Math.cos(angle - 0.32), tip.y - ARROW * Math.sin(angle - 0.32));
  ctx.lineTo(tip.x - ARROW * Math.cos(angle + 0.32), tip.y - ARROW * Math.sin(angle + 0.32));
  ctx.closePath();
  ctx.fill();
}

/** Engineering dimensions: thin extension lines from the measured edge's ends, the dimension line with an arrow at
 * each end (outside, pointing in, on an edge too short for both), the length in a label beyond its middle. In three
 * passes so no line is drawn over a label. */
function drawDims(ctx: CanvasRenderingContext2D, dims: Dim[], lang: "ar" | "en") {
  for (const d of dims) {
    ctx.strokeStyle = "#64748b";
    ctx.lineWidth = 3;
    for (const [p, q] of [[d.from, d.a], [d.to, d.b]]) {
      ctx.beginPath();
      ctx.moveTo(p.x + d.n.x * 10, p.y + d.n.y * 10);
      ctx.lineTo(q.x + d.n.x * 18, q.y + d.n.y * 18);
      ctx.stroke();
    }
  }
  for (const d of dims) {
    ctx.strokeStyle = d.color;
    ctx.fillStyle = d.color;
    ctx.lineWidth = 5;
    const len = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) || 1;
    const u = { x: (d.b.x - d.a.x) / len, y: (d.b.y - d.a.y) / len };
    const tail = d.short ? ARROW + 30 : 0;
    ctx.beginPath();
    ctx.moveTo(d.a.x - u.x * tail, d.a.y - u.y * tail);
    ctx.lineTo(d.b.x + u.x * tail, d.b.y + u.y * tail);
    ctx.stroke();
    if (d.short) {
      arrowHead(ctx, d.a, { x: d.a.x - u.x, y: d.a.y - u.y });
      arrowHead(ctx, d.b, { x: d.b.x + u.x, y: d.b.y + u.y });
    } else {
      arrowHead(ctx, d.a, d.b);
      arrowHead(ctx, d.b, d.a);
    }
  }
  for (const d of dims) {
    if (!d.along) {
      label(ctx, d.label, d.text, d.color, lang);
      continue;
    }
    // Written along a vertical line, read from the bottom up.
    const { x, y, width, height } = d.label;
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate(-Math.PI / 2);
    label(ctx, { x: -height / 2, y: -width / 2, width: height, height: width }, d.text, d.color, lang);
    ctx.restore();
  }
}

async function annotate(gl: HTMLCanvasElement, size: number, draw: (ctx: CanvasRenderingContext2D) => void): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot draw the model views.");
  ctx.drawImage(gl, 0, 0);
  draw(ctx);
  const out = trim(canvas, ctx);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This browser could not encode the model views.");
  return blob;
}

/** The picture cut to what is drawn on it (the model, its lines and labels) and a margin: no empty page space, the
 * model printed as large as the page allows. */
function trim(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, margin = 48): HTMLCanvasElement {
  const { width, height } = canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      if (px[i] < 245 || px[i + 1] < 245 || px[i + 2] < 245) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  }
  if (x1 < 0) return canvas;
  [x0, y0, x1, y1] = [Math.max(0, x0 - margin), Math.max(0, y0 - margin), Math.min(width, x1 + margin), Math.min(height, y1 + margin)];
  const out = document.createElement("canvas");
  out.width = x1 - x0;
  out.height = y1 - y0;
  out.getContext("2d")!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

const PANE = W / 2;
/** Front, side (from the right) and top views, orthographic (true lengths), on one picture: front top left, side top
 * right, top under the front. Each with the overall sizes it shows (front: width and height; side: depth and height;
 * top: width and depth), the same texts as the closed view's. */
async function orthoViews(shot: Shot, box: Box3, texts: string[], lang: "ar" | "en"): Promise<Blob> {
  const { renderer, scene, all } = shot;
  const titles = lang === "ar" ? ["أمامي", "جانبي (يمين)", "علوي"] : ["Front", "Side (right)", "Top"];
  const panes: { dir: Vector3; up: Vector3; show: number[]; at: [number, number] }[] = [
    { dir: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0), show: [0, 1], at: [0, 0] },
    { dir: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0), show: [1, 2], at: [PANE, 0] },
    { dir: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1), show: [0, 2], at: [0, PANE] },
  ];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const font = `700 ${TEXT.size}px ${FONT}`;
  const restore = stage(all, new Set(all), new Set(), all, scene, () => "#334155");
  renderer.setSize(PANE, PANE, false);
  try {
    for (const [i, pane] of panes.entries()) {
      const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
      const center = box.getCenter(new Vector3());
      const reach = box.getSize(new Vector3()).length();
      camera.up.copy(pane.up);
      camera.position.copy(center).addScaledVector(pane.dir, reach * 2);
      camera.lookAt(center);
      camera.near = reach * 0.5;
      camera.far = reach * 4;
      camera.updateMatrixWorld(true);
      const local = corners(box).map((c) => c.applyMatrix4(camera.matrixWorldInverse));
      const half = Math.max(...local.map((c) => Math.max(Math.abs(c.x), Math.abs(c.y))));
      const title = { x: lang === "ar" ? PANE - 30 - textWidth(titles[i], font) - 2 * TEXT.pad : 30, y: 30, width: textWidth(titles[i], font) + 2 * TEXT.pad, height: TEXT.height };
      let layout: DimLayout | null = null;
      for (const fill of [0.62, 0.52, 0.42]) {
        [camera.left, camera.right, camera.top, camera.bottom] = [-half / fill, half / fill, half / fill, -half / fill];
        camera.updateProjectionMatrix();
        const tried = new DimLayout({ w: PANE, h: PANE }, mask(shot, new Set(all), camera, PANE));
        tried.block(title);
        const s = corners(box).map((c) => toScreen(camera, c, PANE));
        if (pane.show.every((axis) => tried.place(s, axis as 0 | 1 | 2, texts[axis], textWidth(texts[axis], font) + 2 * TEXT.pad, TEXT.height, NAVY))) {
          layout = tried;
          break;
        }
      }
      if (!layout) throw new Error("The model's front, side and top views could not be drawn clearly.");
      renderer.render(scene, camera);
      ctx.save();
      ctx.translate(...pane.at);
      ctx.drawImage(renderer.domElement, 0, 0);
      drawDims(ctx, layout.dims, lang);
      label(ctx, title, titles[i], "#64748b", lang);
      ctx.restore();
    }
  } finally {
    restore();
    renderer.setSize(W, H, false);
  }
  // Thin lines between the views.
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(PANE, 0);
  ctx.lineTo(PANE, H);
  ctx.moveTo(0, PANE);
  ctx.lineTo(W, PANE);
  ctx.stroke();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This browser could not encode the model views.");
  return blob;
}

/** The camera's frame for a few parts: their boxes, with a margin of the model's size around them. */
function frameOf(parts: ViewPart[], boxes: Map<string, Box3>, whole: Box3): Box3 {
  const box = parts.reduce((all, p) => all.union(boxes.get(p.id)!), new Box3());
  return box.expandByScalar(0.05 * Math.max(...whole.getSize(new Vector3()).toArray()));
}

const GHOST = new MeshBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.16, depthWrite: false });
/** Sets the scene for one view: `keep` as they are, `hide` hidden, everything else faint; `outline` edged in
 * `colorOf` (stronger contrast against the white). Returns what puts it all back. */
function stage(all: Mesh[], keep: Set<Mesh>, hide: Set<Mesh>, outline: Mesh[], scene: Scene, colorOf: (m: Mesh) => string): () => void {
  const was = all.map((m) => ({ m, material: m.material, visible: m.visible }));
  for (const m of all) {
    if (keep.has(m)) continue;
    if (hide.has(m)) m.visible = false;
    else m.material = GHOST;
  }
  const outlines: LineSegments[] = [];
  for (const m of outline) {
    if (!keep.has(m)) continue;
    const edges = new LineSegments(new EdgesGeometry(m.geometry, 30), new LineBasicMaterial({ color: colorOf(m) }));
    m.updateWorldMatrix(true, false);
    edges.matrixAutoUpdate = false;
    edges.matrix.copy(m.matrixWorld);
    scene.add(edges);
    outlines.push(edges);
  }
  return () => {
    for (const { m, material, visible } of was) {
      m.material = material;
      m.visible = visible;
    }
    for (const e of outlines) {
      scene.remove(e);
      e.geometry.dispose();
      (e.material as LineBasicMaterial).dispose();
    }
  };
}
