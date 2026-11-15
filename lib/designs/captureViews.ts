import { Box3, DirectionalLight, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, NeutralToneMapping, PerspectiveCamera, PMREMGenerator, Raycaster, SRGBColorSpace, Scene, Vector3, WebGLRenderer, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { normalizeModel, uniformFactor } from "@/lib/plan/modelNormalization";
import { applyAnimations, attachmentsFrom, enabledAnimations, refine } from "@/lib/vendor/animation";
import type { ItemDesign } from "@/lib/designs/schema";
import { fmt, labelLines, partsTable, placeNear, PARTS_SHEET, PICTURE, VIEWS_VERSION, type NearLabel, type ViewPart } from "@/lib/designs/viewParts";

/** The pictures of a saved customised model for its implementation request: closed with its overall size; opened
 * (every movable part) with each part's dimensions written beside it; and close-ups for the parts whose labels do not
 * fit clearly in the opened picture. Rendered from the saved version's own file in a scene of their own (the editor's
 * scene and open / closed state are never touched), the same way every time. Throws when the file or any saved part
 * is missing: a request never goes out with an incomplete report. */
export type CapturedViews = { pictures: Blob; overall: { width: number; height: number; depth: number }; closed: Blob; open: Blob; details: Blob[]; detailGroups: string[]; parts: ViewPart[]; scaleKnown: boolean; opened: number; version: number };

const { W, H } = PICTURE;
const MAX_DETAILS = 12;
/** Labels in the opened picture and in each close-up: a picture stays readable; the rest get close-ups. */
const PER_VIEW = 6; // labels in one picture at most: readable, never crowded
const NAVY = "#172033";
const AMBER = "#f2a33a";
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
    scene.environmentIntensity = 0.85;
    const key = new DirectionalLight(0xffffff, 0.75);
    key.position.set(4, 8, 6);
    const fill = new DirectionalLight(0xffffff, 0.3);
    fill.position.set(-5, 3, 4);
    scene.add(key, fill, sized);
    const meshesOf = new Map<string, Mesh[]>();
    for (const s of slots) meshesOf.set(s.id, [...(meshesOf.get(s.id) ?? []), s.mesh]);

    // 0. Each main part on its own (the model at rest): the others hidden, the part turned to show its face and
    // its thickness, fitted to its square, with its own material. One sheet (PARTS_SHEET), cell `pic`.
    // A part's picture shows what rides on it too (a door with its mirror, frame and handle), as it is built.
    const carried = new Map(enabledAnimations(config).map((a) => [a.component, a.follow]));
    const pictures = await partPictures(renderer, scene, parts, (id) => [id, ...(carried.get(id) ?? [])].flatMap((x) => meshesOf.get(x) ?? []), slots.map((s) => s.mesh));
    renderer.setSize(W, H, false);

    const camera = new PerspectiveCamera(30, W / H, 0.01, 1000);

    // 1. Closed: a three-quarter view from the front right, the model filling most of the picture, only its
    // overall size on its outer edges.
    fit(camera, whole, new Vector3(1.1, 0.7, 1.9), 0.74);
    renderer.render(scene, camera);
    const closed = await annotate(renderer.domElement, (ctx) => overall(ctx, camera, whole, scaleKnown, lang));

    // 2. Opened: every movable part open; of a few views from the front, the one that shows the most parts. The
    // overview gives the main structure's sizes; each group of parts then gets views of its own (below).
    const opened = enabledAnimations(config);
    const moved = new Set(opened.flatMap((a) => [a.component, ...a.follow])); // their open box is not their own edges
    const doors = new Set(opened.filter((a) => a.type === "rotation").flatMap((a) => [a.component, ...a.follow]));
    applyAnimations(slots, model, config, Object.fromEntries(opened.map((a) => [a.id, 1])));
    sized.updateMatrixWorld(true);
    const openBox = new Box3().setFromObject(sized);
    const boxes = new Map<string, Box3>();
    for (const s of slots) boxes.set(s.id, (boxes.get(s.id) ?? new Box3()).union(new Box3().setFromObject(s.mesh)));
    const labelled = parts.filter((p) => p.shown && boxes.has(p.id));
    const dirs = opened.length ? [[0.55, 0.45, 1.5], [-0.55, 0.45, 1.5], [0.25, 0.3, 1.6], [0.9, 0.6, 1.3], [-0.9, 0.6, 1.3]] : [[-1, 0.55, 1.4], [-0.6, 0.9, 1.2]];
    let best = { dir: new Vector3(...dirs[0]), seen: -1 };
    for (const v of dirs) {
      const dir = new Vector3(...v);
      fit(camera, openBox, dir, 0.76);
      const seen = labelled.filter((p) => visible(camera, boxes.get(p.id)!, meshesOf.get(p.id)!, sized)).length;
      if (seen > best.seen) best = { dir, seen };
    }
    const all = slots.map((s) => s.mesh);
    const done = new Set<string>();
    /** One view: `keep` measured (their own materials, outlined), doors hidden when `hideDoors`, the rest faint;
     * the camera on `box`; each label beside its part (placeNear). Returns the picture and the parts labelled. */
    const view = async (measured: ViewPart[], box: Box3, fill: number, hideDoors: boolean) => {
      const keep = new Set(measured.flatMap((p) => meshesOf.get(p.id) ?? []));
      const restore = stage(all, keep, hideDoors ? new Set([...doors].flatMap((id) => meshesOf.get(id) ?? [])) : new Set(), measured, meshesOf, scene);
      try {
        fit(camera, box, best.dir, fill);
        renderer.render(scene, camera);
      } finally {
        restore();
      }
      let placed: string[] = [];
      const blob = await annotate(renderer.domElement, (ctx) => {
        placed = labels(ctx, camera, measured, boxes, lang, moved);
        legend(ctx, lang);
      });
      placed.forEach((id) => done.add(id));
      return { blob, placed };
    };
    // The overview: the body's main parts (the largest few), the whole open model in view.
    const structure = labelled.filter((p) => p.group === "structure").sort((a, b) => volume(b) - volume(a)).slice(0, PER_VIEW);
    const open = (await view(structure, openBox, 0.76, false)).blob;

    // 3. Details: each group (doors, drawers, shelves, the rest of the body, other parts) a few near each other per
    // view, framed on them; what is in the way faint or hidden (doors, for what is inside). Until every part has its
    // dimensions written in a picture; a crowded view is split, its text never made smaller.
    const details: Blob[] = [];
    const detailGroups: string[] = [];
    for (const group of ["doors", "drawers", "shelves", "structure", "accessories"]) {
      let left = labelled.filter((p) => p.group === group && !done.has(p.id));
      while (left.length) {
        if (details.length >= MAX_DETAILS) throw new Error(`Too many parts to show clearly (${left.length} left after ${MAX_DETAILS} detail views).`);
        const first = left.reduce((m, p) => (centerOf(boxes, p).y > centerOf(boxes, m).y ? p : m), left[0]); // from the top
        const near = [...left].sort((a, b) => centerOf(boxes, a).distanceTo(centerOf(boxes, first)) - centerOf(boxes, b).distanceTo(centerOf(boxes, first)));
        let cluster = near.slice(0, PER_VIEW);
        let shot = await view(cluster, frameOf(cluster, boxes, openBox), 0.66, group !== "doors");
        while (!shot.placed.length && cluster.length > 1) {
          cluster = cluster.slice(0, Math.ceil(cluster.length / 2)); // too crowded: fewer parts, the same text size
          shot = await view(cluster, frameOf(cluster, boxes, openBox), 0.66, group !== "doors");
        }
        if (!shot.placed.length) throw new Error("A part's dimensions could not be shown clearly.");
        details.push(shot.blob);
        detailGroups.push(group);
        left = left.filter((p) => !done.has(p.id));
      }
    }
    // Every part the table marks as shown has its dimensions written in one of the pictures.
    const missingLabels = labelled.filter((p) => !done.has(p.id));
    if (missingLabels.length) throw new Error(`The dimensions of ${missingLabels.length} part(s) could not be drawn (${missingLabels.slice(0, 3).map((p) => p.name).join(", ")}).`);
    // The model's own size (cm, closed), as measured from the same geometry as every part's.
    const size = whole.getSize(new Vector3()).multiplyScalar(100);
    const measured = { width: Math.round(size.x * 10) / 10, height: Math.round(size.y * 10) / 10, depth: Math.round(size.z * 10) / 10 };
    return { pictures, overall: measured, closed, open, details, detailGroups, parts, scaleKnown, opened: opened.length, version: VIEWS_VERSION };
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

const volume = (p: ViewPart) => p.width * p.height * p.depth;
const centerOf = (boxes: Map<string, Box3>, p: ViewPart) => boxes.get(p.id)!.getCenter(new Vector3());

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

async function annotate(gl: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D) => void): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the model views.");
  ctx.drawImage(gl, 0, 0);
  draw(ctx);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This browser could not encode the model views.");
  return blob;
}

