"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { WOOD_TYPES, woodType } from "@/lib/designs/materials";

type Wood = { id: string; name: string; texture_url: string; wood_type: string };

/** The woods a model can be made in (models.woods, supabase/woods.sql): "All woods" (null: every wood the vendor
 * works with, also ones ticked later) or a chosen few. The Sha2ty vendor chooses from all default woods. */
export function WoodsField({ vendorId, platform, value, onChange }: { vendorId: string | null | undefined; platform?: boolean; value: string[] | null; onChange: (woods: string[] | null) => void }) {
  const t = useT();
  const [woods, setWoods] = useState<Wood[] | null>(null);

  useEffect(() => {
    if (!vendorId || !supabaseConfigured()) return;
    void (async () => {
      const all = await supabase().from("fabrics").select("id, name, texture_url, wood_type, vendor_id").eq("kind", "wood");
      let list = (all.data ?? []) as (Wood & { vendor_id: string })[];
      if (!platform) {
        const mine = await supabase().from("vendor_woods").select("wood_id").eq("vendor_id", vendorId);
        const ids = new Set((mine.data ?? []).map((r) => r.wood_id as string));
        list = list.filter((w) => ids.has(w.id));
      }
      const order = (w: Wood) => WOOD_TYPES.findIndex((x) => x.id === w.wood_type);
      setWoods(list.sort((a, b) => order(a) - order(b)));
    })();
  }, [vendorId, platform]);

  const all = value === null;
  const chosen = new Set(value ?? []);
  const toggle = (id: string) => {
    const next = new Set(all ? (woods ?? []).map((w) => w.id) : chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Every wood ticked one by one is the same as "All woods" (and keeps later ones too).
    onChange(woods && next.size === woods.length ? null : [...next]);
  };

  const chip = (on: boolean) => `inline-flex cursor-pointer items-center gap-1.5 rounded-full border py-1 pe-3 ps-1 text-xs font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-amber/40 ${on ? "border-brand-amber bg-brand-amber-soft text-brand-navy" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`;
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium leading-none">{t("Wood types for this model")}</legend>
      <p className="text-xs text-slate-500">{t("Customers customising this model can choose from these woods for its parts.")}</p>
      {woods === null && <p className="text-xs text-slate-500">{t("Loading…")}</p>}
      {woods?.length === 0 && (
        <p className="text-xs text-slate-500">
          {t("You have not chosen the woods you work with yet.")} <Link href="/vendor/woods" className="font-medium text-brand-navy underline">{t("Choose woods")}</Link>
        </p>
      )}
      {!!woods?.length && (
        <div className="flex flex-wrap gap-1.5">
          <label className={`${chip(all)} ps-3`}>
            <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : null)} className="sr-only" />
            {t("All woods")} <span className="text-slate-400">({woods.length})</span>
          </label>
          {woods.map((w) => {
            const on = all || chosen.has(w.id);
            return (
              <label key={w.id} className={chip(on)} title={t(woodType(w.wood_type)?.name ?? "")}>
                <input type="checkbox" checked={on} onChange={() => toggle(w.id)} className="sr-only" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.texture_url} alt="" className="size-5 rounded-full object-cover" />
                {t(w.name)}
              </label>
            );
          })}
        </div>
      )}
      {!all && value?.length === 0 && !!woods?.length && <p className="text-xs text-amber-800">{t("No wood chosen: customers cannot pick a wood for this model.")}</p>}
    </fieldset>
  );
}
