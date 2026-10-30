"use client";

import { useT } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { CURRENCY } from "@/lib/plan/pricing";
import type { PriceUnit } from "@/lib/vendor/types";

/** Price input with its unit: a total price per piece, or a price per m². */
export function PriceField({ price, unit, onPrice, onUnit }: { price: string; unit: PriceUnit; onPrice: (v: string) => void; onUnit: (u: PriceUnit) => void }) {
  const t = useT();
  return (
    <fieldset className="space-y-1 text-sm">
      <legend className="text-slate-600">Price ({CURRENCY})</legend>
      <div className="flex h-9 overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:border-brand-amber focus-within:ring-[3px] focus-within:ring-brand-amber/20">
        <Input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="0"
          aria-label={t("Price")}
          value={price}
          onChange={(e) => onPrice(e.target.value)}
          className="h-full min-w-0 flex-1 rounded-none border-0 shadow-none tabular-nums focus-visible:ring-0"
        />
        <div className="flex shrink-0 items-center gap-0.5 border-s border-slate-200 bg-slate-50 p-0.5 text-xs">
          {(["item", "m2"] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={unit === u}
              onClick={() => onUnit(u)}
              className={`h-full rounded-md px-2 font-medium ${unit === u ? "bg-white text-brand-navy shadow-sm" : "text-slate-500 hover:text-brand-navy"}`}
            >
              {u === "item" ? t("Total") : "per m²"}
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

export const priceOrNull = (v: string) => (v.trim() === "" || !(Number(v) >= 0) ? null : Number(v));
