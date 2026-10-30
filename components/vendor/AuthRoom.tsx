"use client";

import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Box3, Vector3, type Mesh, type Object3D } from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera, useGLTF } from "@react-three/drei";
import { fetchCatalog } from "@/lib/plan/api";
import { normalizeModel } from "@/lib/plan/modelNormalization";
import type { CatalogModel } from "@/lib/plan/types";

/** Plan in metres, x to the right, z towards the viewer (same apartment the SVG used to draw). */
const T = 0.18;
const H = 2.4;
const ROOMS = [
  { x: 0, z: 0, w: 6, d: 5, fill: "#d9c6a5" }, // living
  { x: 6, z: 0, w: 4, d: 5, fill: "#e2d3b8" }, // kitchen
  { x: 0, z: 5, w: 5, d: 4, fill: "#cdb48e" }, // bedroom
  { x: 5, z: 5, w: 5, d: 4, fill: "#efe6d4" }, // bath + hall
];
const WALLS = [
  { x: 0, z: 0, w: 10, d: T },
  { x: 0, z: 0, w: T, d: 9 },
  { x: 6, z: 0, w: T, d: 3.4 },
  { x: 0, z: 5, w: 3.6, d: T },
  { x: 4.6, z: 5, w: 3.4, d: T },
  { x: 5, z: 5, w: T, d: 2.6 },
];

type Slot = {
  test: (m: CatalogModel) => boolean;
  /** Where the model's back sits (against a wall) and which way it faces (degrees about Y). */
  at: (size: { w: number; d: number }) => [number, number];
  rot: number;
  /** Placeholder box (w, h, d) while loading or when the catalogue has nothing for this slot. */
  box: [number, number, number];
  fill: string;
  /** Turn the model's tallest end (a bed's headboard) to the wall at x = 0; `at` then gets the
   * footprint in room axes (w along x). Catalogue models don't agree on which way they face. */
  headToWall?: boolean;
};

const has = (re: RegExp) => (m: CatalogModel) => re.test(`${m.title} ${m.category ?? ""}`);
// Order matters: a model goes to the first free slot it matches ("Tv table" is a table, not a TV).
const SLOTS: Slot[] = [
  // ponytail: bed hidden for now; to bring it back, restore this slot first and drop the bed filter in assign():
  // { test: has(/bed/i), at: ({ w }) => [T + w / 2, 7.1], rot: 0, box: [2.1, 0.5, 1.8], fill: "#f8fafc", headToWall: true },
  { test: has(/wardrobe|cupboard|closet/i), at: ({ w, d }) => [5 - d / 2, 5 + T + w / 2], rot: -90, box: [1.2, 2, 0.6], fill: "#cbd5e1" },
  { test: (m) => m.category === "table" || has(/table/i)(m), at: ({ d }) => [3, T + d / 2], rot: 0, box: [1.6, 0.5, 0.45], fill: "#ffffff" },
  { test: (m) => m.category === "tv", at: () => [3, T + 0.2], rot: 0, box: [1.4, 0.8, 0.08], fill: "#1f2937" },
  { test: has(/sofa|couch|chair|furniture/i), at: () => [3, 4], rot: 180, box: [2.6, 0.8, 0.9], fill: "#f2a33a" },
  { test: () => true, at: ({ d }) => [8, T + d / 2], rot: 0, box: [2.8, 0.9, 0.6], fill: "#94a3b8" },
];

// The TV stands on the TV table: their slots, by position in SLOTS.
const TABLE = 1;
const TV = TABLE + 1;

function assign(models: CatalogModel[]): (CatalogModel | null)[] {
  const pool = models.filter((m) => m.glb_url && m.width_m && m.height_m && m.depth_m && !has(/bed/i)(m));
  return SLOTS.map((slot) => {
    const i = pool.findIndex(slot.test);
    return i < 0 ? null : pool.splice(i, 1)[0];
  });
}

