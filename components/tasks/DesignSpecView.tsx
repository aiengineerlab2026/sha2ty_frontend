"use client";

import { useT, type T } from "@/lib/i18n";
import { Download, Focus, Layers, Maximize2, Ruler, Undo2 } from "lucide-react";
import { woodType, type PartMaterial } from "@/lib/designs/materials";
import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { isSoft, sized, type PartSize } from "@/lib/vendor/partSizes";
import type { DesignSpec } from "@/lib/tasks";

const ModelViewer = dynamic(() => import("@/components/vendor/ModelViewer").then((mod) => mod.ModelViewer), {
  ssr: false,
  loading: () => <div className="h-[min(60vh,520px)] rounded-2xl border border-slate-200 bg-[#e4eaee]" />,
});

const m = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(0)} cm`);

/** The customised model exactly as requested (the frozen version): the 3D model at its size, the overall dimensions
 * against the catalogue's, the one wood of the whole model and each part's material on it (what is used, no costs). */
// ponytail: `quantity` is accepted but no longer shown (no costs here); the page shows the pieces count itself.
/** `download`: the 3D file can be downloaded (the customer; a vendor once the customer accepted their bid). */
export function DesignSpecView({ spec, download = false }: { spec: DesignSpec; quantity?: number; download?: boolean }) {
  const t = useT();
  const [sizes, setSizes] = useState(false); // each part's W × H × D on the model, for the workshop
  const [rows, setRows] = useState<({ key: string; name: string } & PartSize)[] | null>(null); // the same sizes, as a table
  // The part lit up on the model: from its label, its row in the table or its card in the part list.
  const [lit, setLit] = useState<string | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  // Sizes only for parts not covered in fabric (and not pillows, the mattress or bedding).
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
  const keyOf = (partName: string) => rows?.find((r) => r.name === t(partName))?.key;
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
  const th = "sticky top-0 bg-slate-50 px-4 py-2.5 text-start text-[11px] font-semibold uppercase tracking-wide text-slate-500";
  const litName = rows?.find((r) => r.key === lit)?.name;
  return (
    <div className="space-y-6">
      {/* The model: interactive 3D with its tools (one part alone, undo, sizes on the model, reset, fullscreen). */}
      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="font-semibold text-brand-navy">{t("The model to make")}</h2>
            <p className="truncate text-xs text-slate-500">{t("{title} · as saved for this request", { title: spec.title })}</p>
          </div>
          {spec.glb_url && download && (
            <a href={spec.glb_url} download className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-navy px-3.5 text-xs font-semibold text-white transition hover:bg-brand-navy/90">
              <Download className="size-4" aria-hidden /> {t("Download 3D model (.glb)")}
            </a>
          )}
        </div>
        {spec.glb_url ? (
          <div ref={viewer} className="relative scroll-mt-20 bg-white p-3 [&:fullscreen]:flex [&:fullscreen]:items-center [&:fullscreen]:p-6">
            <div className="w-full">
              <ModelViewer url={spec.glb_url} dimensions={d} partSizes={partSizes} resetView={resetView} />
            </div>
            <div className="absolute end-6 top-6 z-10 flex items-center gap-0.5 rounded-2xl border border-white/80 bg-white/90 p-1 shadow-lg shadow-slate-900/5 backdrop-blur" role="toolbar" aria-label={t("Model tools")}>
              <button type="button" onClick={undo} disabled={!history.length} title={t("Undo")} aria-label={t("Undo")} className="inline-flex size-9 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-brand-navy disabled:opacity-40 disabled:hover:bg-transparent">
                <Undo2 className="size-4" aria-hidden />
              </button>
              <label title={t("Show dimensions on the model")} className="flex h-9 cursor-pointer items-center gap-2 rounded-xl px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                <span className="relative inline-flex">
                  <input type="checkbox" checked={sizes} onChange={(e) => setSizes(e.target.checked)} className="peer sr-only" />
                  <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-brand-amber peer-focus-visible:ring-2 peer-focus-visible:ring-brand-amber/40" />
                  <span className="absolute start-0.5 top-0.5 size-4 rounded-full bg-white shadow transition peer-checked:translate-x-4 rtl:peer-checked:-translate-x-4" />
                </span>
                <Ruler className="size-4" aria-hidden /> <span className="max-sm:sr-only">{t("Dimensions")}</span>
              </label>
              <button type="button" onClick={() => setResetView((n) => n + 1)} title={t("Reset view")} aria-label={t("Reset view")} className="inline-flex size-9 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-brand-navy disabled:opacity-40 disabled:hover:bg-transparent">
                <Focus className="size-4" aria-hidden />
              </button>
              <button type="button" onClick={fullscreen} title={t("Full screen")} aria-label={t("Full screen")} className="inline-flex size-9 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100 hover:text-brand-navy disabled:opacity-40 disabled:hover:bg-transparent">
                <Maximize2 className="size-4" aria-hidden />
              </button>
            </div>
            {lit && (
              <div className="absolute start-6 top-6 z-10 flex items-center gap-2 rounded-xl bg-brand-navy px-3 py-1.5 text-xs font-medium text-white shadow-lg">
                {t("Showing only: {part}", { part: litName ?? "" })}
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

      {/* Sizes: the whole model, then each part (click one to see it alone on the model). */}
      <section className={`${card} overflow-hidden`}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
          <Ruler className="size-4 text-slate-400" aria-hidden />
          <h2 className="font-semibold text-brand-navy">{t("Dimensions")}</h2>
        </div>
        <div className="space-y-4 p-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th} />
                  <th className={th}>{t("Width")}</th>
                  <th className={th}>{t("Height")}</th>
                  <th className={th}>{t("Depth")}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {/* One row when the size is the catalogue's; the catalogue's below only when it was changed. */}
                <tr className="border-t border-slate-100 font-semibold text-brand-navy">
                  <td className="px-4 py-2.5">{sameSize ? t("Size (as catalogue model “{title}”)", { title: s.title }) : t("Requested size")}</td>
                  <td className="px-4 py-2.5">{m(d?.width)}</td>
                  <td className="px-4 py-2.5">{m(d?.height)}</td>
                  <td className="px-4 py-2.5">{m(d?.depth)}</td>
                </tr>
                {!sameSize && (
                  <tr className="border-t border-slate-100 bg-slate-50/60 text-slate-500">
                    <td className="px-4 py-2.5">{t("Catalogue model “{title}”", { title: s.title })}</td>
                    <td className="px-4 py-2.5">{m(s.width_m)}</td>
                    <td className="px-4 py-2.5">{m(s.height_m)}</td>
                    <td className="px-4 py-2.5">{m(s.depth_m)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {stretched && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("The customer changed width, height and depth separately: parts were scaled with the model, so check proportions of cushions, legs and frame.")}</p>}
          {rows && rows.length > 0 && (
            // Each part's own size (as built, at the requested size); repeated pieces once, with how many.
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={th}>{t("Part")}</th>
                      <th className={th}>{t("Width")}</th>
                      <th className={th}>{t("Height")}</th>
                      <th className={th}>{t("Depth")}</th>
                      <th className={`${th} text-end`}>{t("Quantity")}</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {rows.map((r, i) => (
                      <tr
                        key={`${r.name}-${i}`}
                        onClick={() => light(r.key)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), light(r.key))}
                        tabIndex={0}
                        aria-current={lit === r.key ? "true" : undefined}
                        className={`cursor-pointer border-t border-slate-100 outline-none transition focus-visible:bg-amber-50 ${lit === r.key ? "bg-amber-50 shadow-[inset_3px_0_0_#F2A33A]" : i % 2 ? "bg-slate-50/60 hover:bg-slate-100/70" : "hover:bg-slate-50"}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-brand-navy">{r.name}</td>
                        <td className="px-4 py-2.5">{m(r.width)}</td>
                        <td className="px-4 py-2.5">{m(r.height)}</td>
                        <td className="px-4 py-2.5">{m(r.depth)}</td>
                        <td className="px-4 py-2.5 text-end">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">{t("Sizes of one piece, for the parts not covered in fabric (pillows, the mattress and bedding are not included).")} {t("Click a part to see it alone on the model.")}</p>
            </div>
          )}
        </div>
      </section>

      {/* What it is made of: one wood for the whole model, and each part's material on it. */}
      <section className={`${card} overflow-hidden`}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
          <Layers className="size-4 text-slate-400" aria-hidden />
          <h2 className="font-semibold text-brand-navy">{t("Parts and materials")}</h2>
        </div>
        <div className="space-y-3 p-4">
          {wood && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-200/70 bg-amber-50/50 p-3 text-sm">
              <Swatch mat={wood} />
              <span className="min-w-0">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">{t("Wood (the whole model)")}</span>
                <span className="block truncate font-semibold text-brand-navy">{woodName(t, wood.material!)}</span>
              </span>
            </div>
          )}
          {partial && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("Make only: {parts}", { parts: requested.map((p) => t(p.name)).join(", ") })}</p>}
          {spec.parts.length === 0 && spec.materials.length === 0 && <p className="text-sm text-slate-500">{t("As in the catalogue model: no material changes.")}</p>}
          <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {spec.parts.filter((part) => !isSoft(part.name)).map((part) => {
              const mat = spec.materials.find((x) => x.part_id === part.id);
              const isWood = mat?.material?.kind === "wood";
              const key = keyOf(part.name);
              const on = Boolean(lit && lit === key);
              const kind = isWood ? t("Wood") : mat?.material?.kind === "paint" ? t("Paint") : mat?.material?.kind === "fabric" ? t("Fabric") : null;
              return (
                <li
                  key={part.id}
                  onClick={() => light(key)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && key && (e.preventDefault(), light(key))}
                  tabIndex={key ? 0 : undefined}
                  aria-current={on ? "true" : undefined}
                  className={`group flex items-center gap-3 rounded-xl border p-2.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-brand-amber ${key ? "cursor-pointer hover:-translate-y-px hover:shadow-md" : ""} ${on ? "border-brand-amber bg-amber-50 ring-1 ring-brand-amber" : part.requested === false ? "border-dashed border-slate-200 opacity-50" : "border-slate-200/80 bg-white"}`}
                >
                  <Swatch mat={mat} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-brand-navy">{t(part.name)}</span>
                    <span className="block truncate text-xs text-slate-600">
                      {isWood
                        ? t("The model's wood")
                        : mat?.material
                          ? materialUsed(t, mat.material)
                          : mat
                            ? [mat.mapUrl ? t("Pattern") : null, mat.color && !mat.mapUrl ? mat.color : null].filter(Boolean).join(" · ") || t("Changed finish")
                            : t("As in the catalogue model")}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {kind && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{kind}</span>}
                      {part.requested === false && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{t("not requested")}</span>}
                    </span>
                  </span>
                  {mat?.mapUrl && !isWood && <a href={mat.mapUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-brand-navy underline">{t("Image")}</a>}
                </li>
              );
            })}
          </ul>
          <a href={`/catalog/models/${s.model_id}`} className="inline-block text-xs font-medium text-brand-navy underline">{t("Original catalogue listing")}</a>
        </div>
      </section>
    </div>
  );
}

type SpecMaterial = DesignSpec["materials"][number];

function Swatch({ mat }: { mat?: SpecMaterial }) {
  return (
    <span className="size-10 shrink-0 overflow-hidden rounded-md border border-slate-200" style={{ background: mat?.mapUrl ? undefined : mat?.color ?? "#f1f5f9" }}>
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
