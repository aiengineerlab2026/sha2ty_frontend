"use client";

import { useLocale, useT, type T } from "@/lib/i18n";
import { ViewInCamera } from "./ViewInCamera";
import { Box, Download, Focus, Layers, Maximize2, Ruler, Undo2 } from "lucide-react";
import { woodType, type PartMaterial } from "@/lib/designs/materials";
import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { isSoft, sized, type PartSize } from "@/lib/vendor/partSizes";
import { cm } from "@/lib/designs/resize";
import type { DesignSpec } from "@/lib/tasks";
import { arabicName, isFitting, mainName } from "@/lib/designs/partNames";

const ModelViewer = dynamic(() => import("@/components/vendor/ModelViewer").then((mod) => mod.ModelViewer), {
  ssr: false,
  loading: () => <div className="h-[min(60vh,520px)] rounded-2xl border border-slate-200 bg-[#e4eaee]" />,
});


/** The customised model exactly as requested (the frozen version): the 3D model at its size, the overall dimensions
 * against the catalogue's, the one wood of the whole model and each part's material on it (what is used, no costs). */
// ponytail: `quantity` is accepted but no longer shown (no costs here); the page shows the pieces count itself.
/** `download`: the 3D file can be downloaded (the customer; a vendor once the customer accepted their bid).
 * `camera`: a "View in camera" button (vendors and admins; the customer has it in the design editor). */
/** `layout="page"` (the request page): three columns on wide screens (in reading order: the large model, the parts
 * card with `center` under it, and `aside`, kept in view while the page scrolls); else the two cards one under the
 * other (proposals, admin). */
