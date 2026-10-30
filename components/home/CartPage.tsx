"use client";

import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AppWindow, Armchair, BrickWall, LayoutGrid, Minus, Plus, RectangleHorizontal, ShoppingCart, Trash2 } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { clearCart, lineTotal, setCartQuantity, useCart, type CartLine } from "@/lib/cart";
import { formatPrice } from "@/lib/plan/pricing";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import type { VendorProfile } from "@/lib/vendor/types";

const GROUPS: { kind: CartLine["kind"]; title: string; icon: typeof Armchair }[] = [
  { kind: "model", title: "Furniture", icon: Armchair },
  { kind: "carpet", title: "Carpets", icon: RectangleHorizontal },
  { kind: "wall", title: "Wall finishes", icon: BrickWall },
  { kind: "floor", title: "Floor finishes", icon: LayoutGrid },
  { kind: "window", title: "Windows", icon: AppWindow },
];

/** Cart: everything the user added, grouped by kind, with quantities (pieces or m²) and totals. */
export function CartPage() {
  const t = useT();
  const lines = useCart();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void authSession()
      .then(async ({ data }) => {
        if (!data.session) return;
        const { data: profile } = await supabase().from("vendors").select("*").eq("id", data.session.user.id).maybeSingle();
        setVendor(profile);
      });
  }, []);

  const subtotal = lines.reduce((sum, l) => sum + (lineTotal(l) ?? 0), 0);
  const unpriced = lines.filter((l) => l.price == null).length;
  const pieces = lines.reduce((n, l) => n + (l.unit === "m2" ? 1 : Math.round(l.quantity)), 0);

  return (
    <div className="min-h-full bg-slate-50">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">{t("Your cart")}</h1>
            <p className="mt-1 text-sm text-slate-500">{lines.length ? t(pieces === 1 ? "{n} item chosen for your home" : "{n} items chosen for your home", { n: pieces }) : t("Nothing here yet.")}</p>
          </div>
          {lines.length > 0 && (
            <button type="button" onClick={() => window.confirm(t("Remove everything from your cart?")) && clearCart()} className="text-sm text-slate-500 hover:text-red-600">
              {t("Clear cart")}
            </button>
          )}
        </div>

        {lines.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-amber-soft text-brand-navy">
              <ShoppingCart className="size-5" aria-hidden />
            </span>
            <p className="mt-4 font-medium text-brand-navy">{t("Your cart is empty")}</p>
            <p className="mt-1 text-sm text-slate-500">{t("Add furniture, paints, floors and carpets from the catalogue or your floor plan.")}</p>
            <div className="mt-5 flex justify-center gap-2">
              <Link href="/" className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                {t("Browse catalogue")}
              </Link>
              {vendor && (
                <Link href="/plan" className="inline-flex h-10 items-center rounded-xl bg-brand-navy px-4 text-sm font-semibold text-white hover:bg-brand-navy-hover">
                  {t("Open plan builder")}
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-5">
              {GROUPS.map(({ kind, title, icon: Icon }) => {
                const group = lines.filter((l) => l.kind === kind);
                if (!group.length) return null;
                return (
                  <section key={kind} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <h2 className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-sm font-semibold text-brand-navy">
                      <Icon className="size-4 text-slate-400" aria-hidden /> {t(title)}
                    </h2>
                    <ul className="divide-y divide-slate-100">
                      {group.map((l) => (
                        <li key={l.key} className="flex flex-wrap items-center gap-4 px-5 py-4">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-brand-navy">{l.name}</p>
                            <p className="text-xs text-slate-500">{formatPrice(l.price, l.unit)}</p>
                          </div>
                          <Stepper line={l} />
                          <p className="w-28 text-end text-sm font-semibold tabular-nums text-brand-navy">{lineTotal(l) == null ? t("On request") : formatPrice(lineTotal(l))}</p>
                          <button
                            type="button"
                            aria-label={t("Remove {name}", { name: l.name })}
                            onClick={() => setCartQuantity(l.key, 0)}
                            className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>

            <aside className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-24">
              <h2 className="text-sm font-semibold text-brand-navy">{t("Summary")}</h2>
              <dl className="space-y-2 text-sm">
                {GROUPS.map(({ kind, title }) => {
                  const group = lines.filter((l) => l.kind === kind);
                  const sum = group.reduce((s, l) => s + (lineTotal(l) ?? 0), 0);
                  return group.length ? (
                    <div key={kind} className="flex justify-between text-slate-600">
                      <dt>{t(title)}</dt>
                      <dd className="tabular-nums">{group.every((l) => l.price == null) ? t("On request") : formatPrice(sum)}</dd>
                    </div>
                  ) : null;
                })}
                <div className="flex justify-between border-t border-slate-100 pt-3 text-base font-semibold text-brand-navy">
                  <dt>{t("Total")}</dt>
                  <dd className="tabular-nums">{formatPrice(subtotal)}</dd>
                </div>
              </dl>
              {unpriced > 0 && <p className="text-xs text-amber-700">{unpriced} without a price (price on request, not in the total).</p>}
              <p className="text-xs leading-relaxed text-slate-500">{t("Area-priced finishes are counted in m². Checkout isn't available yet; your cart is kept in this browser.")}</p>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function Stepper({ line }: { line: CartLine }) {
  const t = useT();
  const m2 = line.unit === "m2";
  return (
    <div className="flex h-9 items-center rounded-lg border border-slate-200">
      <button type="button" aria-label={t("Less")} onClick={() => setCartQuantity(line.key, line.quantity - 1)} className="flex size-9 items-center justify-center text-slate-500 hover:text-brand-navy">
        <Minus className="size-3.5" />
      </button>
      <input
        aria-label={m2 ? t("Square metres") : t("Quantity")}
        type="number"
        min="0"
        step={m2 ? "0.5" : "1"}
        value={line.quantity}
        onChange={(e) => setCartQuantity(line.key, Number(e.target.value) || 0)}
        className="h-full w-14 border-x border-slate-200 bg-transparent text-center text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      {m2 && <span className="ps-1 text-xs text-slate-400">m²</span>}
      <button type="button" aria-label={t("More")} onClick={() => setCartQuantity(line.key, line.quantity + 1)} className="flex size-9 items-center justify-center text-slate-500 hover:text-brand-navy">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