const toScreen = (camera: PerspectiveCamera, p: Vector3) => {
  const v = p.clone().project(camera);
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
};

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color = NAVY) {
  ctx.font = `700 60px ${FONT}`;
  const w = ctx.measureText(text).width + 48;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 42, w, 84, 42);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 1);
}

function arrowLine(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, color: string, width: number, head: number) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  for (const [p, dir] of [[a, angle + Math.PI], [b, angle]] as const) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - head * Math.cos(dir - 0.35), p.y - head * Math.sin(dir - 0.35));
    ctx.lineTo(p.x - head * Math.cos(dir + 0.35), p.y - head * Math.sin(dir + 0.35));
    ctx.closePath();
    ctx.fill();
  }
}

/** A dimension line from a to b set off by `off` (all world points): extension lines, arrows, the length on it. */
function dimension(ctx: CanvasRenderingContext2D, camera: PerspectiveCamera, a: Vector3, b: Vector3, off: Vector3, text: string) {
  const [pa, pb, qa, qb] = [a, b, a.clone().add(off), b.clone().add(off)].map((p) => toScreen(camera, p));
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  for (const [p, q] of [[pa, qa], [pb, qb]]) {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  arrowLine(ctx, qa, qb, NAVY, 6, 40);
  pill(ctx, (qa.x + qb.x) / 2, (qa.y + qb.y) / 2, text);
}

/** Width along the front bottom edge, height up the front left edge, depth along the right bottom edge: each set off
 * outside the model. */
function overall(ctx: CanvasRenderingContext2D, camera: PerspectiveCamera, box: Box3, known: boolean, lang: "ar" | "en") {
  const s = box.getSize(new Vector3());
  const off = 0.06 * Math.max(s.x, s.y, s.z);
  const { min, max } = box;
  const word = lang === "ar" ? { w: "العرض", h: "الارتفاع", d: "العمق", cm: "سم" } : { w: "W", h: "H", d: "D", cm: "cm" };
  const label = (k: string, m: number) => `${k} ${known ? "" : "≈"}${fmt(m * 100)} ${word.cm}${known ? "" : " ?"}`;
  dimension(ctx, camera, new Vector3(min.x, min.y, max.z), new Vector3(max.x, min.y, max.z), new Vector3(0, -off * 0.3, off), label(word.w, s.x));
  dimension(ctx, camera, new Vector3(min.x, min.y, max.z), new Vector3(min.x, max.y, max.z), new Vector3(-off, 0, off * 0.3), label(word.h, s.y));
  dimension(ctx, camera, new Vector3(max.x, min.y, max.z), new Vector3(max.x, min.y, min.z), new Vector3(off, -off * 0.3, 0), label(word.d, s.z));
  if (!known) pill(ctx, W / 2, 56, lang === "ar" ? "المقاس الحقيقي غير معروف: أكّد كل المقاسات" : "Real size unknown: confirm every dimension", "#b42318");
}

const LABEL = { size: 52, small: 42, line: 64, pad: 26 }; // px on the 2400 px picture: about 10–11 pt printed

/** The labels, each beside its part (placeNear: inside the picture, none on another, no leader crossing another), a
 * leader to the part and its width marked on its front edge with arrows. Drawn after the open poses, from the camera
 * that took the picture. Only sizes (no names: the components table names the parts). Returns the ids labelled. */
function labels(ctx: CanvasRenderingContext2D, camera: PerspectiveCamera, parts: ViewPart[], boxes: Map<string, Box3>, lang: "ar" | "en", moved: Set<string>): string[] {
  const lines = new Map(parts.map((p) => [p.id, labelLines(p, lang).slice(1)]));
  const items: NearLabel[] = parts.map((part) => {
    const text = lines.get(part.id)!;
    const width = Math.max(...text.map((l, i) => { ctx.font = `${i === 0 ? 700 : 600} ${i === 0 ? LABEL.size : LABEL.small}px ${FONT}`; return ctx.measureText(l).width; })) + 2 * LABEL.pad;
    const box = boxes.get(part.id)!;
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => toScreen(camera, new Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)));
    const rect = { x0: Math.min(...corners.map((c) => c.x)), y0: Math.min(...corners.map((c) => c.y)), x1: Math.max(...corners.map((c) => c.x)), y1: Math.max(...corners.map((c) => c.y)) };
    return { id: part.id, part: rect, anchor: toScreen(camera, box.getCenter(new Vector3())), width, height: 16 + text.length * LABEL.line };
  });
  const { placed } = placeNear(items, { w: W, h: H });
  const byId = new Map(parts.map((p) => [p.id, p]));
  ctx.direction = lang === "ar" ? "rtl" : "ltr";
  // In three passes, so nothing is drawn over a label: the width arrows, the leaders, then the labels.
  for (const it of placed) {
    const box = boxes.get(it.id)!;
    const color = byId.get(it.id)!.added ? AMBER : NAVY;
    // Engineering style: the part's width along its front top edge, arrows at both ends (not on a part standing open).
    const a = toScreen(camera, new Vector3(box.min.x, box.max.y, box.max.z)), b = toScreen(camera, new Vector3(box.max.x, box.max.y, box.max.z));
    if (!moved.has(it.id) && Math.hypot(b.x - a.x, b.y - a.y) > 60) arrowLine(ctx, a, b, color, 5, 30);
  }
  for (const it of placed) {
    const color = byId.get(it.id)!.added ? AMBER : NAVY;
    const ex = Math.min(Math.max(it.anchor.x, it.x), it.x + it.width), ey = Math.min(Math.max(it.anchor.y, it.y), it.y + it.height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(it.anchor.x, it.anchor.y);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(it.anchor.x, it.anchor.y, 11, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const it of placed) {
    const color = byId.get(it.id)!.added ? AMBER : NAVY;
    ctx.strokeStyle = color;
    ctx.fillStyle = "rgba(255,255,255,0.97)";
    ctx.beginPath();
    ctx.roundRect(it.x, it.y, it.width, it.height, 18);
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    lines.get(it.id)!.forEach((line, i) => {
      ctx.font = `${i === 0 ? 700 : 600} ${i === 0 ? LABEL.size : LABEL.small}px ${FONT}`;
      ctx.fillStyle = i === 0 ? NAVY : "#9a5b0b";
      ctx.fillText(line, it.x + it.width / 2, it.y + 8 + LABEL.line / 2 + i * LABEL.line);
    });
  }
  ctx.direction = "ltr";
  return placed.map((p) => p.id);
}

/** The camera's frame for a few parts: their boxes, with a margin of the model's size around them. */
function frameOf(parts: ViewPart[], boxes: Map<string, Box3>, whole: Box3): Box3 {
  const box = parts.reduce((all, p) => all.union(boxes.get(p.id)!), new Box3());
  return box.expandByScalar(0.08 * Math.max(...whole.getSize(new Vector3()).toArray()));
}

const GHOST = new MeshBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.16, depthWrite: false });
/** Sets the scene for one view: the measured parts as they are, outlined (navy; orange for what the customer added);
 * `hide` hidden (doors in front of what is inside); everything else faint. Returns what puts it all back. */
