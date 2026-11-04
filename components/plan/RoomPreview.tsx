"use client";

import { useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Shape } from "three";
import type { Vec2 } from "@/lib/plan/types";
import { wallJoints } from "@/lib/plan/wallJoints";

const FLOOR = "#cfa77a";
const WALL = "#f4f1ec";

/** Live 3D preview of one room of any shape (metres): its closed floor outline and one full-height wall per side,
 * joined at every corner. Drag to rotate, scroll / pinch to zoom.
 * (Sizes are shown by the caller, outside the canvas: in-scene HTML labels warn when the canvas unmounts.) */
export function RoomPreview({ polygon, height, thickness }: { polygon: Vec2[]; height: number; thickness: number }) {
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const length = Math.max(...zs) - Math.min(...zs);
  const span = Math.max(width, length, height);
  const centred = useMemo(() => polygon.map(([x, z]): Vec2 => [x - Math.min(...xs) - width / 2, z - Math.min(...zs) - length / 2]), [polygon]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Canvas shadows flat dpr={[1, 2]} camera={{ fov: 40, position: [span * 1.1, span * 2.1, span * 1.5] }} className="touch-none">
      <color attach="background" args={["#eef0f3"]} />
      <ambientLight intensity={0.55 * Math.PI} />
      <directionalLight position={[width, height * 2.5, length * 1.5]} intensity={0.6 * Math.PI} castShadow shadow-mapSize={[1024, 1024]} />
      <Frame span={span} height={height} />
      <Room polygon={centred} height={height} thickness={thickness} />
      <OrbitControls makeDefault enablePan={false} minDistance={span * 0.9} maxDistance={span * 4} maxPolarAngle={Math.PI / 2.05} target={[0, height * 0.35, 0]} />
    </Canvas>
  );
}

/** Re-frame the camera when the room's size changes a lot (typing a new wall, say). */
function Frame({ span, height }: { span: number; height: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.set(span * 1.1, span * 2.1, span * 1.5);
    camera.lookAt(0, height * 0.35, 0);
  }, [camera, span, height]);
  return null;
}

function Room({ polygon, height, thickness: t }: { polygon: Vec2[]; height: number; thickness: number }) {
  const floor = useMemo(() => {
    const shape = new Shape();
    polygon.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
    return shape;
  }, [polygon]);
  // The walls run along the outline's edges, end to end, closed at every corner by a post (the same as the planner
  // and the exported model, lib/plan/wallJoints.ts).
  const walls = polygon.map((start, i) => ({ start, end: polygon[(i + 1) % polygon.length], thickness: t, height }));
  const joints = useMemo(() => wallJoints(walls).map((j) => {
    const shape = new Shape();
    j.outline.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
    return shape;
  }), [polygon, t, height]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <shapeGeometry args={[floor]} />
        <meshStandardMaterial color={FLOOR} roughness={0.8} />
      </mesh>
      {walls.map(({ start: [x, z], end: [nx, nz] }, i) => (
        <mesh key={i} position={[(x + nx) / 2, height / 2, (z + nz) / 2]} rotation-y={-Math.atan2(nz - z, nx - x)} castShadow receiveShadow>
          <boxGeometry args={[Math.hypot(nx - x, nz - z), height, t]} />
          <meshStandardMaterial color={WALL} roughness={0.9} />
        </mesh>
      ))}
      {joints.map((shape, i) => (
        <mesh key={`j${i}`} rotation-x={-Math.PI / 2} castShadow>
          <extrudeGeometry args={[shape, { depth: height, bevelEnabled: false }]} />
          <meshStandardMaterial color={WALL} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
