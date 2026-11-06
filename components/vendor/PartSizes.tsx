"use client";

import { useEffect, useState, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Material, Mesh, MeshStandardMaterial, Object3D } from "three";
import { anchor, isSoft, pieces, sizeText, type PartSize } from "@/lib/vendor/partSizes";

type Label = { key: string; mesh: Mesh; name: string; text: string; at: [number, number, number] };

const GLOW = 0xf2a33a;

/** Lights a part up (the labelled one), restoring its own emissive colour afterwards. */
function glow(mesh: Mesh, on: boolean) {
  for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[]) {
    if (!material.emissive) continue;
    if (on) {
      material.userData.sizeGlow ??= { color: material.emissive.getHex(), intensity: material.emissiveIntensity };
      material.emissive.setHex(GLOW);
      material.emissiveIntensity = 0.45;
    } else if (material.userData.sizeGlow) {
      material.emissive.setHex(material.userData.sizeGlow.color);
      material.emissiveIntensity = material.userData.sizeGlow.intensity;
      delete material.userData.sizeGlow;
    }
  }
}

/** Each part's name and size (W × H × D), pinned to a point on the part with a short line; tapping a label (or the
 * page's row for it) lights that part up and fades the rest; tapping it again shows the whole model. `names`: the parts in mesh order (the part list), by id. */
export function PartSizes({ target, names, signal, show = true, onSizes, lit: litOutside, onLit }: {
  target: RefObject<Object3D | null>;
  /** The parts in mesh order; `skip` ones get no size (soft furnishings). */
  names: { id: string; name: string; skip?: boolean }[];
  signal: unknown;
  show?: boolean;
  onSizes?: (rows: ({ key: string; name: string } & PartSize)[]) => void;
  /** The part lit up (its key from `onSizes`), when the page controls it (its table and part list light parts too). */
  lit?: string | null;
  onLit?: (key: string | null) => void;
}) {
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [measured, setMeasured] = useState<unknown>(undefined);
  const [litInside, setLitInside] = useState<string | null>(null);
  const lit = onLit ? litOutside ?? null : litInside;
  const setLit = (next: string | null | ((was: string | null) => string | null)) => {
    const value = typeof next === "function" ? next(lit) : next;
    if (onLit) onLit(value);
    else setLitInside(value);
  };
  useFrame(() => {
    if (measured === signal && labels) return;
    const meshes: Mesh[] = [];
    target.current?.traverse((node) => (node as Mesh).isMesh && node.visible && meshes.push(node as Mesh));
    if (!meshes.length) return; // not loaded yet
    const byId = new Map(names.map((p) => [p.id, p]));
    const measuredParts = meshes
      .map((mesh, i) => ({ mesh, part: byId.get(mesh.name) ?? names[i] }))
      .filter(({ mesh, part }) => !part?.skip && !isSoft(mesh.name))
      .map(({ mesh, part }) => ({ mesh, name: part?.name ?? mesh.name }))
      .filter(({ name }) => !isSoft(name))
      .map(({ mesh, name }) => ({ mesh, name, ...sizeText(pieces(mesh)) }));
    setLabels(measuredParts.map(({ mesh, name, text, box }) => {
      const at = anchor(mesh, box);
      return { key: mesh.uuid, mesh, name, text, at: [at.x, at.y, at.z] };
    }));
    onSizes?.(measuredParts.map(({ mesh, name, size }) => ({ key: mesh.uuid, name, ...size })));
    setMeasured(signal);
  });
  // The chosen part stands out: every other mesh fades (a see-through copy of its material, so a material shared
  // with the chosen part stays solid there), restored when it is chosen again, or another is.
  useEffect(() => {
    const mesh = labels?.find((l) => l.key === lit)?.mesh;
    if (!mesh) return;
    glow(mesh, true);
    const faded: [Mesh, Mesh["material"]][] = [];
    target.current?.traverse((node) => {
      const other = node as Mesh;
      if (!other.isMesh || other === mesh || !other.visible) return;
      faded.push([other, other.material]);
      const fade = (m: Material) => Object.assign(m.clone(), { transparent: true, opacity: 0.15, depthWrite: false });
      other.material = Array.isArray(other.material) ? other.material.map(fade) : fade(other.material);
    });
    return () => {
      glow(mesh, false);
      for (const [other, material] of faded) {
        for (const m of Array.isArray(other.material) ? other.material : [other.material]) m.dispose();
        other.material = material;
      }
    };
  }, [lit, labels, target]);
  // Labels lower down on the model are pinned with longer lines, so labels of parts at one spot do not stack.
  const order = show ? [...(labels ?? [])].filter((l) => !lit || l.key === lit).sort((a, b) => b.at[1] - a.at[1]) : [];
  return (
    <>
      {order.map((l, i) => (
        <Html key={l.key} position={l.at} zIndexRange={[lit === l.key ? 30 : 20, 0]} style={{ pointerEvents: "none" }}>
          <div className="flex -translate-x-1/2 -translate-y-full flex-col items-center" style={{ paddingBottom: 0 }}>
            <button
              type="button"
              onClick={() => setLit((was) => (was === l.key ? null : l.key))}
              className={`pointer-events-auto whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] leading-tight shadow-sm backdrop-blur transition ${lit === l.key ? "border-brand-amber bg-brand-amber text-brand-navy" : "border-white/70 bg-white/90 text-slate-700"}`}
            >
              <span className="font-semibold text-brand-navy">{l.name}</span> <bdi className="tabular-nums" dir="ltr">{l.text}</bdi>
            </button>
            <span className={`w-px ${lit === l.key ? "bg-brand-amber" : "bg-slate-500/70"}`} style={{ height: 14 + (i % 3) * 22 }} />
            <span className={`size-2 rounded-full ring-2 ring-white ${lit === l.key ? "bg-brand-amber" : "bg-slate-700"}`} />
          </div>
        </Html>
      ))}
    </>
  );
}
