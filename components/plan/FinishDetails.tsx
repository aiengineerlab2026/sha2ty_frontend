"use client";

import { useT } from "@/lib/i18n";
import { useState } from "react";
import { Check, PaintRoller, PanelRightClose, ShoppingCart, Square } from "lucide-react";
import { PaintSwatch } from "@/components/vendor/PaintLibrary";
import { addToCart } from "@/lib/cart";
import { useVariantUrls } from "@/lib/catalog/variants";
import { ImageCarousel } from "@/components/shatably/ImageCarousel";
import { RatingSummary } from "@/components/shatably/Reviews";
import { formatPrice, tilesFor, type FinishUsage } from "@/lib/plan/pricing";
import { tileLabel, tileSize } from "@/lib/plan/roomMaterials";
import type { Carpet, Paint, WindowItem } from "@/lib/vendor/types";

export type Finish = { kind: "paint"; paint: Paint } | { kind: "carpet"; carpet: Carpet } | { kind: "window"; window: WindowItem };

/**
 * Docked details panel for a paint / floor finish or a carpet: preview, price, facts, and the two
 * actions "Apply to apartment" (start painting / laying) and "Add to cart".
 * The panel stays open while applying: `usage` (where the finish is used, live) shows each floor's
 * area, the tiles it takes and the price, and `applying` turns the main button into "Stop applying".
 */
