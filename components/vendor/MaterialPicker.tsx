"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { vendorBrands } from "@/lib/tasks";
import { formatPrice } from "@/lib/plan/pricing";
import { PAINT_COATS, quote, UNIT_LABEL, woodType, type PartMaterial, type PartMaterialOption } from "@/lib/designs/materials";
import { ROLL_WIDTH_M } from "@/lib/designs/fabric";
import type { MaterialEdit } from "@/lib/vendor/parts";
import { Section } from "./PartEditor";

type Row = {
  id: string; kind: "fabric" | "wood" | "paint"; name: string; texture_url: string | null; paint_color_id?: string | null; coverage_m2?: number | null; tile_m: number; price_per_m: number | null; price: number | null; price_unit: PartMaterialOption["unit"];
  wood_type: string | null; description: string | null; thicknesses_mm: number[] | null; sheet_w_m: number | null; sheet_h_m: number | null; normal_url: string | null; roughness: number | null;
  vendor_id: string;
  vendors: { name: string; logo_url: string | null } | null;
};

export type PaintColor = { id: string; name: string; hex: string };
type WallPaint = { id: string; name: string; color: string | null; price: number | null; price_unit: PartMaterialOption["unit"] | null; vendor_id: string };

const option = (row: Row, colors: Map<string, PaintColor>): PartMaterialOption => ({
  id: row.id,
  kind: row.kind ?? "fabric",
  name: row.name,
  url: row.texture_url ?? "",
  tile: Number(row.tile_m),
  price: row.kind !== "fabric" ? (row.price == null ? null : Number(row.price)) : row.price_per_m == null ? null : Number(row.price_per_m),
  unit: row.kind !== "fabric" ? row.price_unit : "m",
  color: row.paint_color_id ? colors.get(row.paint_color_id) ?? null : null,
  coverage_m2: row.coverage_m2 == null ? null : Number(row.coverage_m2),
  wood_type: row.wood_type,
  description: row.description,
  thicknesses_mm: row.thicknesses_mm?.map(Number) ?? null,
  sheet: row.sheet_w_m && row.sheet_h_m ? [Number(row.sheet_w_m), Number(row.sheet_h_m)] : null,
  normal_url: row.normal_url,
  roughness: row.roughness == null ? null : Number(row.roughness),
  vendor: row.vendors ?? null,
});

/** The look a material choice gives a part: the finish's pattern when there is one (MDF shows its veneer), with its
 * surface and relief; the saved choice goes with it. */
function patch(material: PartMaterial, shown: PartMaterialOption): MaterialEdit {
  return { mapUrl: shown.url, tile: shown.tile, roughness: shown.roughness ?? (shown.kind === "fabric" ? 0.88 : 0.5), metalness: 0, normalUrl: shown.normal_url ?? undefined, material };
}

/** From the vendors' library (supabase/fabrics.sql), with what it takes at the size shown: "fabric", upholstery for
 * the selected part; "wood", what the whole model is made of (`area`: the surface of all its wooden parts); "paint",
 * a colour from the admins' palette for the selected part, with the vendors' paints in it (supabase/model_paints.sql).
 * Picking calls `onPick` with the material edit. */
