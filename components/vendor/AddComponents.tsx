"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { Edges, Html, Line } from "@react-three/drei";
import { Box3, Matrix4, Mesh, MeshStandardMaterial, Raycaster, Vector2, Vector3, type Material, type Object3D } from "three";
import { Copy, Move, Paintbrush, Plus, Redo2, RotateCw, Search, Trash2, Undo2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import type { Slot } from "./ModelViewer";
import { DIRECTIONS, withDirection, withHinge, type AnimationConfig, type PartAnimation } from "@/lib/vendor/animation";
import { blocker, buildGeometry, carryChildren, compartmentAt, componentDef, fit, moveTo, offsetAxis, offsetsOf, resizeTo, SIDES, specBox, suggested, withOffset, type AddedSpec, type Side, type ComponentDef, type Fit, type Hit, type Probe, type Surroundings } from "@/lib/vendor/parts3d";

/** Adding parts to any model (shelves, drawers, doors, rails, handles, legs…): a picture gallery, drag-and-drop (or
 * tap, then tap the model) with a live green / red preview fitted to the compartment under the pointer and its sizes on
 * the model, then a small toolbar to resize, duplicate, move or delete. Added parts are real parts (materials, the
 * parts list, export) and saved as parametric data (PartDocument.added) so they are regenerated, never stretched. */

type SlotLike = Slot;
/** `hitAt` "structure": the stationary body only (rays pass through doors and drawers, open or closed); "all": any
 * part (a handle goes on a door's face). `probe` measures the structure only. `around`: the fronts and sweeps (rest). */
export type Picker = { hitAt: (clientX: number, clientY: number, scope: "structure" | "all") => Hit | null; probe: Probe; probeWithout: (ids: Set<string>) => Probe; mpu: () => Vector3; around: () => Surroundings };

/** Inside the Canvas: turns screen points into hits on the model (its own coordinates) and measures with rays. */
export function PickerBridge({ onReady, root, meshes, structure, idOf, around, restOf }: { onReady: (picker: Picker | null) => void; root: Object3D | null; meshes: () => Mesh[]; structure: () => Mesh[]; idOf: (mesh: Mesh) => string | null; around: () => Surroundings; restOf: (mesh: Mesh) => Matrix4 | null }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    if (!root) return;
    const ray = new Raycaster();
    const toModel = () => {
      root.updateMatrixWorld(true);
      return root.matrixWorld.clone().invert();
    };
    const cast = (targets: Mesh[], origin: Vector3, direction: Vector3) => {
      const from = origin.clone().applyMatrix4(root.matrixWorld);
      const to = origin.clone().add(direction).applyMatrix4(root.matrixWorld);
      ray.set(from, to.sub(from).normalize());
      const hit = ray.intersectObjects(targets, false).find((h) => h.object.visible);
      return hit ? { distance: hit.point.clone().applyMatrix4(toModel()).distanceTo(origin), partId: idOf(hit.object as Mesh) } : null;
    };
    onReady({
      hitAt: (x, y, scope) => {
        const rect = gl.domElement.getBoundingClientRect();
        ray.setFromCamera(new Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera);
        const hit = ray.intersectObjects(scope === "all" ? meshes() : structure(), false).find((h) => h.object.visible);
        if (!hit) return null;
        const inv = toModel();
        // Where that surface is with its part at rest (an open door: closed), so its movement is not applied twice.
        const rest = restOf(hit.object as Mesh) ?? new Matrix4();
        const normal = (hit.face?.normal.clone() ?? new Vector3(0, 0, 1)).transformDirection(hit.object.matrixWorld).transformDirection(rest).transformDirection(inv).normalize();
        return { point: hit.point.clone().applyMatrix4(rest).applyMatrix4(inv), normal, partId: idOf(hit.object as Mesh) };
      },
      probe: (origin, direction) => cast(structure(), origin, direction),
      probeWithout: (ids) => (origin, direction) => cast(structure().filter((m) => !ids.has(idOf(m) ?? "")), origin, direction),
      mpu: () => {
        root.updateMatrixWorld(true);
        return new Vector3().setFromMatrixScale(root.matrixWorld);
      },
      around,
    });
    return () => onReady(null);
  }, [onReady, root, meshes, structure, idOf, around, restOf, camera, gl]);
  return null;
}

