"use client";

import { useT } from "@/lib/i18n";
import type { ModelStateName } from "@/lib/vendor/types";

/** Open / Closed switch for a product with two states (a wardrobe). Switching keeps the view where it is. */
export function StateToggle({ value, onChange, disabled = false, className = "" }: { value: ModelStateName; onChange: (state: ModelStateName) => void; disabled?: boolean; className?: string }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t("Wardrobe state")} className={`inline-flex rounded-lg bg-slate-100 p-0.5 text-sm font-medium ${className}`}>
      {(["closed", "open"] as const).map((state) => (
        <button
          key={state}
          type="button"
          role="radio"
          aria-checked={value === state}
          disabled={disabled}
          onClick={() => value !== state && onChange(state)}
          className={`rounded-md px-3 py-1.5 transition ${value === state ? "bg-white text-brand-navy shadow-sm" : "text-slate-500 hover:text-brand-navy"} disabled:opacity-50`}
        >
          {t(state === "closed" ? "Closed" : "Open")}
        </button>
      ))}
    </div>
  );
}
