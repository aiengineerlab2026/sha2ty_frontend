"use client";

import { useT } from "@/lib/i18n";
import { formatPrice } from "@/lib/plan/pricing";
import type { ReactNode } from "react";

/** Bottom status bar shared by the catalogue tabs: a live count on the left, an action on the right. */
export function SidebarStatus({ count, noun, error, action }: { count: number; noun: [string, string]; error?: boolean; action?: ReactNode }) {
  const t = useT();
  return (
    <footer className="flex h-11 shrink-0 items-center justify-between border-t border-slate-200/80 bg-slate-50/80 px-3.5 text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className={`size-1.5 rounded-full ${error ? "bg-red-500" : "bg-emerald-500"}`} aria-hidden />
        {error ? t("Catalogue unavailable") : t(`{n} ${count === 1 ? noun[0] : noun[1]}`, { n: count })}
      </span>
      {action}
    </footer>
  );
}

export const SIDEBAR_ACTION =
  "rounded-md border border-transparent px-2 py-1 font-medium text-slate-600 transition-colors hover:border-slate-200 hover:bg-white hover:text-brand-navy hover:shadow-sm";

/** Catalogue row style: borderless until hovered; amber tint + left bar when selected. */
export const rowClass = (selected: boolean) =>
  `group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border p-2 text-start transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-amber/40 ${
    selected
      ? "border-brand-amber/50 bg-brand-amber-soft/50 shadow-sm before:absolute before:inset-y-2.5 before:start-0 before:w-0.5 before:rounded-full before:bg-brand-amber"
      : "border-transparent hover:-translate-y-px hover:border-slate-200 hover:bg-slate-50 hover:shadow-sm"
  }`;

/** Small pill for row metadata (size, tile, price). */
export function Chip({ icon, children, strong = false }: { icon?: ReactNode; children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors ${
        strong ? "bg-brand-navy/5 text-brand-navy" : "bg-slate-100 text-slate-600 group-hover:bg-white group-hover:ring-1 group-hover:ring-slate-200"
      }`}
    >
      {icon}
      <bdi dir="auto">{children}</bdi>
    </span>
  );
}

/** Row price: bold when set ("EGP 200 / m²"), muted "On request" when the vendor gave none. */
export function PriceTag({ price, unit }: { price: number | null | undefined; unit: "item" | "m2" }) {
  const t = useT();
  if (price == null || Number.isNaN(Number(price))) return <span className="shrink-0 text-[11px] font-medium text-slate-400">{t("On request")}</span>;
  return <span className="shrink-0 text-[11px] font-semibold tabular-nums text-brand-navy">{formatPrice(Number(price), unit)}</span>;
}