/** On the model: the component's box (green: fits, red: does not), its width, height and depth, and the free space. */
export function PlacementOverlay({ root, box, space, valid, mpu, unit, ghost, onLabel, axis: along = 1, onOffset }: { root: Object3D; box: Box3; space?: Box3; valid: boolean; mpu: Vector3; unit: "m" | "cm"; ghost: boolean; onLabel?: (axis: 0 | 1 | 2) => void; axis?: 0 | 1; onOffset?: (side: Side) => void }) {
  const matrix = useMemo(() => new Matrix4().copy(root.matrixWorld), [root, box]); // eslint-disable-line react-hooks/exhaustive-deps
  const size = box.getSize(new Vector3());
  const c = box.getCenter(new Vector3());
  const ink = valid ? "#16a34a" : "#dc2626";
  const label = (v: number) => (unit === "cm" ? `${Math.round(v * 100)} cm` : `${v.toFixed(2)} m`);
  const tag = `whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white shadow ${valid ? "bg-green-600" : "bg-red-600"} ${onLabel ? "cursor-pointer" : "pointer-events-none"}`;
  const at: [0 | 1 | 2, [number, number, number]][] = [
    [0, [c.x, box.max.y, box.max.z]],
    [1, [box.max.x, c.y, box.max.z]],
    [2, [box.max.x, box.max.y, c.z]],
  ];
  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <mesh position={c} raycast={() => undefined}>
        <boxGeometry args={[size.x, size.y, size.z]} />
        <meshBasicMaterial color={ink} transparent opacity={ghost ? 0.35 : 0.08} depthWrite={false} />
        <Edges color={ink} />
      </mesh>
      {space && (
        <mesh position={space.getCenter(new Vector3())} raycast={() => undefined}>
          <boxGeometry args={space.getSize(new Vector3()).toArray()} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          <Edges color="#0ea5e9" />
        </mesh>
      )}
      {space && (
        // The free space found (the compartment), under the part's own sizes.
        <Html position={[space.min.x, space.min.y, space.max.z]} zIndexRange={[20, 0]}>
          <span className="pointer-events-none whitespace-nowrap rounded-md bg-sky-600 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow">
            ⬚ {[0, 1, 2].map((axis) => label(space.getSize(new Vector3()).getComponent(axis) * mpu.getComponent(axis))).join(" × ")}
          </span>
        </Html>
      )}
      {space && (() => {
        // Its distances to the compartment's inside faces along the axis it is placed on (Top / Bottom Offset for
        // shelves, Left / Right for dividers): dimension lines, labels that can be clicked to type a value.
        const o = offsetsOf({ size: size.toArray() as [number, number, number], center: c.toArray() as [number, number, number] }, space);
        const sides: Side[] = along === 1 ? ["top", "bottom"] : ["left", "right"];
        return sides.map((side) => {
          const [axis, sign] = SIDES[side];
          const from = c.clone().setComponent(axis, sign > 0 ? box.max.getComponent(axis) : box.min.getComponent(axis));
          const to = from.clone().setComponent(axis, sign > 0 ? space.max.getComponent(axis) : space.min.getComponent(axis));
          if (o[side] < 1e-4) return null;
          const mid = from.clone().add(to).multiplyScalar(0.5);
          const arrow = { top: "↑", bottom: "↓", left: "←", right: "→", front: "", back: "" }[side];
          return (
            <group key={side}>
              <Line points={[from, to]} color="#0ea5e9" lineWidth={1.5} dashed dashSize={0.01 / mpu.y} gapSize={0.006 / mpu.y} />
              <Html position={mid} center zIndexRange={[20, 0]}>
                <button type="button" onClick={() => onOffset?.(side)} className={`whitespace-nowrap rounded-md bg-sky-600 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow ${onOffset ? "cursor-pointer" : "pointer-events-none"}`}>
                  {arrow} {label(o[side] * mpu.getComponent(axis))}
                </button>
              </Html>
            </group>
          );
        });
      })()}
      {at.map(([axis, p]) => (
        <Html key={axis} position={p} center zIndexRange={[20, 0]}>
          <button type="button" className={tag} onClick={() => onLabel?.(axis)}>
            {["W", "H", "D"][axis]} {label(size.getComponent(axis) * mpu.getComponent(axis))}
          </button>
        </Html>
      ))}
    </group>
  );
}

/** The gallery's pictures: simple drawings of each component. */
function Thumb({ type }: { type: string }) {
  const s = "stroke-slate-500 fill-white";
  const shapes: Record<string, ReactNode> = {
    shelf: <><path d="M6 30 L30 22 L58 28 L34 36 Z" className={s} /><path d="M6 30 v4 L34 40 v-4 M34 40 L58 32 v-4" className={s} /></>,
    divider: <><path d="M26 8 L38 12 V56 L26 52 Z" className={s} /><path d="M38 12 L42 11 V55 L38 56" className={s} /></>,
    drawer: <><path d="M10 26 L30 20 L56 26 L36 32 Z" className="fill-slate-100 stroke-slate-500" /><path d="M10 26 V44 L36 50 V32 Z" className={s} /><path d="M36 32 L56 26 V44 L36 50" className={s} /><path d="M18 38 h10" className="stroke-slate-600" strokeWidth="2" /></>,
    door: <><rect x="20" y="6" width="24" height="52" rx="1" className={s} /><rect x="24" y="10" width="16" height="44" className="fill-none stroke-slate-300" /><circle cx="40" cy="33" r="1.6" className="fill-slate-500" /></>,
    rod: <><path d="M8 40 L56 24" className="stroke-slate-500" strokeWidth="4" strokeLinecap="round" /><path d="M8 40 L56 24" className="stroke-white" strokeWidth="1.5" strokeLinecap="round" /></>,
    back: <><path d="M14 10 L50 16 V54 L14 48 Z" className="fill-slate-100 stroke-slate-500" /></>,
    handle: <><path d="M14 36 V30 H50 V36" className="fill-none stroke-slate-500" strokeWidth="3" strokeLinejoin="round" /></>,
    leg: <><path d="M26 10 h12 l-2 44 h-8 Z" className={s} /></>,
  };
  return <svg viewBox="0 0 64 64" className="size-12" strokeWidth="1.5" aria-hidden>{shapes[type] ?? <rect x="16" y="16" width="32" height="32" className={s} />}</svg>;
}