export function FinishDetails({
  item,
  usage,
  applying = false,
  onClose,
  onApply,
  onStop,
}: {
  item: Finish;
  usage?: FinishUsage;
  applying?: boolean;
  onClose: () => void;
  onApply: () => void;
  onStop: () => void;
}) {
  const t = useT();
  const coveredM2 = usage?.area ?? 0;
  const [added, setAdded] = useState(false);
  const isPaint = item.kind === "paint";
  // Carpets and windows are both an image at a real size: width × length (floor) or width × height (wall).
  const flat =
    item.kind === "carpet"
      ? { id: item.carpet.id, name: item.carpet.name, image: item.carpet.image_url, w: Number(item.carpet.width_m), h: Number(item.carpet.length_m), second: "Length", price: item.carpet.price, unit: item.carpet.price_unit, cart: "carpet" as const }
      : item.kind === "window"
        ? { id: item.window.id, name: item.window.name, image: item.window.image_url, w: Number(item.window.width_m), h: Number(item.window.height_m), second: "Height", price: item.window.price, unit: item.window.price_unit, cart: "window" as const }
        : null;
  const name = isPaint ? item.paint.name : flat!.name;
  const itemKind = isPaint ? "paint" : item.kind === "window" ? "window" : "carpet";
  const itemId = isPaint ? item.paint.id : flat!.id;
  const variants = useVariantUrls(itemKind, itemId);
  const price = Number((isPaint ? item.paint.price : flat!.price) ?? NaN);
  const unit = (isPaint ? item.paint.price_unit : flat!.unit) ?? (isPaint ? "m2" : "item");
  const floor = isPaint && item.paint.surface === "floor";
  const tag = isPaint ? (floor ? t("Floor finish") : item.paint.kind === "color" ? t("Wall paint") : t("Wall texture")) : item.kind === "window" ? t("Window") : t("Carpet");
  const facts: [string, string][] = isPaint
    ? [
        ["For", floor ? t("Floors") : t("Walls")],
        ["Type", item.paint.kind === "color" ? t("Colour") : t("Texture")],
        item.paint.kind === "color" ? ["Colour", item.paint.color.toUpperCase()] : ["Tile", tileLabel(item.paint).replace(" tile", "")],
      ]
    : [
        ["Width", `${flat!.w.toFixed(2)} m`],
        [flat!.second, `${flat!.h.toFixed(2)} m`],
        ["Area", `${(flat!.w * flat!.h).toFixed(2)} m²`],
      ];

  const addLine = () => {
    if (isPaint) {
      const p = item.paint;
      // Per m²: what the plan already covers with it (at least 1 m²); a total price is one piece.
      const quantity = unit === "m2" ? Math.max(1, Math.round((coveredM2 ?? 0) * 100) / 100) : 1;
      addToCart([{ key: `${floor ? "floor" : "wall"}:${p.id}`, kind: floor ? "floor" : "wall", refId: p.id, name: p.name, quantity, unit, price: p.price == null ? null : Number(p.price) }]);
    } else {
      const f = flat!;
      const quantity = unit === "m2" ? f.w * f.h : 1;
      addToCart([{ key: `${f.cart}:${f.id}`, kind: f.cart, refId: f.id, name: f.name, quantity, unit, price: f.price == null ? null : Number(f.price) }]);
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  // Docked beside the plan on desktop; a bottom sheet over it on phones.
  return (
    <aside aria-label={t("Item details")} className="flex h-full w-80 shrink-0 animate-in slide-in-from-right-4 fade-in flex-col border-s border-slate-200 bg-white duration-200 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-[72dvh] max-md:w-full max-md:rounded-t-2xl max-md:border-s-0 max-md:border-t max-md:shadow-2xl max-md:slide-in-from-bottom-8">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-100 px-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("Item details")}</h2>
        <button
          type="button"
          aria-label={t("Close details")}
          title={t("Close")}
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-navy"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>
      {/* Main image (texture / cut-out) + variant photos as a carousel; a colour paint keeps its swatch. */}
      <div className="mx-4 mt-4 shrink-0 space-y-2">
        {isPaint && item.paint.kind === "color" ? (
          <>
            <PaintSwatch paint={item.paint} className="aspect-4/3 w-full rounded-xl ring-1 ring-slate-200/70" />
            {variants.length > 0 && <ImageCarousel images={variants} alt={name} className="aspect-video" />}
          </>
        ) : (
          <ImageCarousel images={[isPaint ? item.paint.texture_url! : flat!.image, ...variants]} alt={name} className="aspect-4/3" checker={!isPaint} />
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{tag}</p>
          <h3 className="mt-0.5 text-lg font-semibold leading-snug tracking-tight text-brand-navy">{name}</h3>
          <RatingSummary kind={itemKind} itemId={itemId} href={`/catalog/${itemKind}s/${itemId}#reviews-title`} />
        </div>
        <p className="text-xl font-semibold tabular-nums text-brand-navy">{formatPrice(Number.isNaN(price) ? null : price, unit)}</p>
        <dl className="grid grid-cols-3 gap-2">
          {facts.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2">
              <dt className="text-[10px] text-slate-500">{t(label)}</dt>
              <dd className="truncate text-xs font-semibold tabular-nums text-brand-navy">{value}</dd>
            </div>
          ))}
        </dl>
        {isPaint && usage && <UsageTable paint={item.paint} usage={usage} price={Number.isNaN(price) ? null : price} unit={unit} />}
        <p className="text-xs leading-relaxed text-slate-500">
          {isPaint
            ? t(floor ? "Apply it, then click a room's floor to finish it. Esc stops." : "Apply it, then click a wall face to finish it. Esc stops.")
            : item.kind === "window"
              ? t("Apply it, then click a wall face to place it there at its real size. Esc cancels.")
              : t("Apply it, then click the floor to lay it at its real size. Y / T turn it, F / V tilt it, Esc cancels.")}
        </p>
      </div>
      <div className="shrink-0 space-y-2 border-t border-slate-100 p-4">
        {applying ? (
          <button
            type="button"
            onClick={onStop}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-brand-amber bg-brand-amber-soft text-sm font-semibold text-brand-navy transition-colors hover:bg-amber-100"
          >
            <Square className="size-3.5 fill-current" aria-hidden /> {t("Stop applying")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onApply}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-amber text-sm font-semibold text-brand-navy shadow-sm shadow-brand-amber/30 transition hover:-translate-y-px hover:bg-[#e8952a] hover:shadow-md active:translate-y-0"
          >
            <PaintRoller className="size-4" aria-hidden /> {t("Apply to apartment")}
          </button>
        )}
        <button
          type="button"
          onClick={addLine}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-brand-navy transition-colors hover:bg-slate-50"
        >
          {added ? <Check className="size-4 text-emerald-600" aria-hidden /> : <ShoppingCart className="size-4" aria-hidden />}
          {added ? t("Added to cart") : t("Add to cart")}
        </button>
      </div>
    </aside>
  );
}

/** Where the finish is used: per floor area, tiles needed (textures) and price; walls as one row; totals. */
function UsageTable({ paint, usage, price, unit }: { paint: Paint; usage: FinishUsage; price: number | null; unit: "item" | "m2" }) {
  const t = useT();
  const [tw, th] = tileSize(paint);
  const textured = paint.kind === "texture";
  const cost = (area: number) => (price == null ? null : unit === "m2" ? price * area : null);
  const rows = [
    ...usage.floors.map((f) => ({ key: f.id, name: f.name, area: f.area })),
    ...(usage.wallFaces ? [{ key: "walls", name: `${usage.wallFaces} wall ${usage.wallFaces === 1 ? "face" : "faces"}`, area: usage.wallArea }] : []),
  ];
  if (!rows.length) return <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{t("Not used in this plan yet.")}</p>;
  const total = unit === "m2" ? cost(usage.area) : price;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-2.5 py-1.5 text-start font-semibold">{t("Used in")}</th>
            <th className="px-2 py-1.5 text-end font-semibold">m²</th>
            {textured && <th className="px-2 py-1.5 text-end font-semibold">{t("Tiles")}</th>}
            <th className="px-2.5 py-1.5 text-end font-semibold">{t("Price")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="max-w-0 truncate px-2.5 py-1.5 text-slate-700">{r.name}</td>
              <td className="px-2 py-1.5 text-end text-slate-600">{r.area.toFixed(2)}</td>
              {textured && <td className="px-2 py-1.5 text-end text-slate-600">{tilesFor(r.area, tw, th)}</td>}
              <td className="px-2.5 py-1.5 text-end text-slate-600">{cost(r.area) == null ? "—" : formatPrice(cost(r.area))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-slate-200 bg-brand-amber-soft/50 font-semibold text-brand-navy tabular-nums">
          <tr>
            <td className="px-2.5 py-2">{t("Total")}</td>
            <td className="px-2 py-2 text-end">{usage.area.toFixed(2)}</td>
            {textured && <td className="px-2 py-2 text-end">{rows.reduce((n, r) => n + tilesFor(r.area, tw, th), 0)}</td>}
            <td className="px-2.5 py-2 text-end">{formatPrice(total)}</td>
          </tr>
        </tfoot>
      </table>
      {textured && <p className="border-t border-slate-100 px-2.5 py-1.5 text-[10px] text-slate-400">Tiles per {tileLabel(paint).replace(" tile", "")} tile, cut pieces counted whole.</p>}
    </div>
  );
}
