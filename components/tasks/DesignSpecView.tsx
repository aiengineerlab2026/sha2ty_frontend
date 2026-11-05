"use client";

import { useT, type T } from "@/lib/i18n";
import { formatPrice } from "@/lib/plan/pricing";
import { UNIT_LABEL, woodType, type PartMaterial } from "@/lib/designs/materials";
import dynamic from "next/dynamic";
import type { DesignSpec } from "@/lib/tasks";

const ModelViewer = dynamic(() => import("@/components/vendor/ModelViewer").then((mod) => mod.ModelViewer), {
  ssr: false,
  loading: () => <div className="h-[min(60vh,520px)] rounded-2xl border border-slate-200 bg-[#e4eaee]" />,
});

const m = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(0)} cm`);

/** The customised model exactly as requested (the frozen version): the 3D model at its size, the overall
 * dimensions against the catalogue's, and every part's material. What vendors price and build from. */
export function DesignSpecView({ spec, quantity = 1 }: { spec: DesignSpec; quantity?: number }) {
  const t = useT();
  const d = spec.dimensions;
  const s = spec.source;
  const stretched = spec.resize_mode === "independent";
  const near = (a?: number | null, b?: number | null) => a != null && b != null && Math.abs(a - b) < 0.005; // within 5 mm
  const sameSize = !d || (near(d.width, s.width_m) && near(d.height, s.height_m) && near(d.depth, s.depth_m));
  const requested = spec.parts.filter((p) => p.requested !== false);
  const partial = requested.length < spec.parts.length;
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-brand-navy">{t("The model to make")}</h2>
        <span className="text-xs text-slate-500">{t("{title} · as saved for this request", { title: spec.title })}</span>
      </div>
      {spec.glb_url ? (
        <ModelViewer url={spec.glb_url} dimensions={d} />
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
      {stretched && <p className="text-xs text-amber-800">{t("The customer changed width, height and depth separately: parts were scaled with the model, so check proportions of cushions, legs and frame.")}</p>}

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
            return (
              <li key={part.id} className={`flex items-center gap-3 rounded-lg border p-2 text-sm ${part.requested === false ? "border-dashed border-slate-200 opacity-50" : "border-slate-100"}`}>
                <span className="size-10 shrink-0 overflow-hidden rounded-md border border-slate-200" style={{ background: mat?.mapUrl ? undefined : mat?.color ?? "#f1f5f9" }}>
                  {mat?.mapUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mat.mapUrl} alt="" className="size-full object-cover" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-brand-navy">
                    {t(part.name)}
                    {part.requested === false && <span className="ms-1.5 text-xs font-normal text-slate-500">· {t("not requested")}</span>}
                  </span>
                  {part.variant && (
                    <span className="block text-xs font-medium text-amber-800">
                      {t("Variant: {name}", { name: part.variant.name })}
                      {part.variant.price_delta ? <bdi className="ms-1 tabular-nums">({part.variant.price_delta > 0 ? "+" : "−"}{formatPrice(Math.abs(part.variant.price_delta))})</bdi> : null}{" "}
                      <a href={part.variant.glb_url} target="_blank" rel="noreferrer" className="underline">{t("3D file")}</a>
                    </span>
                  )}
                  {mat?.material && <span className="block text-xs text-slate-600">{materialLine(t, mat.material)}</span>}
                  <span className="block truncate text-xs text-slate-500">
                    {mat?.material ? null : mat ? [mat.mapUrl ? t("Pattern") : null, mat.color && !mat.mapUrl ? mat.color : null, mat.tile ? t("tile {cm} cm", { cm: Math.round(mat.tile * 100) }) : null].filter(Boolean).join(" · ") || t("Changed finish") : t("As in the catalogue model")}
                  </span>
                </span>
                {mat?.mapUrl && <a href={mat.mapUrl} target="_blank" rel="noreferrer" className="ms-auto text-xs text-brand-navy underline">{t("Image")}</a>}
              </li>
            );
          })}
        </ul>
        {spec.materials.some((m) => m.material) && (
          <p className="mt-2 flex items-baseline justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-600">{quantity > 1 ? t("Customer's material estimate (per piece × {n})", { n: quantity }) : t("Customer's material estimate")}</span>
            <span className="font-semibold tabular-nums text-brand-navy">{spec.materials_total == null ? t("Price on request") : quantity > 1 ? `${formatPrice(spec.materials_total)} × ${quantity} = ${formatPrice(spec.materials_total * quantity)}` : formatPrice(spec.materials_total)}</span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {spec.glb_url && <a href={spec.glb_url} target="_blank" rel="noreferrer" className="text-brand-navy underline">{t("Download the 3D model (GLB)")}</a>}
        <a href={`/catalog/models/${s.model_id}`} className="text-brand-navy underline">{t("Original catalogue listing")}</a>
      </div>
    </section>
  );
}

/** "Oak (Oak) · 25 mm · finish: Walnut veneer · 0.023 m³ + 1.2 m² · EGP 1,160": what to make the part from, and
 * how much of it. */
function materialLine(t: T, m: PartMaterial) {
  const kind = m.kind === "wood" ? t(woodType(m.wood_type)?.name ?? "Wood") : m.kind === "paint" ? `${t("Paint")}: ${t(m.color_name ?? "")} ${m.color ?? ""}`.trim() : t("Fabric");
  const amount = [m.quantity != null ? `${m.quantity} ${t(UNIT_LABEL[m.unit])}` : null, m.finish && m.finish_quantity != null ? `${m.finish_quantity} ${t("m²")}` : null].filter(Boolean).join(" + ");
  return [`${m.name} (${kind})`, m.thickness_mm ? `${m.thickness_mm} ${t("mm")}` : null, m.finish ? t("finish: {name}", { name: m.finish.name }) : null, amount || null, m.total != null ? formatPrice(m.total) : null].filter(Boolean).join(" · ");
}
