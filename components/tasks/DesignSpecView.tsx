"use client";

import { useT, type T } from "@/lib/i18n";
import { woodType, type PartMaterial } from "@/lib/designs/materials";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { PartSize } from "@/lib/vendor/partSizes";
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
  const [rows, setRows] = useState<({ name: string } & PartSize)[] | null>(null); // the same sizes, as a table
  const names = useMemo(() => spec.parts.map((p) => ({ id: p.id, name: t(p.name) })), [spec.parts, t]);
  const partSizes = useMemo(() => ({ names, show: sizes, onSizes: setRows }), [names, sizes]);
  const d = spec.dimensions;
  const s = spec.source;
  const stretched = spec.resize_mode === "independent";
  const near = (a?: number | null, b?: number | null) => a != null && b != null && Math.abs(a - b) < 0.005; // within 5 mm
  const sameSize = !d || (near(d.width, s.width_m) && near(d.height, s.height_m) && near(d.depth, s.depth_m));
  const requested = spec.parts.filter((p) => p.requested !== false);
  const partial = requested.length < spec.parts.length;
  // The whole model is made in one wood (the editor applies it to every wooden part).
  const wood = spec.materials.find((x) => x.material?.kind === "wood");
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-brand-navy">{t("The model to make")}</h2>
        <span className="text-xs text-slate-500">{t("{title} · as saved for this request", { title: spec.title })}</span>
      </div>
      {spec.glb_url && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={sizes} onChange={(e) => setSizes(e.target.checked)} className="size-4 accent-brand-amber" />
          {t("Show each part's size on the model")}
        </label>
      )}
      {spec.glb_url ? (
        <ModelViewer url={spec.glb_url} dimensions={d} partSizes={partSizes} />
      ) : (
        spec.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={spec.thumbnail_url} alt="" className="max-h-96 w-full rounded-xl object-contain" />
        )
      )}
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start font-medium" />
              <th className="px-3 py-2 text-start font-medium">{t("Width")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("Height")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("Depth")}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {/* One row when the size is the catalogue's; the catalogue's below only when it was changed. */}
            <tr className="border-t border-slate-100 font-semibold text-brand-navy">
              <td className="px-3 py-2">{sameSize ? t("Size (as catalogue model “{title}”)", { title: s.title }) : t("Requested size")}</td>
              <td className="px-3 py-2">{m(d?.width)}</td>
              <td className="px-3 py-2">{m(d?.height)}</td>
              <td className="px-3 py-2">{m(d?.depth)}</td>
            </tr>
            {!sameSize && (
              <tr className="border-t border-slate-100 text-slate-500">
                <td className="px-3 py-2">{t("Catalogue model “{title}”", { title: s.title })}</td>
                <td className="px-3 py-2">{m(s.width_m)}</td>
                <td className="px-3 py-2">{m(s.height_m)}</td>
                <td className="px-3 py-2">{m(s.depth_m)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows && rows.length > 0 && (
        // Each part's own size (as built, at the requested size); repeated pieces once, with how many.
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("Part")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("Width")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("Height")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("Depth")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("Pieces")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r, i) => (
                <tr key={`${r.name}-${i}`} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-brand-navy">{r.name}</td>
                  <td className="px-3 py-2">{m(r.width)}</td>
                  <td className="px-3 py-2">{m(r.height)}</td>
                  <td className="px-3 py-2">{m(r.depth)}</td>
                  <td className="px-3 py-2">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">{t("Sizes of one piece; pillows, the mattress and bedding are not included.")}</p>
        </div>
      )}
      {stretched && <p className="text-xs text-amber-800">{t("The customer changed width, height and depth separately: parts were scaled with the model, so check proportions of cushions, legs and frame.")}</p>}

      {wood && (
        // One wood for the whole model: its frame and wooden parts. Each part's own material (below) goes on it.
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <Swatch mat={wood} />
          <span className="min-w-0">
            <span className="block text-xs text-slate-500">{t("Wood (the whole model)")}</span>
            <span className="block truncate font-semibold text-brand-navy">{woodName(t, wood.material!)}</span>
          </span>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-brand-navy">{t("Parts and materials")}</h3>
        {partial && (
          <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">
            {t("Make only: {parts}", { parts: requested.map((p) => t(p.name)).join(", ") })}
          </p>
        )}
        {spec.parts.length === 0 && spec.materials.length === 0 && <p className="mt-1 text-sm text-slate-500">{t("As in the catalogue model: no material changes.")}</p>}
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {spec.parts.map((part) => {
            const mat = spec.materials.find((x) => x.part_id === part.id);
            const isWood = mat?.material?.kind === "wood";
            return (
              <li key={part.id} className={`flex items-center gap-3 rounded-lg border p-2 text-sm ${part.requested === false ? "border-dashed border-slate-200 opacity-50" : "border-slate-100"}`}>
                <Swatch mat={mat} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-brand-navy">
                    {t(part.name)}
                    {part.requested === false && <span className="ms-1.5 text-xs font-normal text-slate-500">· {t("not requested")}</span>}
                  </span>
                  <span className="block truncate text-xs text-slate-600">
                    {isWood
                      ? t("The model's wood")
                      : mat?.material
                        ? materialUsed(t, mat.material)
                        : mat
                          ? [mat.mapUrl ? t("Pattern") : null, mat.color && !mat.mapUrl ? mat.color : null].filter(Boolean).join(" · ") || t("Changed finish")
                          : t("As in the catalogue model")}
                  </span>
                </span>
                {mat?.mapUrl && !isWood && <a href={mat.mapUrl} target="_blank" rel="noreferrer" className="ms-auto text-xs text-brand-navy underline">{t("Image")}</a>}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {spec.glb_url && download && <a href={spec.glb_url} download className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 font-semibold text-white">{t("Download the 3D model (GLB)")}</a>}
        {spec.glb_url && !download && <span className="text-slate-500">{t("The 3D model can be downloaded once the customer accepts your offer.")}</span>}
        <a href={`/catalog/models/${s.model_id}`} className="text-brand-navy underline">{t("Original catalogue listing")}</a>
      </div>
    </section>
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
