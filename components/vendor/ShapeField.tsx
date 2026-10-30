"use client";

import { useT } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ModelShape = "straight" | "l_left" | "l_right";

const OPTIONS: { id: ModelShape; label: string; hint: string }[] = [
  { id: "straight", label: "Straight", hint: "One wall" },
  { id: "l_left", label: "L-shaped", hint: "Corner on the left" },
  { id: "l_right", label: "L-shaped", hint: "Corner on the right" },
];

/** Plan view of each shape (front at the bottom), so the corner side is unambiguous. */
function Glyph({ shape }: { shape: ModelShape }) {
  const d = shape === "straight" ? "M3 6h18v5H3z" : shape === "l_left" ? "M3 6h18v5H8v9H3z" : "M3 6h18v14h-5v-9H3z";
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <path d={d} fill="currentColor" opacity={0.85} />
      <path d="M2 4h20" stroke="currentColor" strokeWidth={1} opacity={0.4} />
    </svg>
  );
}

/**
 * Shape of the unit. L-shaped corner units (cupboards, wardrobes, kitchen runs) stand along two walls,
 * so they have a second length; width becomes the length on wall A and depth the depth of each arm.
 */
export function ShapeField({ shape, onShape, length2, onLength2 }: { shape: ModelShape; onShape: (s: ModelShape) => void; length2: string; onLength2: (v: string) => void }) {
  const t = useT();
  return (
    <div className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t("Shape")}</legend>
        <div role="radiogroup" className="grid grid-cols-3 gap-2">
          {OPTIONS.map((o) => {
            const on = shape === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onShape(o.id)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-start text-xs transition ${
                  on ? "border-brand-amber bg-brand-amber-soft/60 text-brand-navy ring-2 ring-brand-amber/20" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span className={on ? "text-brand-amber" : "text-slate-400"}>
                  <Glyph shape={o.id} />
                </span>
                <span>
                  <span className="block font-semibold">{t(o.label)}</span>
                  <span className="block text-[11px] text-slate-500">{t(o.hint)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      {shape !== "straight" && (
        <div className="space-y-1.5">
          <Label htmlFor="length2">{t("Length on wall B m")}</Label>
          <Input id="length2" type="number" min="0" step="0.01" value={length2} onChange={(e) => onLength2(e.target.value)} />
          <p className="text-xs text-slate-500">Wall A is the back run (Length on wall A above); wall B is the side arm. Depth is how deep each arm is.</p>
        </div>
      )}
    </div>
  );
}
