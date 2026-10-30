"use client";

import { useT } from "@/lib/i18n";
import Link from "next/link";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { clearCart, lineTotal, setCartQuantity, useCart } from "@/lib/cart";
import { formatPrice } from "@/lib/plan/pricing";

const KIND = { model: "Furniture", carpet: "Carpet", wall: "Wall finish", floor: "Floor finish", window: "Window", door: "Door" } as const;

/** Header cart: lines with quantity steppers (pieces, or m² for area-priced finishes) and the total. */
export function CartMenu() {
  const t = useT();
  const lines = useCart();
  const total = lines.reduce((sum, l) => sum + (lineTotal(l) ?? 0), 0);
  // Badge: pieces for per-item lines, one per area-priced finish (its m² are not "items").
  const count = lines.reduce((n, l) => n + (l.unit === "m2" ? 1 : Math.round(l.quantity)), 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t(count === 1 ? "Cart, {n} item" : "Cart, {n} items", { n: count })}
          className="relative flex size-9 items-center justify-center rounded-lg border border-transparent text-slate-500 hover:border-slate-200 transition-colors hover:bg-slate-100 hover:text-brand-navy data-[state=open]:bg-slate-100 data-[state=open]:text-brand-navy"
        >
          <ShoppingCart className="size-4" />
          {count > 0 && (
            <span className="absolute -end-1 -top-1 flex h-[18px] min-w-[18px] animate-in zoom-in-50 items-center justify-center rounded-full bg-brand-amber px-1 text-[10px] font-bold text-brand-navy ring-2 ring-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-brand-navy">{t("Cart")}</h2>
          {lines.length > 0 && (
            <button type="button" onClick={clearCart} className="text-xs text-slate-500 hover:text-red-600">
              {t("Clear")}
            </button>
          )}
        </div>
        {lines.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">{t("Your cart is empty.")}</p>
        ) : (
          <ul className="max-h-80 divide-y divide-slate-100 overflow-auto">
            {lines.map((l) => {
              const step = 1; // one piece, or one m²
              return (
                <li key={l.key} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-brand-navy">{l.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {t(KIND[l.kind])} · {formatPrice(l.price, l.unit)}
                    </p>
                  </div>
                  <div className="flex items-center rounded-lg border border-slate-200">
                    <button type="button" aria-label={t("Less")} onClick={() => setCartQuantity(l.key, l.quantity - step)} className="flex size-6 items-center justify-center text-slate-500 hover:text-brand-navy">
                      {l.quantity - step > 0 ? <Minus className="size-3" /> : <Trash2 className="size-3" />}
                    </button>
                    <span className="min-w-9 text-center text-xs tabular-nums">
                      {l.quantity}
                      {l.unit === "m2" ? " m²" : ""}
                    </span>
                    <button type="button" aria-label={t("More")} onClick={() => setCartQuantity(l.key, l.quantity + step)} className="flex size-6 items-center justify-center text-slate-500 hover:text-brand-navy">
                      <Plus className="size-3" />
                    </button>
                  </div>
                  <span className="w-20 text-end text-xs font-semibold tabular-nums text-brand-navy">{lineTotal(l) == null ? "—" : formatPrice(lineTotal(l))}</span>
                </li>
              );
            })}
          </ul>
        )}
        {lines.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">{t("Total")}</span>
            <span className="text-base font-semibold tabular-nums text-brand-navy">{formatPrice(total)}</span>
          </div>
        )}
        <div className="border-t border-slate-100 p-3">
          <Link href="/cart" className="flex h-9 w-full items-center justify-center rounded-lg bg-brand-navy text-sm font-semibold text-white transition-colors hover:bg-brand-navy-hover">
            {t("View cart")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
