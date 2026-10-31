"use client";

import { useT } from "@/lib/i18n";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Environment, Grid, OrbitControls, useGLTF } from "@react-three/drei";
import { normalizeModel, type CatalogSize, type NormalizationReport } from "@/lib/plan/modelNormalization";

/** Same normalisation as the floor-plan editor: identical world-space size in both viewers. */
function LoadedModel({ url, dimensions, onReport }: { url: string; dimensions: CatalogSize | null; onReport: (r: NormalizationReport) => void }) {
  const { scene } = useGLTF(url);
  const w = dimensions?.width;
  const h = dimensions?.height;
  const d = dimensions?.depth;
  // Keyed on the numbers, not the object identity, so re-renders never re-clone the model.
  const { object, report } = useMemo(() => normalizeModel(scene, w && h ? { width: w, height: h, ...(d ? { depth: d } : {}) } : null, url), [scene, w, h, d, url]);
  useEffect(() => onReport(report), [onReport, report]);
  return <primitive object={object} />;
}

export function ModelViewer({ url, dimensions = null }: { url: string; dimensions?: CatalogSize | null }) {
  const t = useT();
  const [report, setReport] = useState<NormalizationReport | null>(null);
  const size = report?.finalSize;
  return (
    <div className="relative h-[min(70vh,640px)] w-full overflow-hidden rounded-2xl border border-slate-200 bg-[#e4eaee]">
      <Canvas camera={{ position: [2.4, 1.6, 3.2], fov: 45 }} gl={{ antialias: true }}>
        {/* Soft misty blue-grey (same as the plan builder): calm and easy on the eyes, models read clearly. */}
        <color attach="background" args={["#e4eaee"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[6, 8, 4]} intensity={1.35} />
        <directionalLight position={[-4, 2, -3]} intensity={0.35} />
        <Suspense fallback={null}>
          {/* Bounds moves the camera to fit the model; it never scales the model. */}
          <Bounds fit clip observe margin={1.25}>
            <LoadedModel url={url} dimensions={dimensions} onReport={setReport} />
          </Bounds>
          <Environment preset="warehouse" />
        </Suspense>
        {/* 1 m grid on the floor the model stands on, for a sense of real size. */}
        <Grid args={[10, 10]} cellSize={1} sectionSize={5} cellColor="#c3ccd5" sectionColor="#94a3b8" position={[0, 0.001, 0]} />
        <OrbitControls makeDefault enableDamping autoRotate={false} />
      </Canvas>
      <div className="absolute bottom-3 start-3 max-w-[90%] space-y-1 text-[11px]">
        <p className="rounded-lg border border-white/70 bg-white/85 px-2.5 py-1 text-slate-700 shadow-sm backdrop-blur">
          {size
            ? `${dimensions ? t("Scaled to the catalogue size") : t("No catalogue size yet: authored size")} · ${size.width.toFixed(2)} × ${size.height.toFixed(2)} × ${size.depth.toFixed(2)} m (W × H × D)`
            : t("Loading…")}
        </p>
        {report?.warnings.map((w) => (
          <p key={w} className="rounded-lg border border-amber-200 bg-amber-50/95 px-2.5 py-1 text-amber-800 shadow-sm">
            {w}
          </p>
        ))}
      </div>
    </div>
  );
}
