"use client";

import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Check, CheckCheck, LoaderCircle } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/plan/pricing";
import { UNIT_LABEL, WOOD_TYPES, woodType, type MaterialUnit } from "@/lib/designs/materials";
import { FabricLibrary } from "./FabricLibrary";

type Wood = { id: string; name: string; texture_url: string; wood_type: string; description: string | null; price: number | null; price_unit: MaterialUnit; thicknesses_mm: number[] | null };

/** /vendor/woods. The Sha2ty vendor (admins, in the admin studio) edits the default woods; every other vendor ticks
 * the ones they work with (supabase/woods.sql vendor_woods), which is what customers of their models can pick. */
export function WoodsPage() {
  const [platform, setPlatform] = useState<boolean | null>(null);
  useEffect(() => {
    if (!supabaseConfigured()) return;
    void authSession().then(async ({ data }) => {
      if (!data.session) {
        window.location.href = "/vendor/login";
        return;
      }
      const me = await supabase().from("vendors").select("platform").eq("id", data.session.user.id).maybeSingle();
      setPlatform(Boolean((me.data as { platform?: boolean } | null)?.platform));
    });
  }, []);
  if (platform === null) return <div className="min-h-full bg-slate-50"><Header /></div>;
  return platform ? <FabricLibrary kind="wood" /> : <WoodChoices />;
}

function WoodChoices() {
  const t = useT();
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [woods, setWoods] = useState<Wood[] | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void authSession().then(async ({ data }) => {
      const id = data.session?.user.id;
      if (!id) return;
      setVendorId(id);
      const [all, chosen] = await Promise.all([
        supabase().from("fabrics").select("id, name, texture_url, wood_type, description, price, price_unit, thicknesses_mm, vendor_id").eq("kind", "wood"),
        supabase().from("vendor_woods").select("wood_id").eq("vendor_id", id),
      ]);
      if (all.error || chosen.error) setError((all.error ?? chosen.error)!.message);
      // Only the platform's defaults are offered (a vendor's own wood rows cannot exist under woods.sql).
      const order = (w: Wood) => WOOD_TYPES.findIndex((x) => x.id === w.wood_type);
      setWoods(((all.data ?? []) as (Wood & { vendor_id: string })[]).filter((w) => w.vendor_id !== id).sort((a, b) => order(a) - order(b)));
      setMine(new Set((chosen.data ?? []).map((r) => r.wood_id as string)));
    });
  }, []);

  const toggle = async (wood: Wood) => {
    if (!vendorId) return;
    setBusy(wood.id);
    setError(null);
    const on = mine.has(wood.id);
    const { error: next } = on
      ? await supabase().from("vendor_woods").delete().eq("vendor_id", vendorId).eq("wood_id", wood.id)
      : await supabase().from("vendor_woods").insert({ vendor_id: vendorId, wood_id: wood.id });
    setBusy(null);
    if (next) return setError(next.message);
    setMine((set) => {
      const copy = new Set(set);
      if (on) copy.delete(wood.id);
      else copy.add(wood.id);
      return copy;
    });
  };

  /** Ticks (or unticks) every wood in `list` at once. */
  const setMany = async (list: Wood[], on: boolean) => {
    if (!vendorId || !list.length) return;
    const ids = list.filter((w) => mine.has(w.id) !== on).map((w) => w.id);
    if (!ids.length) return;
    setBusy("all");
    setError(null);
    const { error: next } = on
      ? await supabase().from("vendor_woods").insert(ids.map((wood_id) => ({ vendor_id: vendorId, wood_id })))
      : await supabase().from("vendor_woods").delete().eq("vendor_id", vendorId).in("wood_id", ids);
    setBusy(null);
    if (next) return setError(next.message);
    setMine((set) => {
      const copy = new Set(set);
      for (const id of ids) {
        if (on) copy.add(id);
        else copy.delete(id);
      }
      return copy;
    });
  };
  const allOn = !!woods?.length && woods.every((w) => mine.has(w.id));
  const selectButton = (list: Wood[], small = false) => {
    const on = list.every((w) => mine.has(w.id));
    return (
      <button
        type="button"
        disabled={busy !== null || !list.length}
        onClick={() => void setMany(list, !on)}
        className={small ? "text-xs font-medium text-brand-navy underline-offset-2 hover:underline disabled:opacity-50" : `inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition disabled:opacity-50 ${on ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50" : "border-brand-amber bg-brand-amber text-brand-navy hover:bg-[#e8952a]"}`}
      >
        {busy === "all" && !small ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : !small && <CheckCheck className="size-4" aria-hidden />}
        {on ? t(small ? "Clear" : "Clear all") : t(small ? "Select all" : "Select all woods")}
      </button>
    );
  };

  return (
    <div className="min-h-full bg-slate-50">
      <Header />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">{t("Woods you work with")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("Tick the woods and finishes you can make furniture from. Customers customising your models choose from these, with Sha2ty's reference prices for the estimate.")}</p>
          {woods && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-sm font-medium text-brand-navy">{t("{n} of {total} selected", { n: woods.filter((w) => mine.has(w.id)).length, total: woods.length })}</p>
              {selectButton(woods)}
              {allOn && <span className="text-xs text-slate-500">{t("Every wood is selected.")}</span>}
            </div>
          )}
        </div>
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}
        {woods === null && !error && <p className="text-sm text-slate-500">{t("Loading…")}</p>}
        {(["natural", "engineered", "finish"] as const).map((group) => {
          const list = (woods ?? []).filter((w) => woodType(w.wood_type)?.class === group);
          if (!list.length) return null;
          return (
            <section key={group} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-600">{t(group === "natural" ? "Natural wood" : group === "engineered" ? "Engineered wood" : "Finishes")}</h2>
                {selectButton(list, true)}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {list.map((w) => {
                  const on = mine.has(w.id);
                  return (
                    <label key={w.id} className={`relative cursor-pointer overflow-hidden rounded-xl border bg-white shadow-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-amber/40 ${on ? "border-brand-amber ring-2 ring-brand-amber/30" : "border-slate-200 hover:border-slate-300"}`}>
                      <input type="checkbox" checked={on} disabled={busy === w.id} onChange={() => void toggle(w)} className="sr-only" />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={w.texture_url} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
                      <span className={`absolute end-2 top-2 flex size-6 items-center justify-center rounded-full border ${on ? "border-brand-amber bg-brand-amber text-brand-navy" : "border-white/80 bg-white/80 text-transparent"}`}>
                        {busy === w.id ? <LoaderCircle className="size-3.5 animate-spin text-slate-500" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                      </span>
                      <span className="block p-2">
                        <span className="block truncate text-sm font-medium text-brand-navy">{t(w.name)}</span>
                        <span className="line-clamp-2 block text-[11px] leading-snug text-slate-500">{w.description ? t(w.description) : ""}</span>
                        <span className="mt-0.5 block text-xs font-medium tabular-nums text-brand-navy">
                          {w.price == null ? t("Price on request") : `${formatPrice(Number(w.price))} / ${t(UNIT_LABEL[w.price_unit])}`}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
