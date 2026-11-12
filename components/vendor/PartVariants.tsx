"use client";

import { useState } from "react";
import { Check, Loader2, Plus, Shapes, Trash2, Upload } from "lucide-react";
import { useT } from "@/lib/i18n";
import { loadVariant } from "@/lib/vendor/partVariant";
import type { PartVariant } from "@/lib/vendor/parts";


/** The selected part's variants. Vendors and admins (`onUpload`): add (name, GLB, price difference) and remove them;
 * they are saved with the model. Customers (`onChoose`): pick the original or a variant, shown in the part's place. */
export function PartVariants({
  variants,
  chosen,
  busy,
  error,
  onChoose,
  onUpload,
  onChange,
}: {
  variants: PartVariant[];
  chosen: string | null;
  busy: string | null;
  error: string | null;
  onChoose?: (variant: PartVariant | null) => void;
  onUpload?: (file: File) => Promise<string>;
  onChange: (variants: PartVariant[]) => void;
}) {
  const t = useT();
  const money = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toLocaleString()} ${t("EGP")}`;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-3 text-sm shadow-sm">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Shapes className="size-4 text-brand-amber" aria-hidden /> {t("Variants of this part")}
      </p>
      {onChoose ? (
        <div role="radiogroup" aria-label={t("Variants of this part")} className="mt-3 grid grid-cols-2 gap-2">
          {[null, ...variants].map((variant) => {
            const id = variant?.id ?? "";
            const on = (chosen ?? "") === id;
            return (
              <button
                key={id || "original"}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy !== null}
                onClick={() => !on && onChoose(variant)}
                className={`flex min-h-14 flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-start transition disabled:opacity-60 ${on ? "border-brand-amber bg-amber-50/60 ring-2 ring-brand-amber/30" : "border-slate-200 hover:border-slate-300"}`}
              >
                <span className="flex w-full items-center gap-1.5 font-semibold text-brand-navy">
                  <span className="min-w-0 flex-1 truncate">{variant ? variant.name : t("Original")}</span>
                  {busy === id ? <Loader2 className="size-4 shrink-0 animate-spin text-slate-400" aria-hidden /> : on ? <Check className="size-4 shrink-0 text-brand-amber" aria-hidden /> : null}
                </span>
                {variant?.price_delta ? <span className="text-xs tabular-nums text-slate-500"><bdi>{money(variant.price_delta)}</bdi></span> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <Manage variants={variants} onUpload={onUpload!} onChange={onChange} money={money} />
      )}
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function Manage({ variants, onUpload, onChange, money }: { variants: PartVariant[]; onUpload: (file: File) => Promise<string>; onChange: (variants: PartVariant[]) => void; money: (x: number) => string }) {
  const t = useT();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".glb")) return setError(t("Choose a .glb file."));
    setAdding(true);
    setError(null);
    try {
      const url = await onUpload(file);
      await loadVariant(url); // it must open as a 3D part before customers are offered it
      const delta = Number(price.replace(",", "."));
      onChange([...variants, { id: crypto.randomUUID(), name: name.trim() || file.name.replace(/\.glb$/i, ""), glb_url: url, ...(price && Number.isFinite(delta) && delta !== 0 ? { price_delta: delta } : {}) }]);
      setName("");
      setPrice("");
      setFile(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="mt-2 space-y-3">
      <p className="text-xs leading-relaxed text-slate-500">{t("Other shapes customers can pick for this part (other legs, another headboard). Each one is fitted into this part's place and size. Save the model to keep them.")}</p>
      {variants.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {variants.map((v) => (
            <li key={v.id} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-brand-navy">{v.name}</span>
                {v.price_delta ? <span className="text-xs tabular-nums text-slate-500"><bdi>{money(v.price_delta)}</bdi></span> : null}
              </span>
              <button type="button" onClick={() => window.confirm(t("Remove “{name}”?", { name: v.name })) && onChange(variants.filter((x) => x.id !== v.id))} aria-label={t("Remove")} className="flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">{t("No variants yet: customers get this part as it is.")}</p>
      )}
      <div className="space-y-2 rounded-xl bg-slate-50 p-3">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Variant name (e.g. Tapered oak legs)")} maxLength={120} aria-label={t("Variant name")} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-amber" />
        <div className="flex gap-2">
          <label className="flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 text-xs text-slate-600 hover:border-slate-400">
            <Upload className="size-4 shrink-0 text-slate-400" aria-hidden />
            <span className="truncate">{file ? file.name : t("Choose a .glb file")}</span>
            <input type="file" accept=".glb,model/gltf-binary" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" inputMode="decimal" step="any" placeholder={t("± EGP")} aria-label={t("Price difference (EGP)")} className="h-10 w-24 rounded-lg border border-slate-200 bg-white px-2 text-sm tabular-nums outline-none focus:border-brand-amber" />
        </div>
        <button type="button" disabled={!file || adding} onClick={() => void add()} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand-navy text-sm font-semibold text-white disabled:opacity-50">
          {adding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />} {adding ? t("Adding…") : t("Add variant")}
        </button>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}
