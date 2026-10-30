"use client";

import { useT } from "@/lib/i18n";
import { CategoryIcon } from "@/components/shatably/CategoryIcon";
import { CATEGORIES, type ModelCategory } from "@/lib/plan/categories";

/** Which catalogue group a model belongs to; ceiling lights are hung from the ceiling in plans. */
export function CategoryPicker({ value, onChange }: { value: ModelCategory; onChange: (c: ModelCategory) => void }) {
  const t = useT();
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{t("Category")}</legend>
      <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CATEGORIES.map((c) => {
          const on = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={c.hint}
              onClick={() => onChange(c.id)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center text-xs font-medium transition ${
                on ? "border-brand-amber bg-brand-amber-soft/60 text-brand-navy ring-2 ring-brand-amber/20" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span className={`flex size-8 items-center justify-center rounded-lg ${on ? "bg-white text-brand-amber shadow-sm" : "bg-slate-100 text-slate-500"}`}>
                <CategoryIcon category={c.id} />
              </span>
              {c.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
