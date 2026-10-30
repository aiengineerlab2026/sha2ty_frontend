"use client";

import { useT } from "@/lib/i18n";
import { Star } from "lucide-react";

/** Read-only stars with partial fill for averages (e.g. 4.3 → four full, one 30% star). */
export function Stars({ value, size = "size-4", className = "" }: { value: number; size?: string; className?: string }) {
  const t = useT();
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} role="img" aria-label={t("{v} out of 5 stars", { v: value.toFixed(1) })}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <span key={i} className={`relative inline-block ${size}`} aria-hidden>
            <Star className={`absolute inset-0 ${size} text-slate-300`} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className={`${size} fill-brand-amber text-brand-amber`} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Clickable 1–5 rating input (radio group; arrow keys work). */
export function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useT();
  return (
    <span role="radiogroup" aria-label={t("Your rating")} className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i}
          aria-label={`${i} star${i > 1 ? "s" : ""}`}
          onClick={() => onChange(i)}
          className="rounded transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-amber/50"
        >
          <Star className={`size-7 ${i <= value ? "fill-brand-amber text-brand-amber" : "text-slate-300"}`} />
        </button>
      ))}
    </span>
  );
}
