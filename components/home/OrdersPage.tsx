"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LoaderCircle, PackageCheck } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { authSession } from "@/lib/auth/client";
import { lineTotal } from "@/lib/cart";
import { useLocale, useT } from "@/lib/i18n";
import { fetchOrders, type Order } from "@/lib/orders";
import { formatPrice } from "@/lib/plan/pricing";
import { supabaseConfigured } from "@/lib/supabase/client";

const KIND = { model: "Furniture", carpet: "Carpet", wall: "Wall finish", floor: "Floor finish", window: "Window", door: "Door" } as const;
const HREF: Partial<Record<keyof typeof KIND, string>> = { model: "models", carpet: "carpets", wall: "paints", floor: "paints", window: "windows" }; // doors have no catalogue page yet

/** Bought items: every order the user placed since signing up, newest first. */
export function OrdersPage() {
  const t = useT();
  const locale = useLocale();
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void authSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = "/vendor/login?next=/orders";
        return;
      }
      void fetchOrders().then(setOrders);
    });
  }, []);

  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "long" });
  const count = (orders ?? []).reduce((n, o) => n + o.lines.length, 0);

  return (
    <div className="min-h-full bg-slate-50">
      <Header vendor={null} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">{t("Bought items")}</h1>
        <p className="mt-1 text-sm text-slate-500">{orders?.length ? t("{n} items since you signed up", { n: count }) : t("Everything you buy shows up here.")}</p>

        {!orders && <LoaderCircle className="mx-auto mt-16 size-6 animate-spin text-slate-400" aria-label={t("Loading…")} />}
        {orders?.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <PackageCheck className="mx-auto size-6 text-slate-300" aria-hidden />
            <p className="mt-3 font-medium text-brand-navy">{t("No purchases yet")}</p>
            <Link href="/" className="mt-4 inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {t("Browse catalogue")}
            </Link>
          </div>
        )}

        <div className="mt-6 space-y-5">
          {orders?.map((o) => (
            <section key={o.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3 text-sm">
                <span className="font-semibold text-brand-navy">{date.format(new Date(o.created_at))}</span>
                <span className="tabular-nums text-slate-600">{formatPrice(Number(o.total))}</span>
              </header>
              <ul className="divide-y divide-slate-100">
                {o.lines.map((l) => (
                  <li key={l.key} className="flex items-center gap-4 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      {HREF[l.kind] ? (
                        <Link href={`/catalog/${HREF[l.kind]}/${l.refId}`} className="block truncate font-medium text-brand-navy hover:underline">
                          {l.name}
                        </Link>
                      ) : (
                        <p className="truncate font-medium text-brand-navy">{l.name}</p>
                      )}
                      <p className="text-xs text-slate-500">
                        {t(KIND[l.kind])} · {l.quantity}
                        {l.unit === "m2" ? " m²" : " ×"} {formatPrice(l.price, l.unit)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-brand-navy">{lineTotal(l) == null ? t("On request") : formatPrice(lineTotal(l))}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