export function DesignSpecView({ spec, download = false, camera = false, layout, center, aside }: { spec: DesignSpec; quantity?: number; download?: boolean; camera?: boolean; layout?: "page"; center?: ReactNode; aside?: ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const [sizes, setSizes] = useState(false); // each part's W × H × D on the model, for the workshop
  const [rows, setRows] = useState<({ key: string; name: string } & PartSize)[] | null>(null); // the same sizes, as a table
  // The part lit up on the model: from its label, its row in the table or its card in the part list.
  const [lit, setLit] = useState<string | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  // Sizes for every part but pillows, the mattress and bedding.
  const names = useMemo(
    () => spec.parts.map((p) => ({ id: p.id, name: t(p.name), skip: !sized({ name: p.name, material: spec.materials.find((x) => x.part_id === p.id)?.material }) })),
    [spec.parts, spec.materials, t],
  );
  // What the view showed before each change (Undo steps back through them).
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [resetView, setResetView] = useState(0);
  const choose = (next: string | null) => {
    if (next === lit) return;
    setHistory((h) => [...h, lit]);
    setLit(next);
  };
  const undo = () => {
    setLit(history.at(-1) ?? null);
    setHistory((h) => h.slice(0, -1));
  };
  const partSizes = useMemo(() => ({ names, show: sizes, onSizes: setRows, lit, onLit: choose }), [names, sizes, lit]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Show one part alone (again: the whole model), bringing the model into view when it is scrolled away. */
  const light = (key: string | undefined) => {
    if (!key) return;
    choose(lit === key ? null : key);
    viewer.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const fullscreen = () => (document.fullscreenElement ? void document.exitFullscreen() : void viewer.current?.requestFullscreen?.());
  const d = spec.dimensions;
  const s = spec.source;
  const stretched = spec.resize_mode === "independent";
  const near = (a?: number | null, b?: number | null) => a != null && b != null && Math.abs(a - b) < 0.005; // within 5 mm
  const sameSize = !d || (near(d.width, s.width_m) && near(d.height, s.height_m) && near(d.depth, s.depth_m));
  const requested = spec.parts.filter((p) => p.requested !== false);
  const partial = requested.length < spec.parts.length;
  // The whole model is made in one wood (the editor applies it to every wooden part).
  const wood = spec.materials.find((x) => x.material?.kind === "wood");
  const card = "rounded-2xl border border-slate-200/80 bg-white shadow-sm";
  // The main parts only: no hardware by name, and nothing under 12% of the model's largest side once measured.
  const biggest = Math.max(d?.width ?? 0, d?.height ?? 0, d?.depth ?? 0);
  const small = (name: string) => {
    if (isFitting(name)) return true;
    const size = rows?.find((r) => r.name === t(name));
    return Boolean(size && biggest && Math.max(size.width, size.height, size.depth) < 0.12 * biggest);
  };
  const listed = spec.parts.filter((part) => !isSoft(part.name));
  const main = listed.filter((part) => !small(part.name));
  const fittings = listed.length - main.length;
  // One row per kind of part (its name without position or number), material and size: "Wood grain door × 2".
  const lines = (() => {
    const out = new Map<string, { part: (typeof main)[number]; count: number; name: string; size: (PartSize & { key: string }) | undefined }>();
    for (const part of main) {
      const name = mainName(locale === "ar" ? arabicName(t(part.name)) : t(part.name));
      const mat = spec.materials.find((x) => x.part_id === part.id);
      const size = rows?.find((r) => r.name === t(part.name));
      const cm = (v?: number) => (v == null ? "" : Math.round(v * 1000));
      const key = `${name}|${part.variant?.id ?? ""}|${JSON.stringify(mat ? { ...mat, part: undefined, part_id: undefined } : null)}|${part.requested !== false}|${cm(size?.width)}x${cm(size?.height)}x${cm(size?.depth)}`;
      const seen = out.get(key);
      if (seen) seen.count += size?.count ?? 1;
      else out.set(key, { part, count: size?.count ?? 1, name, size });
    }
    return [...out.values()];
  })();
  const litName = rows?.find((r) => r.key === lit)?.name;
  const glass = "border border-white/70 bg-white/65 shadow-lg shadow-slate-900/10 backdrop-blur-md";
  // The model: large, on a studio backdrop, its tools floating on glass (one part alone, undo, sizes on the model,
  // reset, full screen); the moving parts' bar and the hand icons are the viewer's own.
  const modelCard = (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-amber/15 text-[#b8731d]"><Box className="size-5" aria-hidden /></span>
          <div className="min-w-0">
            <h2 className="font-bold text-brand-navy">{t("The model to make")}</h2>
            <p className="truncate text-xs text-slate-500">{t("{title} · as saved for this request", { title: spec.title })}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {spec.glb_url && camera && <ViewInCamera glb={spec.glb_url} title={spec.title} size={spec.dimensions} />}
          {spec.glb_url && download && (
            <a href={spec.glb_url} download className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-brand-navy transition hover:border-brand-amber/60 hover:bg-amber-50/50">
              <Download className="size-4" aria-hidden /> {t("Download 3D model (.glb)")}
            </a>
          )}
        </div>
      </div>
      {spec.glb_url ? (
        <div ref={viewer} className="relative scroll-mt-20 px-3 pb-3 [&:fullscreen]:flex [&:fullscreen]:items-center [&:fullscreen]:bg-white [&:fullscreen]:p-6">
          <div className="w-full">
            <ModelViewer
              url={spec.glb_url}
              dimensions={d}
              proportional={spec.resize_mode !== "independent"}
              sizeNote={sameSize ? undefined : t("Requested size")}
              partSizes={partSizes}
              resetView={resetView}
              tall={layout === "page"}
              // The editor's movable parts, read-only: their hand icons open and close them; nothing is saved. Older
              // requests carry only part names: their doors and drawers are found from those.
              parts={spec.part_document ?? { components: spec.parts.map((p) => ({ id: p.id, name: p.name, editable: false })) }}
            />
          </div>
          <div className={`absolute end-6 top-3 z-20 flex items-center gap-0.5 rounded-2xl p-1 ${glass}`} role="toolbar" aria-label={t("Model tools")}>
            <button type="button" onClick={undo} disabled={!history.length} title={t("Undo")} aria-label={t("Undo")} className="inline-flex size-9 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white hover:text-brand-navy disabled:opacity-40 disabled:hover:bg-transparent">
              <Undo2 className="size-4" aria-hidden />
            </button>
            <label title={t("Show dimensions on the model")} className="flex h-9 cursor-pointer items-center gap-2 rounded-xl px-2.5 text-xs font-semibold text-slate-600 hover:bg-white">
              <span className="relative inline-flex">
                <input type="checkbox" checked={sizes} onChange={(e) => setSizes(e.target.checked)} className="peer sr-only" />
                <span className="h-5 w-9 rounded-full bg-slate-300/80 transition peer-checked:bg-brand-amber peer-focus-visible:ring-2 peer-focus-visible:ring-brand-amber/40" />
                <span className="absolute start-0.5 top-0.5 size-4 rounded-full bg-white shadow transition peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" />
              </span>
              <Ruler className="size-4" aria-hidden /> <span className="max-sm:sr-only">{t("Dimensions")}</span>
            </label>
            <button type="button" onClick={() => setResetView((n) => n + 1)} title={t("Reset view")} aria-label={t("Reset view")} className="inline-flex size-9 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white hover:text-brand-navy disabled:opacity-40 disabled:hover:bg-transparent">
              <Focus className="size-4" aria-hidden />
            </button>
            <button type="button" onClick={fullscreen} title={t("Full screen")} aria-label={t("Full screen")} className="inline-flex size-9 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white hover:text-brand-navy disabled:opacity-40 disabled:hover:bg-transparent">
              <Maximize2 className="size-4" aria-hidden />
            </button>
          </div>
          {lit && (
            <div className="absolute start-6 top-14 z-20 flex items-center gap-2 rounded-xl bg-brand-navy/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur">
              {t("Highlighted: {part}", { part: litName ?? "" })}
              <button type="button" onClick={() => choose(null)} className="rounded-md bg-white/15 px-1.5 py-0.5 font-semibold hover:bg-white/25">{t("Show all")}</button>
            </div>
          )}
        </div>
      ) : (
        spec.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={spec.thumbnail_url} alt="" className="max-h-96 w-full object-contain p-4" />
        )
      )}
      {spec.glb_url && !download && <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">{t("The 3D model can be downloaded once the customer accepts your offer.")}</p>}
    </section>
  );

  // The sizes, parts and materials: the whole model's size first (as pills), then each main part as a row: its
  // material swatch, name and material, its size (W × H × D) and how many. Click a part to light it on the model.
  const pill = "inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[11px] font-semibold tabular-nums text-brand-navy ring-1 ring-slate-200";
  const partsCard = (
    <section className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <h2 className="flex items-center gap-2 font-bold text-brand-navy"><Layers className="size-4 text-[#b8731d]" aria-hidden /> {t("Dimensions, parts and materials")}</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600">{lines.length}</span>
      </div>
      <div className="space-y-3 p-4">
        {/* The whole model: its requested size, its wood; the catalogue's size only when it was changed. */}
        <div className="rounded-xl bg-gradient-to-br from-amber-50 to-white p-4 ring-1 ring-brand-amber/25">
          <p className="text-xs font-semibold text-[#9a5b0b]">{sameSize ? t("Size (as catalogue model “{title}”)", { title: s.title }) : t("Requested size")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {([["Width", d?.width], ["Height", d?.height], ["Depth", d?.depth]] as const).map(([label, v]) => (
              <span key={label} className="inline-flex items-baseline gap-1 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-brand-amber/25">
                <span className="text-[10px] font-medium text-slate-500">{t(label)}</span>
                <span className="text-sm font-bold tabular-nums text-brand-navy">{cm(v)}</span>
                <span className="text-[10px] text-slate-500">{t("cm")}</span>
              </span>
            ))}
          </div>
          {!sameSize && <p className="mt-2 text-[11px] tabular-nums text-slate-500">{t("Catalogue model “{title}”", { title: s.title })}: <span dir="ltr" className="inline-block">{cm(s.width_m)} × {cm(s.height_m)} × {cm(s.depth_m)} {t("cm")}</span></p>}
          {wood && (
            <p className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-700"><Swatch mat={wood} small /> {woodName(t, wood.material!)}</p>
          )}
        </div>
        {stretched && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("The customer changed width, height and depth separately: parts were scaled with the model, so check proportions of cushions, legs and frame.")}</p>}
        {partial && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("Make only: {parts}", { parts: requested.map((p) => t(p.name)).join(", ") })}</p>}
        <ul className="max-h-[36rem] space-y-1.5 overflow-y-auto pe-1 [scrollbar-width:thin]">
          {lines.map(({ part, count, name, size }, i) => {
            const mat = spec.materials.find((x) => x.part_id === part.id);
            const isWood = mat?.material?.kind === "wood";
            const key = size?.key;
            const on = Boolean(lit && lit === key);
            const used = isWood
              ? woodName(t, mat!.material!)
              : mat?.material
                ? materialUsed(t, mat.material)
                : mat
                  ? [mat.mapUrl ? t("Pattern") : null, mat.color && !mat.mapUrl ? mat.color : null].filter(Boolean).join(" · ") || t("Changed finish")
                  : t("As in the catalogue model");
            return (
              <li
                key={`${part.id}-${i}`}
                onClick={() => light(key)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && key && (e.preventDefault(), light(key))}
                tabIndex={key ? 0 : undefined}
                aria-current={on ? "true" : undefined}
                className={`flex items-center gap-3 rounded-xl border p-2.5 outline-none transition focus-visible:ring-2 focus-visible:ring-brand-amber ${key ? "cursor-pointer hover:border-slate-300 hover:shadow-sm" : ""} ${on ? "border-brand-amber bg-amber-50/70" : part.requested === false ? "border-dashed border-slate-200 opacity-50" : "border-slate-200/80 bg-white"}`}
              >
                <Swatch mat={mat} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-brand-navy">
                    {name}
                    {part.requested === false && <span className="ms-1.5 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-500">{t("not requested")}</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                    {used}
                    {mat?.mapUrl && !isWood && <> · <a href={mat.mapUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-brand-navy underline">{t("Image")}</a></>}
                  </span>
                  {part.variant && <span className="mt-1 inline-block rounded-md bg-brand-navy/5 px-1.5 py-0.5 text-[11px] font-semibold text-brand-navy">{t("Style: {style}", { style: t(part.variant.name) })}</span>}
                  {/* A part the customer added (one the vendor offers for this model): optional, priced in the bid. */}
                  {spec.part_document?.added?.some((a) => a.id === part.id) && <span className="ms-1 mt-1 inline-block rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">{t("Optional part added by the customer")}</span>}
                  {size && <span className={`mt-1.5 ${pill}`} dir="ltr">{cm(size.width)} × {cm(size.height)} × {cm(size.depth)} <span className="font-normal text-slate-500">{t("cm")}</span></span>}
                </span>
                <span className="shrink-0 rounded-full bg-brand-navy/5 px-2 py-0.5 text-xs font-bold tabular-nums text-brand-navy">×{count}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] leading-relaxed text-slate-500">
          {listed.length < spec.parts.length ? t("Sizes of one piece; pillows, the mattress and bedding are not included.") : t("Sizes of one piece.")} {t("Click a part to highlight it on the model.")}
          {fittings > 0 && <> {t("{n} small fittings (handles, locks, keys…) are not listed.", { n: fittings })}</>}
        </p>
        <a href={`/catalog/models/${s.model_id}`} className="inline-block text-xs font-semibold text-brand-navy underline decoration-brand-amber/60 underline-offset-4">{t("Original catalogue listing")}</a>
      </div>
    </section>
  );

  if (layout !== "page") {
    return (
      <div className="space-y-6">
        {modelCard}
        {partsCard}
      </div>
    );
  }
  // Wide screens, in reading order: the model (about half the width), the parts with what goes under them, and the
  // side column kept in view. Between: the model and the parts in one column, the side column beside them.
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)_340px]">
      <div className="min-w-0 lg:col-start-1 xl:sticky xl:top-4">{modelCard}</div>
      <div className="min-w-0 space-y-6 lg:col-start-1 xl:col-start-2 xl:row-start-1">
        {partsCard}
        {center}
      </div>
      <aside className="min-w-0 space-y-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-4 xl:col-start-3">{aside}</aside>
    </div>
  );
}

type SpecMaterial = DesignSpec["materials"][number];

function Swatch({ mat, small = false }: { mat?: SpecMaterial; small?: boolean }) {
  return (
    <span className={`${small ? "size-6" : "size-10"} shrink-0 overflow-hidden rounded-md border border-slate-200`} style={{ background: mat?.mapUrl ? undefined : mat?.color ?? "#f1f5f9" }}>
      {mat?.mapUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mat.mapUrl} alt="" className="size-full object-cover" />
      )}
    </span>
  );
}

/** "Oak (Solid oak)": the wood used, without quantities or prices. */
function woodName(t: T, m: PartMaterial) {
  const kind = t(woodType(m.wood_type)?.name ?? "Wood");
  return m.name && m.name !== kind ? `${m.name} (${kind})` : kind;
}

/** "Green linen (Fabric)" / "Sage paint (Paint: Sage green)": the material used on the wood, without amounts or prices. */
function materialUsed(t: T, m: PartMaterial) {
  const kind = m.kind === "paint" ? `${t("Paint")}${m.color_name ? `: ${t(m.color_name)}` : ""}` : t("Fabric");
  return `${m.name} (${kind})`;
}
