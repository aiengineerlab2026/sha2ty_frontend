"use client";

import { useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { Vector3, type Mesh, type Object3D } from "three";
import { pieces, sizeText } from "@/lib/vendor/partSizes";

type Label = { key: string; name: string; text: string; at: [number, number, number] };

/** Each part's name and size (W × H × D) above it, measured once the model is in place. `names`: the parts in mesh
 * order (the part list), by id. */
export function PartSizes({ target, names, signal }: { target: RefObject<Object3D | null>; names: { id: string; name: string }[]; signal: unknown }) {
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [measured, setMeasured] = useState<unknown>(undefined);
  useFrame(() => {
    if (measured === signal && labels) return;
    const meshes: Mesh[] = [];
    target.current?.traverse((node) => (node as Mesh).isMesh && node.visible && meshes.push(node as Mesh));
    if (!meshes.length) return; // not loaded yet
    const byId = new Map(names.map((p) => [p.id, p.name]));
    setLabels(meshes.map((mesh, i) => {
      const { text, box } = sizeText(pieces(mesh));
      const top = box.getCenter(new Vector3()).setY(box.max.y);
      return { key: mesh.uuid, name: byId.get(mesh.name) ?? names[i]?.name ?? mesh.name, text, at: [top.x, top.y + 0.02, top.z] };
    }));
    setMeasured(signal);
  });
  return (
    <>
      {labels?.map((l) => (
        <Html key={l.key} position={l.at} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <span className="block whitespace-nowrap rounded-md border border-white/70 bg-white/90 px-1.5 py-0.5 text-[10px] leading-tight text-slate-700 shadow-sm backdrop-blur">
            <span className="font-semibold text-brand-navy">{l.name}</span> <bdi className="tabular-nums" dir="ltr">{l.text}</bdi>
          </span>
        </Html>
      ))}
    </>
  );
}
