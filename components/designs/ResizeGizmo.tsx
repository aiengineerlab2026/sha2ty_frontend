"use client";

import { useT } from "@/lib/i18n";
import { useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { Box3, Group, Mesh, MeshBasicMaterial, Plane, Quaternion, SphereGeometry, Vector3 } from "three";
import type { Dimensions } from "@/lib/designs/schema";
import { dragLength, formatLength, MIN_SIZE, resized, type Axis } from "@/lib/designs/resize";

const ORANGE = "#f2a33a";
const INK = "#334155";
const AXES: Record<Axis, Vector3> = { width: new Vector3(1, 0, 0), height: new Vector3(0, 1, 0), depth: new Vector3(0, 0, 1) };
const SPHERE = new SphereGeometry(1, 20, 14);
const FILL = new MeshBasicMaterial({ color: ORANGE, depthTest: false, transparent: true });
const RING = new MeshBasicMaterial({ color: "#ffffff", depthTest: false, transparent: true });
const noRaycast = () => null;

/** Orbiting pauses while a handle is held, so the drag resizes instead of turning the camera. */
function hold(controls: { enabled: boolean } | null, held: boolean) {
  if (controls) controls.enabled = !held;
}

type Handle = { axis: Axis; side: 1 | -1; at: [number, number, number] };
type Drag = { handle: Handle; start: Dimensions; plane: Plane; origin: Vector3; axis: Vector3 };

/** Resize handles and live dimension lines for the model inside `target` (the editor's size group). They follow
 * the target's world position and rotation but live outside it, so they are never exported or in a thumbnail.
 * Dragging a handle moves along its axis on a plane facing the camera (ray–plane intersection), so the size
 * follows the mouse in metres, not pixels; orbiting is paused while a handle is held. */
export function ResizeGizmo({
  target,
  size,
  proportional,
  guides,
  unit,
  min = MIN_SIZE,
  onSize,
  onDrag,
}: {
  target: RefObject<Group | null>;
  size: Dimensions;
  proportional: boolean;
  guides: boolean;
  unit: "m" | "cm";
  min?: number;
  onSize: (size: Dimensions) => void;
  onDrag: (from: Dimensions | null) => void;
}) {
  const frame = useRef<Group>(null);
  const handles = useRef<(Mesh | null)[]>([]);
  const drag = useRef<Drag | null>(null);
  const [from, setFrom] = useState<Dimensions | null>(null);
  const [active, setActive] = useState<Axis | null>(null);
  const [measured, setMeasured] = useState<Dimensions | null>(null);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const camera = useThree((state) => state.camera);
  const box = useMemo(() => new Box3(), []);
  const q = useMemo(() => new Quaternion(), []);

  const list: Handle[] = [
    { axis: "width", side: 1, at: [size.width / 2, size.height / 2, 0] },
    { axis: "width", side: -1, at: [-size.width / 2, size.height / 2, 0] },
    { axis: "depth", side: 1, at: [0, size.height / 2, size.depth / 2] },
    { axis: "depth", side: -1, at: [0, size.height / 2, -size.depth / 2] },
    { axis: "height", side: 1, at: [0, size.height, 0] },
  ];

  useFrame(() => {
    const group = target.current;
    if (!group || !frame.current) return;
    group.getWorldPosition(frame.current.position);
    frame.current.quaternion.copy(group.getWorldQuaternion(q));
    frame.current.updateMatrixWorld();
    // The same size on screen at any zoom.
    const at = new Vector3();
    for (const mesh of handles.current) {
      if (!mesh) continue;
      mesh.getWorldPosition(at);
      mesh.scale.setScalar(Math.max(0.004, camera.position.distanceTo(at) * 0.011));
    }
    // Labels from the model's real, transformed geometry (not the numbers asked for).
    box.setFromObject(group);
    if (box.isEmpty()) return;
    const next = { width: box.max.x - box.min.x, height: box.max.y - box.min.y, depth: box.max.z - box.min.z };
    if (!measured || Math.abs(next.width - measured.width) + Math.abs(next.height - measured.height) + Math.abs(next.depth - measured.depth) > 0.0005) setMeasured(next);
  });

  const down = (handle: Handle) => (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    (event.target as unknown as Element).setPointerCapture(event.pointerId);
    const worldAxis = AXES[handle.axis].clone().applyQuaternion(frame.current?.getWorldQuaternion(q) ?? q.identity()).multiplyScalar(handle.side);
    const origin = (event.object as Mesh).getWorldPosition(new Vector3());
    // A plane through the handle that contains the drag axis and faces the camera as much as it can.
    const view = camera.getWorldDirection(new Vector3());
    const normal = view.sub(worldAxis.clone().multiplyScalar(view.dot(worldAxis)));
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0).cross(worldAxis);
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), origin);
    const hit = event.ray.intersectPlane(plane, new Vector3()) ?? origin.clone();
    drag.current = { handle, start: { ...size }, plane, origin: hit, axis: worldAxis };
    hold(controls, true);
    setFrom({ ...size });
    setActive(handle.axis);
    onDrag({ ...size });
  };

  const move = (event: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d) return;
    event.stopPropagation();
    const hit = event.ray.intersectPlane(d.plane, new Vector3());
    if (!hit) return;
    // d.axis points outwards from this handle, so `moved` > 0 always means bigger, on either side.
    const moved = hit.sub(d.origin).dot(d.axis);
    onSize(resized(d.start, d.handle.axis, dragLength(d.start, d.handle.axis, 1, moved), proportional, min));
  };

  const up = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    event.stopPropagation();
    (event.target as unknown as Element).releasePointerCapture(event.pointerId);
    drag.current = null;
    hold(controls, false);
    setFrom(null);
    setActive(null);
    onDrag(null);
  };

  return (
    <group ref={frame}>
      {list.map((handle, i) => (
        <group key={`${handle.axis}${handle.side}`} position={handle.at}>
          <mesh
            ref={(mesh) => {
              handles.current[i] = mesh;
            }}
            geometry={SPHERE}
            material={FILL}
            renderOrder={1001}
            onPointerDown={down(handle)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = handle.axis === "height" ? "ns-resize" : "ew-resize";
            }}
            onPointerOut={() => {
              document.body.style.cursor = "";
            }}
          >
            <mesh geometry={SPHERE} material={RING} scale={1.45} renderOrder={1000} raycast={noRaycast} />
          </mesh>
        </group>
      ))}
      {guides && measured && <Guides size={size} measured={measured} from={from} active={active} unit={unit} />}
    </group>
  );
}