const DRAG_TYPE = "application/x-sha2ty-component";

/** The editor's "Add parts" state and actions (see the file comment). */
export function useComponentEditor({ slots, setSlots, root, anim, setAnim, saved, objectType, onBuilt }: {
  slots: SlotLike[];
  setSlots: (next: SlotLike[]) => void;
  root: Object3D | null;
  anim: AnimationConfig | null;
  setAnim: (next: AnimationConfig | null) => void;
  saved: AddedSpec[] | undefined;
  objectType: string | undefined;
  /** A part was built or rebuilt here: the viewer records its rest pose and original material (resets, animations). */
  onBuilt: (mesh: Mesh, id: string) => void;
}) {
  const [added, setAdded] = useState<AddedSpec[]>(() => saved ?? []);
  const past = useRef<AddedSpec[][]>([]);
  const future = useRef<AddedSpec[][]>([]);
  const [steps, setSteps] = useState({ back: 0, ahead: 0 }); // how many undo / redo steps there are (for rendering)
  const counted = () => setSteps({ back: past.current.length, ahead: future.current.length });
  const [version, setVersion] = useState(0); // grows with every change (the viewer then saves a new file)
  const [armed, setArmed] = useState<{ type: string; moving?: string } | null>(null);
  const [preview, setPreview] = useState<(Fit & { type: string }) | null>(null);
  const picker = useRef<Picker | null>(null);
  const setPicker = useCallback((next: Picker | null) => {
    picker.current = next;
  }, []);
  useEffect(() => {
    if (!armed) return;
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setArmed(null);
      setPreview(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [armed]);

  const bodyMaterial = (): Material => {
    const vol = (m: Mesh) => new Box3().setFromObject(m).getSize(new Vector3()).toArray().reduce((a, b) => a * b, 1);
    const big = [...slots].sort((a, b) => vol(b.mesh) - vol(a.mesh))[0];
    const mat = big && (Array.isArray(big.mesh.material) ? big.mesh.material[0] : big.mesh.material);
    return mat ? mat.clone() : new MeshStandardMaterial({ color: "#e8e0d0", roughness: 0.7 });
  };

  // Reopening: every saved added part the loaded file does not have (a design reopened on its original file) is
  // rebuilt from its saved size and place; one the file has (found by its id) is kept as it is: never twice.
  const restored = useRef<Object3D | null>(null);
  useEffect(() => {
    if (!root || restored.current === root || !slots.length) return;
    restored.current = root;
    const missing = added.filter((spec) => !slots.some((s) => s.id === spec.id));
    if (!missing.length) return;
    root.updateMatrixWorld(true);
    const mpu = new Vector3().setFromMatrixScale(root.matrixWorld);
    const built = missing.flatMap((spec) => {
      const def = componentDef(spec.type);
      if (!def) return [];
      const mesh = new Mesh(buildGeometry(spec, mpu), def.material === "metal" ? new MeshStandardMaterial({ color: "#c9ccd1", metalness: 0.9, roughness: 0.3 }) : bodyMaterial());
      const n = added.filter((a) => a.type === spec.type).indexOf(spec) + 1;
      mesh.name = `${def.name} ${n}`;
      mesh.position.set(...spec.center);
      mesh.userData.added = spec.type;
      root.add(mesh);
      onBuilt(mesh, spec.id);
      return [{ id: spec.id, name: mesh.name, nameAr: `${def.nameAr} ${n}`, naming: "vendor" as const, mesh, materialIndex: 0 }];
    });
    setSlots([...slots, ...built]);
  }, [root, slots]); // eslint-disable-line react-hooks/exhaustive-deps -- once per loaded model
  /** The scene and the animations made to match `specs` (new parts built, changed ones rebuilt, removed ones taken out). */
  const apply = (specs: AddedSpec[], before: AddedSpec[]) => {
    if (!root || !picker.current) return;
    const mpu = picker.current.mpu();
    let list = [...slots];
    const gone = before.filter((b) => !specs.some((s) => s.id === b.id)).map((b) => b.id);
    for (const id of gone) {
      const slot = list.find((s) => s.id === id);
      slot?.mesh.parent?.remove(slot.mesh);
      list = list.filter((s) => s.id !== id);
    }
    for (const spec of specs) {
      const def = componentDef(spec.type);
      if (!def) continue;
      const prior = before.find((b) => b.id === spec.id);
      let slot = list.find((s) => s.id === spec.id);
      if (slot && prior && JSON.stringify(prior) === JSON.stringify(spec)) continue;
      const geometry = buildGeometry(spec, mpu);
      if (!slot) {
        const mesh = new Mesh(geometry, def.material === "metal" ? new MeshStandardMaterial({ color: "#c9ccd1", metalness: 0.9, roughness: 0.3 }) : bodyMaterial());
        const n = list.filter((s) => s.id.startsWith(`added_${spec.type}`)).length + 1;
        mesh.name = `${def.name} ${n}`;
        root.add(mesh);
        slot = { id: spec.id, name: `${def.name} ${n}`, nameAr: `${def.nameAr} ${n}`, naming: "vendor", mesh, materialIndex: 0 };
        list = [...list, slot];
      } else {
        slot.mesh.geometry.dispose();
        slot.mesh.geometry = geometry;
      }
      slot.mesh.position.set(...spec.center);
      slot.mesh.quaternion.identity();
      slot.mesh.scale.set(1, 1, 1);
      slot.mesh.userData.added = spec.type;
      onBuilt(slot.mesh, spec.id);
    }
    setSlots(list);
    // Doors swing and drawers slide; parts put on a moving part move with it.
    const keep = (anim?.animations ?? []).filter((a) => !gone.includes(a.component)).map((a) => ({ ...a, follow: a.follow.filter((f) => !gone.includes(f)) }));
    for (const spec of specs) {
      const def = componentDef(spec.type)!;
      const box = specBox(spec);
      const at = keep.findIndex((a) => a.component === spec.id);
      if (def.moves) {
        const base: PartAnimation = at >= 0 ? keep[at] : { id: `anim_${spec.id}`, component: spec.id, follow: [], label: def.name, labelAr: def.nameAr, type: "rotation", axis: "y", unit: "degrees", duration: 0.7, enabled: true, source: "manual", issues: [], to: 95 };
        const moved = def.moves === "hinge" ? withHinge(base, spec.hinge ?? "left", box) : withDirection(base, "front", 0.75 * spec.size[2] * DIRECTIONS.front.sign);
        if (at >= 0) keep[at] = moved;
        else keep.push(moved);
      }
      if (spec.parent) {
        const host = keep.find((a) => a.component === spec.parent);
        if (host && !host.follow.includes(spec.id)) host.follow.push(spec.id);
      }
    }
    setAnim({ version: 1, flagged: [], ...(anim ?? {}), movable: keep.some((a) => a.enabled), animations: keep } as AnimationConfig);
    setVersion((n) => n + 1);
  };

  const commit = (next: AddedSpec[]) => {
    past.current.push(added);
    future.current = [];
    apply(next, added);
    setAdded(next);
    counted();
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(added);
    apply(prev, added);
    setAdded(prev);
    counted();
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(added);
    apply(next, added);
    setAdded(next);
    counted();
  };

  /** The fit of `type` under a screen point (the moved part's own size kept). */
  const fitAt = (type: string, x: number, y: number) => {
    const def = componentDef(type);
    const p = picker.current;
    if (!def || !p) return null;
    const hit = p.hitAt(x, y, def.placement === "on-front" ? "all" : "structure");
    if (!hit) return null;
    const moving = armed?.moving ? added.find((a) => a.id === armed.moving) : undefined;
    return { ...fit(def, hit, p.probe, p.around(), p.mpu(), moving?.size), type };
  };
  const hover = (type: string, x: number, y: number) => setPreview(fitAt(type, x, y));
  const drop = (type: string, x: number, y: number) => {
    const f = fitAt(type, x, y);
    setPreview(null);
    if (!f?.valid) return false;
    const space = f.space ? ([f.space.min.toArray(), f.space.max.toArray()] as AddedSpec["space"]) : undefined;
    if (armed?.moving) commit(added.map((a) => (a.id === armed.moving ? { ...a, size: f.size, center: f.center, parent: f.parent, space } : a)));
    else commit([...added, { id: `added_${type}_${Date.now().toString(36)}`, type, size: f.size, center: f.center, parent: f.parent, hinge: "left", space }]);
    setArmed(null);
    return true;
  };

  // Resizing by dragging a face (ResizeHandles) or typing a size: within the compartment measured without the part
  // itself, never into the structure, other parts, or a door / drawer's movement. One undo step per drag.
  const session = useRef<{ id: string; room: Box3 | null; specs: AddedSpec[] } | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const beginResize = (id: string) => {
    const spec = added.find((a) => a.id === id);
    const p = picker.current;
    if (!spec || !p) return;
    const own = new Set([id, ...added.filter((a) => a.parent === id).map((a) => a.id)]);
    const found = compartmentAt(new Vector3(...spec.center), p.probeWithout(own), p.around());
    past.current.push(added);
    future.current = [];
    // The compartment as measured now (without the part) is its reference: offsets and limits use it, and it is saved.
    const room = found?.space ?? (spec.space ? new Box3(new Vector3(...spec.space[0]), new Vector3(...spec.space[1])) : null);
    session.current = { id, room, specs: added };
  };
  /** The part being edited, the room, and what may not be crossed (structure without the part, other parts, the
   * movement of doors and drawers other than its own). */
  const editing = () => {
    const s = session.current;
    const p = picker.current;
    const spec = s?.specs.find((a) => a.id === s.id);
    const def = spec && componentDef(spec.type);
    if (!s || !p || !spec || !def) return null;
    const own = new Set([s.id, ...s.specs.filter((a) => a.parent === s.id).map((a) => a.id)]);
    const probe = p.probeWithout(own);
    const sweeps = p.around().sweeps.filter((m) => !own.has(m.component ?? ""));
    const check = (b: Box3) => {
      const inner = b.clone().expandByScalar(-Math.max(1e-4, 0.002 * Math.min(...b.getSize(new Vector3()).toArray())));
      return (spec.type !== "door" && blocker(b, probe) ? "Something is in the way." : null) ?? (sweeps.find((m) => m.boxes.some((x) => x.intersectsBox(inner)))?.label ?? null);
    };
    return { s, p, spec, def, check };
  };
  const settle = (res: { spec: AddedSpec; blocked: string | null }) => {
    const e = editing();
    if (!e) return;
    const placed: AddedSpec = { ...res.spec, space: e.s.room ? [e.s.room.min.toArray(), e.s.room.max.toArray()] : res.spec.space };
    const next = carryChildren(e.s.specs.map((a) => (a.id === e.s.id ? placed : a)), e.spec, placed);
    apply(next, e.s.specs);
    e.s.specs = next;
    setAdded(next);
    setBlocked(res.blocked);
  };
  const moveDrag = (axis: 0 | 1 | 2, center: number) => {
    const e = editing();
    if (e) settle(moveTo(e.spec, axis, center, e.s.room, e.check));
  };
  const resizeDrag = (axis: 0 | 1 | 2, side: 1 | -1, face: number) => {
    const e = editing();
    if (!e) return;
    const { s, p, spec, def, check } = e;
    const res = resizeTo(spec, axis, side, face, def, p.mpu(), s.room, check);
    const next = carryChildren(s.specs.map((a) => (a.id === s.id ? { ...res.spec, space: s.room ? [s.room.min.toArray(), s.room.max.toArray()] as AddedSpec["space"] : res.spec.space } : a)), spec, res.spec);
    apply(next, s.specs);
    s.specs = next;
    setAdded(next);
    setBlocked(res.blocked);
  };
  const endResize = () => {
    session.current = null;
    setBlocked(null);
    counted();
  };

  return {
    blocked, beginResize, resizeDrag, moveDrag, endResize,
    /** An exact offset from one inside face of its compartment ("Top Offset 50 cm"). */
    setOffset: (id: string, side: Side, value: number) => {
      beginResize(id);
      const e = editing();
      if (e?.s.room) settle(withOffset(e.spec, side, Math.max(0, value), e.s.room, e.check));
      endResize();
    },
    /** A typed size: the far face moved to it (the same checks as dragging). */
    resizeTo: (id: string, axis: 0 | 1 | 2, length: number) => {
      const spec = added.find((a) => a.id === id);
      if (!spec) return;
      beginResize(id);
      resizeDrag(axis, 1, specBox(spec).min.getComponent(axis) + length);
      endResize();
    },
    rotate: (id: string) => {
      const spec = added.find((a) => a.id === id);
      if (!spec) return;
      // A handle turns on its door's face (level ↔ upright); everything else turns about the vertical.
      commit(added.map((a) => (a.id === id ? { ...a, rotation: (((a.rotation ?? 0) + 90) % 360) as AddedSpec["rotation"], size: a.type === "handle" ? [a.size[1], a.size[0], a.size[2]] : [a.size[2], a.size[1], a.size[0]] } : a)));
    },
    added, version, armed, setArmed, preview, setPicker, undo, redo, canUndo: steps.back > 0, canRedo: steps.ahead > 0,
    /** Canvas wrapper handlers: drag from the gallery, or (armed) move and tap. */
    surface: {
      onDragOver: (e: DragEvent) => {
        const type = armed?.type;
        if (!type || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        hover(type, e.clientX, e.clientY);
      },
      onDrop: (e: DragEvent) => {
        const type = e.dataTransfer.getData(DRAG_TYPE);
        if (!type) return;
        e.preventDefault();
        drop(type, e.clientX, e.clientY);
      },
      onDragLeave: () => setPreview(null),
      onPointerMove: (e: { clientX: number; clientY: number }) => armed && hover(armed.type, e.clientX, e.clientY),
      onClickCapture: (e: { clientX: number; clientY: number; stopPropagation: () => void }) => {
        if (!armed) return;
        e.stopPropagation(); // placing: the click is not a part selection
        drop(armed.type, e.clientX, e.clientY);
      },
    },
    update: (id: string, patch: Partial<AddedSpec>) => commit(added.map((a) => (a.id === id ? { ...a, ...patch } : a))),
    duplicate: (id: string) => {
      const a = added.find((x) => x.id === id);
      if (!a) return;
      const step = a.type === "divider" ? [a.size[0] * 6, 0, 0] : [0, a.size[1] * 4, 0];
      commit([...added, { ...a, id: `added_${a.type}_${Date.now().toString(36)}`, center: [a.center[0] + step[0], a.center[1] + step[1], a.center[2]] }]);
    },
    remove: (id: string) => commit(added.filter((a) => a.id !== id)),
    gallery: suggested(objectType),
    dragType: DRAG_TYPE,
  };
}

export type ComponentEditor = ReturnType<typeof useComponentEditor>;

/** The gallery (drag a picture onto the model, or tap it and then the model) and the selected added part's toolbar. */
export function AddComponentsPanel({ editor, selected, mpu, unit, focus, onPaint }: { editor: ComponentEditor; selected: string | null; mpu: Vector3 | null; unit: "m" | "cm"; focus: 0 | 1 | 2 | Side | null; onPaint: () => void }) {
  const t = useT();
  const ar = t("Part") === "جزء";
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const match = (d: ComponentDef) => !query.trim() || `${d.name} ${d.nameAr} ${d.type}`.toLowerCase().includes(query.trim().toLowerCase());
  const spec = editor.added.find((a) => a.id === selected);
  const def = spec && componentDef(spec.type);
  const inputs = useRef<Partial<Record<string, HTMLInputElement | null>>>({});
  useEffect(() => {
    if (focus !== null) inputs.current[String(focus)]?.focus();
  }, [focus]);
  const room = spec?.space ? new Box3(new Vector3(...spec.space[0]), new Vector3(...spec.space[1])) : null;
  const offs = spec && room ? offsetsOf(spec, room) : null;
  const display = (v: number, axis: 0 | 1 | 2) => Math.round(real(v, axis) * 1000) / (unit === "cm" ? 10 : 1000);
  const tile = (d: ComponentDef) => (
    <button
      key={d.type}
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(editor.dragType, d.type);
        e.dataTransfer.effectAllowed = "copy";
        editor.setArmed({ type: d.type });
      }}
      onDragEnd={() => editor.setArmed(null)}
      onClick={() => editor.setArmed(editor.armed?.type === d.type && !editor.armed.moving ? null : { type: d.type })}
      aria-pressed={editor.armed?.type === d.type}
      className={`flex flex-col items-center gap-1 rounded-xl border p-1.5 text-[11px] font-medium text-slate-700 transition ${editor.armed?.type === d.type ? "border-brand-amber bg-brand-amber-soft/60" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}
    >
      <Thumb type={d.type} />
      <span className="truncate">{ar ? d.nameAr : t(d.name)}</span>
    </button>
  );
  const shown = editor.gallery.fits.filter(match);
  const more = editor.gallery.more.filter(match);
  const real = (v: number, axis: 0 | 1 | 2) => (mpu ? v * mpu.getComponent(axis) : v);
  return (
    <section className="space-y-2 rounded-2xl border border-slate-200/80 bg-white p-3 text-sm shadow-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 text-start text-[13px] font-semibold text-brand-navy">
        <Plus className="size-4 text-brand-amber" aria-hidden /> <span className="flex-1">{t("Add parts")}</span>
        <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" disabled={!editor.canUndo} onClick={editor.undo} aria-label={t("Undo")} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><Undo2 className="size-3.5" /></button>
          <button type="button" disabled={!editor.canRedo} onClick={editor.redo} aria-label={t("Redo")} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><Redo2 className="size-3.5" /></button>
        </span>
      </button>
      {open && (
        <>
          <p className="text-[11px] text-slate-500">{editor.armed ? t("Point at the model: green fits, red does not. Click to place, Esc to cancel.") : t("Drag a part onto the model, or tap it and then the model.")}</p>
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2">
            <Search className="size-3.5 text-slate-400" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search parts")} className="w-full bg-transparent py-1 text-xs outline-none" />
          </label>
          <div className="grid grid-cols-4 gap-1.5">{shown.map(tile)}</div>
          {more.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-500">{t("More parts")}</summary>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">{more.map(tile)}</div>
            </details>
          )}
          {editor.preview && !editor.preview.valid && <p className="text-[11px] text-red-700">{t(editor.preview.reason ?? "")}</p>}
        </>
      )}
      {spec && def && (
        // The selected added part's toolbar: exact sizes (what the space allows), duplicate, move, delete.
        <div className="space-y-2 rounded-xl bg-slate-50 p-2">
          <p className="text-xs font-semibold text-brand-navy">{ar ? def.nameAr : t(def.name)}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {([0, 1, 2] as const).map((axis) => (
              <label key={axis} className="space-y-0.5 text-[10px] text-slate-500">
                {t(["Width", "Height", "Depth"][axis])} ({unit})
                <input
                  ref={(el) => { inputs.current[String(axis)] = el; }}
                  type="number"
                  step={unit === "cm" ? 0.5 : 0.005}
                  value={Math.round(real(spec.size[axis], axis) * (unit === "cm" ? 1000 : 1000)) / (unit === "cm" ? 10 : 1000)}
                  onChange={(e) => {
                    const metres = (Number(e.target.value) || 0) / (unit === "cm" ? 100 : 1);
                    // The same limits as dragging: its own sizes, the compartment, what is in the way.
                    editor.resizeTo(spec.id, axis, mpu ? metres / mpu.getComponent(axis) : metres);
                  }}
                  className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
                />
              </label>
            ))}
          </div>
          {def.moves === "hinge" && (
            <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <input type="checkbox" className="size-3 accent-[#f2a33a]" checked={spec.hinge === "right"} onChange={(e) => editor.update(spec.id, { hinge: e.target.checked ? "right" : "left" })} />
              {t("Hinge on the right")}
            </label>
          )}
          {offs && (
            // Where it sits in its compartment: typing an offset moves it there (within the compartment).
            <div className="grid grid-cols-2 gap-1.5">
              {(offsetAxis(spec.type) === 1 ? (["top", "bottom"] as const) : (["left", "right"] as const)).map((side) => {
                const axis = SIDES[side][0];
                return (
                  <label key={side} className="space-y-0.5 text-[10px] text-slate-500">
                    {t({ top: "Top offset", bottom: "Bottom offset", left: "Left offset", right: "Right offset" }[side])} ({unit})
                    <input
                      ref={(el) => { inputs.current[side] = el; }}
                      type="number"
                      min={0}
                      step={unit === "cm" ? 0.5 : 0.005}
                      value={display(offs[side], axis)}
                      onChange={(e) => {
                        const metres = (Number(e.target.value) || 0) / (unit === "cm" ? 100 : 1);
                        editor.setOffset(spec.id, side, mpu ? metres / mpu.getComponent(axis) : metres);
                      }}
                      className="w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-800"
                    />
                  </label>
                );
              })}
            </div>
          )}
          {editor.blocked && <p className="text-[11px] text-red-700">{t(editor.blocked)}</p>}
          <p className="text-[11px] text-slate-500">{t("Drag the part to move it (Shift: sideways, Alt: in depth); drag the dots to resize it.")}</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={onPaint} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-white px-2 py-1 text-xs font-medium ring-1 ring-slate-200"><Paintbrush className="size-3" />{t("Paint")}</button>
            <button type="button" onClick={() => editor.rotate(spec.id)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-white px-2 py-1 text-xs font-medium ring-1 ring-slate-200"><RotateCw className="size-3" />{t("Rotate")}</button>
            <button type="button" onClick={() => editor.duplicate(spec.id)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-white px-2 py-1 text-xs font-medium ring-1 ring-slate-200"><Copy className="size-3" />{t("Duplicate")}</button>
            <button type="button" onClick={() => editor.setArmed({ type: spec.type, moving: spec.id })} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-white px-2 py-1 text-xs font-medium ring-1 ring-slate-200"><Move className="size-3" />{t("Move")}</button>
            <button type="button" onClick={() => editor.remove(spec.id)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-white px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-red-200"><Trash2 className="size-3" />{t("Delete")}</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Dots on the selected added part's six faces: drag one to resize (the opposite face stays put). Mouse and touch;
 * the view does not turn while dragging. `onDrag` gets where the face is asked to be (model units). */
export function ResizeHandles({ root, box, mpu, blocked, onStart, onDrag, onEnd, moveAxis, onMove, grabBody = true }: { root: Object3D; box: Box3; mpu: Vector3; blocked: boolean; onStart: () => void; onDrag: (axis: 0 | 1 | 2, side: 1 | -1, face: number) => void; onEnd: () => void; moveAxis: 0 | 1; onMove: (axis: 0 | 1 | 2, center: number) => void; grabBody?: boolean }) {
  const get = useThree((state) => state.get);
  const drag = useRef<{ axis: 0 | 1 | 2; side: 1 | -1; point: Vector3 } | null>(null);
  // Moving (the square, or the part itself): along its offset axis; Shift sideways / up-down instead, Alt in depth.
  // `grab` keeps the pointer-to-part offset (no jump); it is taken again when the axis changes mid-drag.
  const moving = useRef<{ axis: 0 | 1 | 2; grab: number; point: Vector3; x: number; y: number; started: boolean } | null>(null);
  const matrix = useMemo(() => new Matrix4().copy(root.matrixWorld), [root, box]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = box.getCenter(new Vector3());
  const r = 0.014 / Math.max(mpu.x, 1e-9);
  const dots = ([0, 1, 2] as const).flatMap((axis) => ([1, -1] as const).map((side) => {
    const point = c.clone().setComponent(axis, side > 0 ? box.max.getComponent(axis) : box.min.getComponent(axis));
    return { axis, side, point };
  }));
  const controls = (on: boolean) => {
    const orbit = get().controls as unknown as { enabled: boolean } | null;
    if (orbit) orbit.enabled = on;
  };
  /** The point on the dragged face's axis nearest the pointer's ray (both in model coordinates). */
  const along = (ray: { origin: Vector3; direction: Vector3 }, d: { axis: 0 | 1 | 2; point: Vector3 }) => {
    const inv = root.matrixWorld.clone().invert();
    const o = ray.origin.clone().applyMatrix4(inv);
    const dir = ray.origin.clone().add(ray.direction).applyMatrix4(inv).sub(o);
    const a = new Vector3().setComponent(d.axis, 1);
    const w = d.point.clone().sub(o);
    const b = a.dot(dir), cc = dir.dot(dir);
    const det = b * b - cc;
    if (Math.abs(det) < 1e-9) return null;
    return d.point.getComponent(d.axis) + (cc * a.dot(w) - b * dir.dot(w)) / det;
  };
  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      {dots.map((d) => (
        <mesh
          key={`${d.axis}${d.side}`}
          position={d.point}
          renderOrder={20}
          onClick={(e) => e.stopPropagation()} // a handle's click never selects the part behind it
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            controls(false);
            drag.current = d;
            onStart();
          }}
          onPointerMove={(e) => {
            if (!drag.current || drag.current.axis !== d.axis || drag.current.side !== d.side) return;
            e.stopPropagation();
            const face = along(e.ray, drag.current);
            if (face !== null) onDrag(d.axis, d.side, face);
          }}
          onPointerUp={(e) => {
            if (!drag.current) return;
            e.stopPropagation();
            (e.target as Element).releasePointerCapture?.(e.pointerId);
            drag.current = null;
            controls(true);
            onEnd();
          }}
        >
          <sphereGeometry args={[r, 16, 12]} />
          <meshBasicMaterial color={blocked ? "#dc2626" : "#f2a33a"} depthTest={false} transparent />
        </mesh>
      ))}
      {/* The move square, and (when grabBody) the part itself: drag either to slide the part (offsets update live). */}
      {(grabBody ? ["square", "body"] : ["square"]).map((kind) => (
        <mesh
          key={kind}
          position={c}
          renderOrder={21}
          onClick={(e) => e.stopPropagation()} // a press on the selected part never selects what is behind it
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            controls(false);
            moving.current = { axis: moveAxis, grab: 0, point: c.clone(), x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, started: false };
            const at = along(e.ray, { axis: moveAxis, point: c });
            moving.current.grab = (at ?? c.getComponent(moveAxis)) - c.getComponent(moveAxis);
          }}
          onPointerMove={(e) => {
            const m = moving.current;
            if (!m) return;
            e.stopPropagation();
            if (!m.started) {
              if (Math.hypot(e.nativeEvent.clientX - m.x, e.nativeEvent.clientY - m.y) < 3) return; // a click: no undo step
              m.started = true;
              onStart();
            }
            const axis: 0 | 1 | 2 = e.altKey ? 2 : e.shiftKey ? (moveAxis === 1 ? 0 : 1) : moveAxis;
            if (axis !== m.axis) {
              const at = along(e.ray, { axis, point: c });
              Object.assign(m, { axis, point: c.clone(), grab: (at ?? c.getComponent(axis)) - c.getComponent(axis) });
            }
            const at = along(e.ray, { axis, point: m.point });
            if (at !== null) onMove(axis, at - m.grab);
          }}
          onPointerUp={(e) => {
            const m = moving.current;
            if (!m) return;
            e.stopPropagation();
            (e.target as Element).releasePointerCapture?.(e.pointerId);
            moving.current = null;
            controls(true);
            if (m.started) onEnd();
          }}
        >
          {kind === "square" ? <boxGeometry args={[r * 2.2, r * 2.2, r * 2.2]} /> : <boxGeometry args={box.getSize(new Vector3()).addScalar(r * 0.5).toArray()} />}
          {kind === "square" ? <meshBasicMaterial color={blocked ? "#dc2626" : "#0ea5e9"} depthTest={false} transparent /> : <meshBasicMaterial transparent opacity={0} depthWrite={false} />}
        </mesh>
      ))}
    </group>
  );
}