export function MaterialPicker({ mode, edit, area, woodVendor, woodModel, onPick }: { mode: "fabric" | "wood" | "paint"; edit: MaterialEdit | null; area?: number | null; woodVendor?: string | null; woodModel?: string | null; onPick: (patch: MaterialEdit) => void }) {
  const t = useT();
  const [library, setLibrary] = useState<PartMaterialOption[] | null>(() => (supabaseConfigured() ? null : []));
  const [search, setSearch] = useState("");
  const [colors, setColors] = useState<PaintColor[] | null>(() => (supabaseConfigured() ? null : []));
  useEffect(() => {
    if (!supabaseConfigured()) return;
    // The vendor's name and logo come from the backend (customers cannot read the vendors table); the library shows
    // without them if that fails.
    void supabase()
      .from("fabrics")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(async ({ data }) => {
        const rows = (data ?? []) as Row[];
        // The palette (model_paints.sql; empty until that has been run) and the vendors' wall paint colours, which can
        // paint furniture too (priced per m² of painted surface).
        const [palette, walls] = await Promise.all([
          supabase().from("paint_colors").select("id, name, hex").order("created_at").then(({ data: list }) => (list ?? []) as PaintColor[]),
          supabase().from("paints").select("id, name, color, price, price_unit, vendor_id").eq("kind", "color").order("name").then(({ data: list }) => (list ?? []) as WallPaint[]),
        ]);
        const brands = await vendorBrands([...new Set([...rows, ...walls].map((r) => r.vendor_id))]).catch(() => []);
        const of = new Map(brands.map((b) => [b.id, b]));
        // A wall paint in a palette colour is listed under that colour; another colour gets its own swatch.
        const byHex = new Map(palette.map((c) => [c.hex.toLowerCase(), c]));
        const extra: PaintColor[] = [];
        const wallOptions = walls.filter((w) => /^#[0-9a-f]{6}$/i.test(w.color ?? "")).map((w): PartMaterialOption => {
          const hex = w.color!.toLowerCase();
          let color = byHex.get(hex);
          if (!color) {
            color = { id: `wall-${hex}`, name: w.name, hex };
            byHex.set(hex, color);
            extra.push(color);
          }
          return { id: w.id, kind: "paint", name: w.name, url: "", tile: 1, price: w.price == null ? null : Number(w.price), unit: "m2", color, coverage_m2: 1, vendor: of.get(w.vendor_id) ?? null };
        });
        setColors([...palette, ...extra]);
        setLibrary([...rows.map((r) => option({ ...r, vendors: of.get(r.vendor_id) ?? null }, new Map(palette.map((c) => [c.id, c])))), ...wallOptions]);
      });
  }, []);
  // A vendor's own model: only the woods that vendor works with (supabase/woods.sql vendor_woods). Sha2ty's models
  // (no vendor here): every default wood.
  const [allowed, setAllowed] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!woodVendor || !supabaseConfigured()) return;
    let live = true;
    void supabase()
      .from("vendor_woods")
      .select("wood_id")
      .eq("vendor_id", woodVendor)
      .then(({ data }) => live && setAllowed(new Set((data ?? []).map((r) => r.wood_id as string))));
    return () => {
      live = false;
    };
  }, [woodVendor]);
  // The model's own choice (models.woods) narrows it further; null there: all of the above.
  const [modelWoods, setModelWoods] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!woodModel || !supabaseConfigured()) return;
    let live = true;
    void supabase()
      .from("models")
      .select("woods")
      .eq("id", woodModel)
      .maybeSingle()
      .then(({ data, error }) => live && !error && setModelWoods(Array.isArray(data?.woods) ? new Set(data.woods as string[]) : null));
    return () => {
      live = false;
    };
  }, [woodModel]);
  const byVendor = woodVendor ? allowed : null;
  const offered = useMemo(() => (byVendor && modelWoods ? new Set([...modelWoods].filter((id) => byVendor.has(id))) : modelWoods ?? byVendor), [byVendor, modelWoods]);

  const chosen = edit?.material;
  const fabrics = library?.filter((m) => m.kind === "fabric") ?? null;
  const woods = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (library ?? []).filter((m) => m.kind === "wood" && (!offered || offered.has(m.id)) && (!q || [m.name, m.description, t(woodType(m.wood_type)?.name ?? ""), woodType(m.wood_type)?.name].some((x) => x?.toLowerCase().includes(q))));
  }, [library, search, t, offered]);
  const structural = woods.filter((m) => woodType(m.wood_type)?.class !== "finish");
  const finishes = woods.filter((m) => woodType(m.wood_type)?.class === "finish");
  const byId = (id?: string) => library?.find((m) => m.id === id);
  const base = chosen?.kind === "wood" ? byId(chosen.id) : undefined;

  // Paint: the colour comes from the palette (or a vendor's wall paint); the paint (who sells it, per kg, litre or m²)
  // from the vendors in it.
  const paintsIn = (c: PaintColor) => (library ?? []).filter((m) => m.kind === "paint" && m.color?.id === c.id).sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  // Only colours someone sells (a vendor's paint, or Sha2ty's own from its studio).
  const sold = library === null ? null : colors?.filter((c) => paintsIn(c).length) ?? null;
  const paintColor = chosen?.kind === "paint" ? colors?.find((c) => c.hex === chosen.color) : undefined;
  const pickPaint = (c: PaintColor, m?: PartMaterialOption) => {
    const product = m ?? paintsIn(c)[0];
    if (!product) return;
    // A wall paint is priced per m² of painted surface: one "coat" of one m² per m² (the area itself).
    const perArea = product.unit === "m2";
    const material: PartMaterial = { id: product.id, kind: "paint", name: product.name, price: product.price, unit: product.unit, color: c.hex, color_name: c.name, coverage_m2: perArea ? 1 : product.coverage_m2 ?? undefined, ...(perArea ? { coats: 1 } : {}) };
    onPick({ color: c.hex, roughness: 0.45, metalness: 0, material });
  };

  const pickFabric = (m: PartMaterialOption) => onPick(patch({ id: m.id, kind: "fabric", name: m.name, price: m.price, unit: "m" }, m));
  // A structural wood keeps a finish already chosen; a finish needs a board under it (the part's current one).
  const pickWood = (m: PartMaterialOption, thickness?: number, finish?: PartMaterialOption | null) => {
    const keep = finish === undefined ? (chosen?.finish ? byId(chosen.finish.id) : undefined) : finish ?? undefined;
    const material: PartMaterial = {
      id: m.id, kind: "wood", name: m.name, wood_type: m.wood_type ?? undefined, price: m.price, unit: m.unit,
      thickness_mm: thickness ?? (chosen?.id === m.id ? chosen.thickness_mm : undefined) ?? m.thicknesses_mm?.[0],
      ...(m.sheet ? { sheet: m.sheet } : {}),
      ...(keep ? { finish: { id: keep.id, name: keep.name, wood_type: keep.wood_type ?? undefined, price: keep.price, unit: keep.unit } } : {}),
    };
    // An opaque finish (veneer, melamine, laminate) is the surface you see; clear lacquer shows the board's own grain,
    // only glossier (its roughness). The board and the finish are both saved in `material` either way.
    const clear = keep?.wood_type === "lacquer";
    const look = patch(material, keep && !clear ? keep : m);
    onPick(clear ? { ...look, roughness: keep.roughness ?? 0.22 } : look);
  };
  const pickFinish = (f: PartMaterialOption | null) => {
    if (base) pickWood(base, undefined, f);
  };

  // Woods and finishes as a compact grid of swatches (name under each): the whole list fits the panel, so it never
  // needs a scrollbar of its own. Description and price are shown once, for the chosen one (`detail`).
  const swatch = (m: PartMaterialOption, active: boolean, onClick: () => void, disabled = false) => (
    <button
      key={m.id}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      title={`${t(m.name)}${m.price == null ? "" : ` · ${formatPrice(m.price)} / ${t(UNIT_LABEL[m.unit])}`}`}
      className="group min-w-0 text-center disabled:opacity-40"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={m.url} alt="" loading="lazy" className={`aspect-square w-full rounded-lg border object-cover transition ${active ? "border-brand-amber ring-2 ring-brand-amber/50" : "border-slate-200 group-hover:border-slate-300 group-hover:shadow-sm"}`} />
      <span className={`mt-1 block truncate text-[11px] leading-tight ${active ? "font-semibold text-brand-navy" : "text-slate-600"}`}>{t(m.name)}</span>
    </button>
  );
  const detail = (m: PartMaterialOption | undefined) =>
    m && (
      <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-snug text-slate-500">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-brand-navy">{t(m.name)}</span>
          <span className="shrink-0 font-medium tabular-nums text-brand-navy">{m.price == null ? t("Price on request") : `${formatPrice(m.price)} / ${t(UNIT_LABEL[m.unit])}`}</span>
        </span>
        {m.description && <span className="mt-0.5 block">{t(m.description)}</span>}
      </div>
    );

  const estimate = chosen && chosen.kind === mode && area ? quote(chosen, area) : null;
  return (
    <>
      {mode === "fabric" && <Section title={t("Upholstery fabric")}>
        {fabrics === null && <p className="text-xs text-slate-500">{t("Loading…")}</p>}
        {fabrics?.length === 0 && <p className="text-xs text-slate-500">{t("No upholstery fabrics yet. Vendors add them in their studio.")}</p>}
        {!!fabrics?.length && (
          <div className="grid grid-cols-5 gap-1.5 p-0.5">
            {fabrics.map((m) => (
              <button
                key={m.id}
                type="button"
                title={m.price == null ? m.name : `${m.name} · ${formatPrice(m.price)} / ${t("m")}`}
                onClick={() => pickFabric(m)}
                className={`aspect-square overflow-hidden rounded-lg border transition hover:shadow-md ${chosen?.id === m.id || (!chosen && edit?.mapUrl === m.url) ? "border-brand-amber ring-2 ring-brand-amber/40" : "border-slate-200"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt={m.name} className="size-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
        {(() => {
          const picked = chosen?.kind === "fabric" ? byId(chosen.id) : undefined;
          if (!picked) return null;
          return (
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={picked.url} alt="" className="size-12 shrink-0 rounded-lg border border-slate-200 object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-brand-navy">{picked.name}</p>
                {picked.vendor && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-600">
                    {picked.vendor.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={picked.vendor.logo_url} alt="" className="size-5 shrink-0 rounded-full bg-white object-cover ring-1 ring-slate-200" />
                    ) : (
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-navy text-[10px] font-semibold text-white">{picked.vendor.name.slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className="truncate">{picked.vendor.name}</span>
                  </p>
                )}
              </div>
              <p className="shrink-0 text-end text-sm font-semibold tabular-nums text-brand-navy">
                {picked.price == null ? <span className="text-xs font-normal text-slate-500">{t("Price on request")}</span> : <>{formatPrice(picked.price)}<span className="block text-[11px] font-normal text-slate-500">{t("per metre")}</span></>}
              </p>
            </div>
          );
        })()}
      </Section>}

      {mode === "paint" && <Section title={t("Paint")} defaultOpen={chosen?.kind === "paint"}>
        <p className="text-[11px] leading-snug text-slate-500">{t("Paint this part in one of the platform's colours, then choose whose paint.")}</p>
        {sold === null && <p className="text-xs text-slate-500">{t("Loading…")}</p>}
        {sold?.length === 0 && <p className="text-xs text-slate-500">{t("No paints yet. Vendors add them under Furniture paints.")}</p>}
        {!!sold?.length && (
          <div role="radiogroup" aria-label={t("Paint colour")} className="grid grid-cols-6 gap-1.5 p-0.5">
            {sold.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={paintColor?.id === c.id}
                title={t(c.name)}
                aria-label={t(c.name)}
                onClick={() => pickPaint(c)}
                className={`aspect-square rounded-full border transition hover:scale-105 ${paintColor?.id === c.id ? "border-brand-amber ring-2 ring-brand-amber/50 ring-offset-1" : "border-slate-200"}`}
                style={{ background: c.hex }}
              />
            ))}
          </div>
        )}
        {paintColor && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-500">{t("{color}: paints from vendors", { color: t(paintColor.name) })}</p>
            {paintsIn(paintColor).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => pickPaint(paintColor, m)}
                className={`flex w-full items-center gap-2 rounded-lg border p-1.5 text-start transition ${chosen?.id === m.id ? "border-brand-amber bg-brand-amber-soft/40 ring-1 ring-brand-amber/40" : "border-slate-200 hover:bg-slate-50"}`}
              >
                {m.vendor?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.vendor.logo_url} alt="" className="size-9 shrink-0 rounded-full bg-white object-cover ring-1 ring-slate-200" />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ring-1 ring-slate-200" style={{ background: paintColor.hex }}>{(m.vendor?.name ?? m.name).slice(0, 1).toUpperCase()}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-brand-navy">{m.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{[m.vendor?.name, m.coverage_m2 && m.unit !== "m2" ? t("{m2} m² per {unit}", { m2: String(m.coverage_m2), unit: t(UNIT_LABEL[m.unit]) }) : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-[12px] font-semibold tabular-nums text-brand-navy">{m.price == null ? t("Price on request") : `${formatPrice(m.price)} / ${t(UNIT_LABEL[m.unit])}`}</span>
              </button>
            ))}
          </div>
        )}
      </Section>}

      {mode === "wood" && <Section title={t("Wood type")}>
        <p className="text-[11px] leading-snug text-slate-500">{t("What the whole model is made of: shown on its frame and wooden parts (not on upholstered or soft parts).")}</p>
        <label className="relative block">
          <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search oak, MDF, veneer…")} aria-label={t("Search woods")} className="h-8 w-full rounded-lg border border-slate-200 ps-7 pe-2 text-xs outline-none focus:border-brand-amber" />
        </label>
        {library === null && <p className="text-xs text-slate-500">{t("Loading…")}</p>}
        {library && !structural.length && !finishes.length && <p className="text-xs text-slate-500">{search ? t("No woods match.") : woodVendor || woodModel ? t("No woods are offered for this model yet.") : t("No woods yet.")}</p>}
        {!!structural.length && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-500">{t("Material")}</p>
            <div className="grid grid-cols-4 gap-2">{structural.map((m) => swatch(m, base?.id === m.id, () => pickWood(m)))}</div>
            {detail(base)}
          </div>
        )}
        {base && !!base.thicknesses_mm?.length && (
          <label className="block text-xs text-slate-600">{t("Thickness")}
            <select value={chosen?.thickness_mm ?? ""} onChange={(e) => pickWood(base, Number(e.target.value))} className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">
              {base.thicknesses_mm.map((mm) => <option key={mm} value={mm}>{mm} {t("mm")}</option>)}
            </select>
          </label>
        )}
        {!!finishes.length && (
          <div className="space-y-1.5">
            <p className="flex items-center justify-between text-[11px] text-slate-500">
              {t("Finish (surface on the material)")}
              {chosen?.finish && (
                <button type="button" onClick={() => pickFinish(null)} className="inline-flex items-center gap-0.5 text-slate-500 hover:text-brand-navy">
                  <X className="size-3" aria-hidden /> {t("No finish")}
                </button>
              )}
            </p>
            {!base && <p className="text-[11px] text-slate-400">{t("Choose the material first, then a finish for it.")}</p>}
            <div className="grid grid-cols-4 gap-2">{finishes.map((m) => swatch(m, chosen?.finish?.id === m.id, () => pickFinish(m), !base))}</div>
            {detail(chosen?.finish ? byId(chosen.finish.id) : undefined)}
          </div>
        )}
      </Section>}

      {estimate && (
        <div className="rounded-xl border border-brand-amber/40 bg-brand-amber-soft/40 px-3 py-2 text-xs text-slate-600">
          <p className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-brand-navy">{[estimate.name, estimate.thickness_mm ? `${estimate.thickness_mm} ${t("mm")}` : null, estimate.finish?.name].filter(Boolean).join(" · ")}</span>
            <span className="text-sm font-semibold tabular-nums text-brand-navy">{estimate.total == null ? t("Price on request") : formatPrice(estimate.total)}</span>
          </p>
          <p className="mt-0.5 tabular-nums">
            {estimate.kind === "fabric"
              ? t("{area} m² of this part ≈ {metres} m of fabric", { area: area!.toFixed(2), metres: (estimate.quantity ?? 0).toFixed(1) })
              : estimate.kind === "paint"
              ? t("{area} m² of this part ≈ {qty} {unit} of paint", { area: area!.toFixed(2), qty: String(estimate.quantity), unit: t(UNIT_LABEL[estimate.unit]) })
              : t("{area} m² of wooden parts · {qty} {unit} of {name}", { area: area!.toFixed(2), qty: String(estimate.quantity), unit: t(UNIT_LABEL[estimate.unit]), name: estimate.name })}
            {estimate.finish && ` · ${t("{qty} m² of {name}", { qty: String(estimate.finish_quantity), name: estimate.finish.name })}`}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {estimate.kind === "fabric" ? t("Estimate for a {width} m wide roll, with 10% for seams.", { width: ROLL_WIDTH_M }) : estimate.kind === "paint" ? t("Estimate for {coats} coats.", { coats: estimate.coats ?? PAINT_COATS }) : t("Estimate: boards from half the wooden parts' surface, with 15% for cutting waste.")}
          </p>
        </div>
      )}
    </>
  );
}
