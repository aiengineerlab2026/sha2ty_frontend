"use client";

import { useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

const FLOOR = "#cfa77a";
const WALL = "#f4f1ec";
const SKIRT = "#e7e2da";

/** Live 3D preview of a rectangular room (metres): floor, three walls (open towards the viewer),
 * skirting. Drag to rotate, scroll / pinch to zoom. (Sizes are shown by the caller, outside the
 * canvas: in-scene HTML labels warn when the canvas unmounts.) */
export function RoomPreview({ width, length, height, thickness }: { width: number; length: number; height: number; thickness: number }) {
  const span = Math.max(width, length, height);
  return (
    <Canvas shadows flat dpr={[1, 2]} camera={{ fov: 40, position: [span * 1.55, span * 1.35, span * 2.1] }} className="touch-none">
      <color attach="background" args={["#eef0f3"]} />
      <ambientLight intensity={0.55 * Math.PI} />
      <directionalLight position={[width, height * 2.5, length * 1.5]} intensity={0.6 * Math.PI} castShadow shadow-mapSize={[1024, 1024]} />
      <Frame span={span} height={height} />
      <Room width={width} length={length} height={height} thickness={thickness} />
      <OrbitControls makeDefault enablePan={false} minDistance={span * 0.9} maxDistance={span * 4} maxPolarAngle={Math.PI / 2.05} target={[0, height * 0.35, 0]} />
    </Canvas>
  );
}

/** Re-frame the camera when the room's size changes a lot (typing a new width, say). */
function Frame({ span, height }: { span: number; height: number }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.set(span * 1.55, span * 1.35, span * 2.1);
    camera.lookAt(0, height * 0.35, 0);
  }, [camera, span, height]);
  return null;
}

function Room({ width, length, height, thickness: t }: { width: number; length: number; height: number; thickness: number }) {
  const hw = width / 2;
  const hl = length / 2;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color={FLOOR} roughness={0.8} />
      </mesh>
      {/* Back wall and the two side walls; the front stays open so the room can be seen. */}
      <Wall position={[0, height / 2, -hl - t / 2]} size={[width + 2 * t, height, t]} />
      <Wall position={[-hw - t / 2, height / 2, 0]} size={[t, height, length]} />
      <Wall position={[hw + t / 2, height / 2, 0]} size={[t, height, length]} />
      <mesh position={[0, 0.04, -hl + 0.006]}>
        <boxGeometry args={[width, 0.08, 0.012]} />
        <meshStandardMaterial color={SKIRT} />
      </mesh>
    </group>
  );
}

function Wall({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={WALL} roughness={0.9} />
    </mesh>
  );
}