/** The sign-in banner's apartment, furnished with real catalogue models at their real sizes. */
export function AuthRoom({ className }: { className?: string }) {
  const [models, setModels] = useState<(CatalogModel | null)[]>(() => SLOTS.map(() => null));
  useEffect(() => {
    fetchCatalog()
      .then(({ companies }) => setModels(assign(companies.flatMap((c) => c.models))))
      .catch(() => {}); // the placeholder boxes stay
  }, []);
  // The TV stands on the TV table: centred on it, at the loaded table's measured height
  // (the scaled model can come out lower than its catalogue height).
  const table = models[TABLE];
  const [tableTop, setTableTop] = useState<number | null>(null);
  const tvSpot = SLOTS[TABLE].at(table ? { w: table.width_m!, d: table.depth_m! } : { w: SLOTS[TABLE].box[0], d: SLOTS[TABLE].box[2] });
  const tvY = table ? (tableTop ?? table.height_m!) : SLOTS[TABLE].box[1];

  return (
    <Canvas className={className} shadows dpr={[1, 2]} gl={{ alpha: true }}>
      <OrthographicCamera makeDefault position={[20, 16, 20]} />
      <Fit />
      <ambientLight intensity={0.6 * Math.PI} />
      <directionalLight position={[12, 18, 8]} intensity={0.7 * Math.PI} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} />
      <group position={[-5, 0, -4.5]}>
        <mesh position={[5, -0.18, 4.5]} receiveShadow>
          <boxGeometry args={[10.6, 0.35, 9.6]} />
          <meshStandardMaterial color="#24314d" />
        </mesh>
        {ROOMS.map((r) => (
          <mesh key={`${r.x}-${r.z}`} position={[r.x + r.w / 2, 0.001, r.z + r.d / 2]} rotation-x={-Math.PI / 2} receiveShadow>
            <planeGeometry args={[r.w, r.d]} />
            <meshStandardMaterial color={r.fill} />
          </mesh>
        ))}
        {WALLS.map((b, i) => (
          <mesh key={i} position={[b.x + b.w / 2, H / 2, b.z + b.d / 2]} castShadow receiveShadow>
            <boxGeometry args={[b.w, H, b.d]} />
            <meshStandardMaterial color="#f1ede6" />
          </mesh>
        ))}
        {SLOTS.map((slot, i) => (
          <Furniture
            key={models[i]?.id ?? i}
            slot={i === TV ? { ...slot, at: () => tvSpot } : slot}
            model={models[i]}
            y={i === TV ? tvY : 0}
            onHeight={i === TABLE ? setTableTop : undefined}
          />
        ))}
      </group>
      {/* Seen from the open front only: the back walls would hide the furniture. */}
      <OrbitControls enableZoom={false} enablePan={false} minPolarAngle={0.8} maxPolarAngle={1.1} minAzimuthAngle={Math.PI / 4 - 0.5} maxAzimuthAngle={Math.PI / 4 + 0.5} />
    </Canvas>
  );
}

/** Zoom so the apartment fills the panel at any rotation (its diagonal is ~14 m, its height ~10 m). */
function Fit() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.zoom = Math.min(size.width / 14.5, size.height / 10);
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function Furniture({ slot, model, y, onHeight }: { slot: Slot; model: CatalogModel | null; y: number; onHeight?: (h: number) => void }) {
  const placeholder = <Placeholder slot={slot} y={y} />;
  if (!model) return placeholder;
  return (
    <Fallback fallback={placeholder}>
      <Suspense fallback={placeholder}>
        <Model slot={slot} model={model} y={y} onHeight={onHeight} />
      </Suspense>
    </Fallback>
  );
}

function Model({ slot, model, y, onHeight }: { slot: Slot; model: CatalogModel; y: number; onHeight?: (h: number) => void }) {
  const { scene } = useGLTF(model.glb_url);
  const { object, height } = useMemo(() => {
    const { object, report } = normalizeModel(scene, { width: model.width_m!, height: model.height_m!, depth: model.depth_m! }, model.id);
    object.traverse((o) => (o.castShadow = o.receiveShadow = true));
    return { object, height: report.finalSize.height };
  }, [scene, model]);
  const turn = useMemo(() => (slot.headToWall ? headboardTurn(object) : (slot.rot * Math.PI) / 180), [object, slot]);
  useEffect(() => onHeight?.(height), [onHeight, height]);
  const sideways = Math.abs(Math.sin(turn)) > 0.5;
  const footprint = slot.headToWall && sideways ? { w: model.depth_m!, d: model.width_m! } : { w: model.width_m!, d: model.depth_m! };
  const [x, z] = slot.at(footprint);
  return <primitive object={object} position={[x, y, z]} rotation-y={turn} />;
}

/** Y rotation that points the side with the most tall geometry (a headboard) at −x. */
function headboardTurn(object: Object3D): number {
  object.updateMatrixWorld(true);
  const box = new Box3().setFromObject(object);
  const top = box.min.y + 0.6 * (box.max.y - box.min.y);
  const centre = box.getCenter(new Vector3());
  const v = new Vector3();
  let sx = 0;
  let sz = 0;
  object.traverse((o) => {
    const pos = (o as Mesh).isMesh ? (o as Mesh).geometry.attributes.position : null;
    if (!pos) return;
    for (let i = 0; i < pos.count; i += 5) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y > top) {
        sx += v.x - centre.x;
        sz += v.z - centre.z;
      }
    }
  });
  // rotation.y by θ maps (x, z) → (x cosθ + z sinθ, −x sinθ + z cosθ).
  if (Math.abs(sx) >= Math.abs(sz)) return sx <= 0 ? 0 : Math.PI;
  return sz < 0 ? Math.PI / 2 : -Math.PI / 2;
}

function Placeholder({ slot, y = 0 }: { slot: Slot; y?: number }) {
  const [w, h, d] = slot.box;
  const [x, z] = slot.at({ w, d });
  return (
    <mesh position={[x, y + h / 2, z]} rotation-y={(slot.rot * Math.PI) / 180} castShadow>
      <boxGeometry args={slot.box} />
      <meshStandardMaterial color={slot.fill} />
    </mesh>
  );
}

/** A model that fails to load falls back to its placeholder box instead of breaking the page. */
class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
