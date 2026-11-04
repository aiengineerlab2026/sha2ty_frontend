"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Star, Store } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { formatPrice, type PriceUnit } from "@/lib/plan/pricing";
import { vendorProfile, type VendorProfileData } from "@/lib/tasks";

/** A vendor's public page: who they are, their numbers, previous work, products and what customers said. */
export function VendorPublicProfile({ id }: { id: string }) {
  const t = useT();
  const [data, setData] = useState<VendorProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    vendorProfile(id).then(setData, (e: Error) => setError(e.message));
  }, [id]);

  const stars = (n: number) => (
    <span className="inline-flex" aria-label={t("{n} of 5", { n })}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`size-4 ${i <= Math.round(n) ? "fill-brand-amber text-brand-amber" : "text-slate-300"}`} aria-hidden />)}
    </span>
  );
  const done = data?.projects.filter((p) => p.status === "completed") ?? [];

  return (
    <div className="min-h-full bg-slate-50">
      <Header />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="text-sm text-slate-500">{t("Loading…")}</p>}
        {data && (
          <>
            <section className="flex flex-wrap items-center gap-4 rounded-3xl bg-brand-navy p-6 text-white">
              <span className="flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-white/10">
                {data.vendor.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.vendor.logo_url} alt="" className="size-full object-cover" />
                ) : (
                  <Store className="size-7" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-semibold">{data.vendor.name}</h1>
                <p className="text-sm text-white/70">
                  {data.vendor.location} · {t("On sha2ty since {date}", { date: new Date(data.vendor.created_at).toLocaleDateString() })}
                </p>
              </div>
              <dl className="grid grid-cols-3 gap-4 text-center">
                <div><dt className="text-xs text-white/60">{t("Rating")}</dt><dd className="text-xl font-semibold">{data.stats.rating?.toFixed(1) ?? "—"}</dd></div>
                <div><dt className="text-xs text-white/60">{t("Completed")}</dt><dd className="text-xl font-semibold">{data.stats.completed_projects}</dd></div>
                <div><dt className="text-xs text-white/60">{t("In progress")}</dt><dd className="text-xl font-semibold">{data.stats.active_projects}</dd></div>
              </dl>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">{t("Previous work")}</h2>
              {done.length === 0 && <p className="mt-2 text-sm text-slate-500">{t("No completed projects on sha2ty yet.")}</p>}
              <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                {done.map((p) => (
                  <li key={p.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <div className="aspect-4/3 bg-slate-100">
                      {p.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail_url} alt="" className="size-full object-contain" />
                      )}
                    </div>
                    <p className="truncate p-3 text-sm font-semibold text-brand-navy">{p.title}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-brand-navy">
                {t("Customer reviews")} {data.stats.rating != null && <>{stars(data.stats.rating)} <span className="text-sm font-normal text-slate-500">({data.stats.reviews})</span></>}
              </h2>
              {data.reviews.length === 0 && <p className="mt-2 text-sm text-slate-500">{t("No reviews yet.")}</p>}
              <ul className="mt-3 space-y-2">
                {data.reviews.map((r) => (
                  <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                      {stars(r.rating)}
                      <span className="text-xs text-slate-400">{t("Verified customer")} · {new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    {r.comment && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{r.comment}</p>}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-brand-navy">{t("Products")}</h2>
              {data.listings.length === 0 && <p className="mt-2 text-sm text-slate-500">{t("No products listed.")}</p>}
              <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                {data.listings.map((m) => (
                  <li key={m.id}>
                    <Link href={`/catalog/models/${m.id}`} className="block overflow-hidden rounded-2xl border border-slate-200 bg-white hover:shadow-md">
                      <div className="aspect-4/3 bg-slate-100">
                        {(m.thumbnail_url || m.source_image_url) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={(m.thumbnail_url || m.source_image_url)!} alt="" className="size-full object-cover" />
                        )}
                      </div>
                      <div className="p-3">
                        <p className="truncate text-sm font-semibold text-brand-navy">{m.title}</p>
                        <p className="text-xs text-slate-500">{m.price == null ? t("Price on request") : formatPrice(m.price, (m.price_unit ?? "item") as PriceUnit)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