function stage(all: Mesh[], keep: Set<Mesh>, hide: Set<Mesh>, measured: ViewPart[], meshesOf: Map<string, Mesh[]>, scene: Scene): () => void {
  const was = all.map((m) => ({ m, material: m.material, visible: m.visible }));
  for (const m of all) {
    if (keep.has(m)) continue;
    if (hide.has(m)) m.visible = false;
    else m.material = GHOST;
  }
  const outlines: LineSegments[] = [];
  for (const p of measured) {
    for (const m of meshesOf.get(p.id) ?? []) {
      const edges = new LineSegments(new EdgesGeometry(m.geometry, 30), new LineBasicMaterial({ color: p.added ? 0xe8952a : 0x172033 }));
      m.updateWorldMatrix(true, false);
      edges.matrixAutoUpdate = false;
      edges.matrix.copy(m.matrixWorld);
      scene.add(edges);
      outlines.push(edges);
    }
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

/** The key: what the colours mean. */
function legend(ctx: CanvasRenderingContext2D, lang: "ar" | "en") {
  const items = lang === "ar" ? [["أصلي", NAVY], ["مضاف", AMBER]] : [["Original", NAVY], ["Added", AMBER]];
  ctx.font = `600 34px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let x = 48;
  for (const [text, color] of items) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + 16, H - 52, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = NAVY;
    ctx.fillText(text, x + 44, H - 50);
    x += 76 + ctx.measureText(text).width;
  }
}
