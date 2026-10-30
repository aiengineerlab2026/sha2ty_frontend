"use client";

import type { PlanGeometry } from "@/lib/plan/types";

const LABELS: Record<string, string> = {
  "00_original": "Original",
  "05_wall_core": "Wall core (thickness filter)",
  "10_ocr": "OCR text",
  "21_openings": "Walls + verified openings",
  "30_sealed": "Segmentation mask",
  "31_rooms": "Rooms & zones",
  "40_final": "Final plan",
};

export function DebugImages({ images }: { images: NonNullable<PlanGeometry["debug_images"]> }) {
  return (
    <div className="grid grid-cols-2 gap-2 p-2 md:grid-cols-4">
      {Object.entries(images).map(([key, src]) =>
        src ? (
          <figure key={key} className="rounded border border-slate-200 bg-white p-1">
            <img src={src} alt={LABELS[key] || key} className="h-28 w-full object-contain" />
            <figcaption className="mt-1 text-center text-[10px] text-slate-500">{LABELS[key] || key}</figcaption>
          </figure>
        ) : null,
      )}
    </div>
  );
}