/** CAD-style dimension lines: extension ticks from the model's edges, a line with arrowheads, a label. Width runs
 * along the front, height up the front-right edge, depth along the right side, all just outside the model. */
function Guides({ size, measured, from, active, unit }: { size: Dimensions; measured: Dimensions; from: Dimensions | null; active: Axis | null; unit: "m" | "cm" }) {
  const t = useT();
  const { width: w, height: h, depth: d } = size;
  const m = Math.max(0.08, 0.1 * Math.max(w, h, d)); // gap between the model and the dimension line
  const a = m * 0.3; // arrowhead length
  const lines: { axis: Axis; label: string; from: [number, number, number]; to: [number, number, number]; ticks: [number, number, number][]; side: [number, number, number] }[] = [
    { axis: "width", label: "Width", from: [-w / 2, 0, d / 2 + m], to: [w / 2, 0, d / 2 + m], ticks: [[-w / 2, 0, d / 2], [-w / 2, 0, d / 2 + m * 1.3], [w / 2, 0, d / 2], [w / 2, 0, d / 2 + m * 1.3]], side: [0, 0, 1] },
    { axis: "height", label: "Height", from: [w / 2 + m, 0, d / 2], to: [w / 2 + m, h, d / 2], ticks: [[w / 2, h, d / 2], [w / 2 + m * 1.3, h, d / 2], [w / 2, 0, d / 2], [w / 2 + m * 1.3, 0, d / 2]], side: [1, 0, 0] },
    { axis: "depth", label: "Depth", from: [w / 2 + m, 0, -d / 2], to: [w / 2 + m, 0, d / 2], ticks: [[w / 2, 0, -d / 2], [w / 2 + m * 1.3, 0, -d / 2], [w / 2, 0, d / 2], [w / 2 + m * 1.3, 0, d / 2]], side: [1, 0, 0] },
  ];
  return (
    <>
      {lines.map((line) => {
        const p = new Vector3(...line.from);
        const q = new Vector3(...line.to);
        const u = q.clone().sub(p).normalize();
        const v = new Vector3(...line.side).cross(u).normalize().multiplyScalar(a * 0.45);
        const head = (tip: Vector3, dir: Vector3) => {
          const back = tip.clone().addScaledVector(dir, -a);
          return [tip, back.clone().add(v), tip, back.clone().sub(v)];
        };
        const color = active === line.axis ? ORANGE : INK;
        const mid = p.clone().add(q).multiplyScalar(0.5).addScaledVector(new Vector3(...line.side), m * 0.6);
        const now = formatLength(measured[line.axis], unit);
        const was = from && Math.abs(from[line.axis] - measured[line.axis]) > 0.0005 ? `${formatLength(from[line.axis], unit)} → ` : "";
        return (
          <group key={line.axis}>
            <Line points={[p, q, ...head(q, u), ...head(p, u.clone().negate())]} segments color={color} lineWidth={1.5} depthTest={false} renderOrder={990} raycast={noRaycast} />
            <Line points={line.ticks} segments color={color} lineWidth={1} depthTest={false} transparent opacity={0.6} renderOrder={990} raycast={noRaycast} />
            <Html position={mid} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
              <span className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums shadow-sm ${active === line.axis ? "border-brand-amber bg-brand-amber text-brand-navy" : "border-slate-200 bg-white/95 text-slate-700"}`}>
                {t(line.label)}: {was}{now}
              </span>
            </Html>
          </group>
        );
      })}
    </>
  );
}
