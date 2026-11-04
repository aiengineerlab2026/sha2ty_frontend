"use client";

import { useEffect, useMemo, useState } from "react";
import { Box, Search } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n";

type Kind = "vendor" | "platform" | "customer";
type Row = {
  id: string;
  kind: Kind;
  title: string | null;
  status: string | null;
  category: string | null;
  width_m: number | null;
  height_m: number | null;
  depth_m: number | null;
  thumbnail_url: string | null;
  source_image_url: string | null;
  glb_url: string | null;
  created_at: string | null;
  owner: { id: string | null; name: string; email: string; status: string | null };
};

const KIND_LABEL: Record<Kind, string> = { vendor: "Vendor", platform: "Sha2ty", customer: "Customer (private)" };

/** Every model on the platform and who owns it: vendors' listings, Sha2ty's catalogue and customers' private models. */
export function AdminModels({ call }: { call: (path: string, init?: RequestInit) => Promise<Record<string, unknown> | null> }) {
  const t = useT();
  const locale = useLocale();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    call("/models").then(
      (body) => body && setRows(body.models as Row[]),
      (caught: Error) => setError(caught.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => (kind === "all" || r.kind === kind) && (!q || [r.title, r.owner.name, r.owner.email, r.category].some((x) => x?.toLowerCase().includes(q))));
  }, [rows, kind, query]);
  const count = (k: Kind | "all") => (rows ?? []).filter((r) => k === "all" || r.kind === k).length;
  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium" });
  const size = (r: Row) => (r.width_m && r.height_m ? [r.width_m, r.height_m, r.depth_m].filter(Boolean).map((v) => Number(v).toFixed(2)).join(" × ") + " m" : "–");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Box className="size-5 text-brand-navy" aria-hidden />
        <h2 className="flex-1 text-lg font-semibold text-brand-navy">{t("All models")}</h2>
        <label className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search title, owner or email…")} aria-label={t("Search models")} className="h-9 w-full rounded-lg border border-slate-200 ps-8 pe-2 text-sm outline-none focus:border-brand-amber" />
        </label>
      </div>
      <p className="mt-1 text-sm text-slate-500">{t("Every model added on the platform and who owns it. Customers' private models are only visible to them and to admins.")}</p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist">
        {(["all", "vendor", "platform", "customer"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-xs font-medium ${kind === k ? "bg-brand-navy text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {t(k === "all" ? "All" : KIND_LABEL[k])} <span className="tabular-nums opacity-70">{count(k)}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {rows === null && !error && <p className="mt-3 text-sm text-slate-500">{t("Loading…")}</p>}
      {rows && !shown.length && <p className="mt-3 text-sm text-slate-500">{t("No models match.")}</p>}
      {shown.length > 0 && (
        <div className="mt-3 max-h-[32rem] overflow-auto rounded-xl border border-slate-100">
          <table className="w-full min-w-[44rem] text-start text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t("Model")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("Owner")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("Type")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("Status")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("Size")}</th>
                <th className="px-3 py-2 text-start font-medium">{t("Added")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const image = r.thumbnail_url || r.source_image_url;
                const href = r.kind === "customer" ? r.glb_url : `/catalog/models/${r.id}`;
                return (
                  <tr key={`${r.kind}:${r.id}`} className="border-t border-slate-100 align-middle">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <span className="size-10 shrink-0 overflow-hidden rounded-md bg-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {image && <img src={image} alt="" loading="lazy" className="size-full object-cover" />}
                        </span>
                        <span className="min-w-0">
                          {href ? (
                            <a href={href} target="_blank" rel="noreferrer" className="block max-w-[14rem] truncate font-medium text-brand-navy hover:underline">{r.title || t("Untitled model")}</a>
                          ) : (
                            <span className="block max-w-[14rem] truncate font-medium text-brand-navy">{r.title || t("Untitled model")}</span>
                          )}
                          {r.category && <span className="block text-xs text-slate-400">{r.category}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="block max-w-[14rem] truncate text-slate-700">{r.owner.name || "–"}</span>
                      {r.owner.email && <a href={`mailto:${r.owner.email}`} className="block max-w-[14rem] truncate text-xs text-slate-500 hover:underline">{r.owner.email}</a>}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{t(KIND_LABEL[r.kind])}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.status ? t(r.status.charAt(0).toUpperCase() + r.status.slice(1)) : "–"}</td>
                    <td className="px-3 py-2 text-xs tabular-nums text-slate-600"><bdi>{size(r)}</bdi></td>
                    <td className="px-3 py-2 text-xs text-slate-500">{r.created_at ? date.format(new Date(r.created_at)) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
