"use client";

import { useT } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { Check, ChevronUp, Receipt, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";
import { addToCart } from "@/lib/cart";
import { formatPrice, planCost } from "@/lib/plan/pricing";
import { publishTask } from "@/lib/tasks";
import type { PlacedItem, PlanGeometry } from "@/lib/plan/types";

/** Running cost of the plan: models and carpets by the piece, paints and floors by the m² they cover. */
export function PlanEstimate({ geometry, items, onOffer, title }: { geometry: PlanGeometry; items: PlacedItem[]; onOffer?: () => Promise<string>; title?: string }) {
  const t = useT();
  const router = useRouter();
  const { lines, total, unpriced } = useMemo(() => planCost(geometry, items), [geometry, items]);
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const [offering, setOffering] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  if (!lines.length && !onOffer) return null;
  return (
    <div className="absolute bottom-4 end-4 z-10 w-[min(22rem,calc(100%-2rem))] overflow-hidden rounded-2xl border border-white/70 bg-white/90 shadow-lg shadow-slate-900/10 backdrop-blur-md">
      {open && (
        <div className="max-h-64 overflow-auto border-b border-slate-100">
          <ul className="divide-y divide-slate-100 text-xs">
            {lines.map((l) => (
              <li key={l.key} className="flex items-center gap-3 px-4 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-700">{l.name}</p>
                  <p className="text-[11px] tabular-nums text-slate-400">
                    {l.unit === "m2" ? `${l.quantity.toFixed(2)} m²` : `${l.quantity} ×`} {formatPrice(l.price, l.unit)}
                  </p>
                </div>
                <span className="font-semibold tabular-nums text-brand-navy">{l.total == null ? "—" : formatPrice(l.total)}</span>
              </li>
            ))}
          </ul>
          {unpriced > 0 && <p className="px-4 pb-2 text-[11px] text-amber-700">{unpriced} without a price (not in the total).</p>}
          <div className="p-3">
            <button
              type="button"
              onClick={() => {
                addToCart(lines.map(({ key, kind, refId, name, quantity, unit, price }) => ({ key, kind, refId, name, quantity, unit, price })));
                setAdded(true);
                setTimeout(() => setAdded(false), 1500);
              }}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-brand-amber text-sm font-semibold text-brand-navy shadow-sm transition-colors hover:bg-[#e8952a]"
            >
              {added ? <Check className="size-4" aria-hidden /> : <ShoppingCart className="size-4" aria-hidden />}
              {added ? t("Added to cart") : t("Add plan to cart")}
            </button>
            {onOffer && (
              <div className="px-3 pb-3">
                <button
                  type="button"
                  disabled={offering}
                  onClick={() => {
                    setOffering(true);
                    setOfferError(null);
                    onOffer()
                      .then((planId) => publishTask({
                        planId,
                        title: title?.trim() || "Untitled plan",
                        description: "",
                        location: "",
                        spec: {
                          lines,
                          total,
                          note: "Paint and floor areas are the surfaces in the plan. Door and window openings are not subtracted.",
                          furniture: items.map((item) => ({
                            instanceId: item.instanceId,
                            modelId: item.modelId,
                            title: item.title,
                            dimensions: { width: item.width_m, height: item.height_m, depth: item.depth_m },
                            catalogSize: item.catalogSize,
                            materialEdits: item.materialEdits,
                            partPoses: item.partPoses,
                            surfaceMaterials: item.surfaceMaterials,
                            x: item.x,
                            z: item.z,
                            rotation_y: item.rotation_y,
                          })),
                        },
                      }))
                      .then((id) => router.push(`/tasks/${id}`))
                      .catch((caught: Error) => setOfferError(caught.message))
                      .finally(() => setOffering(false));
                  }}
                  className="mt-2 h-9 w-full rounded-xl border border-slate-200 text-sm font-semibold text-brand-navy"
                >
                  {offering ? t("Publishing…") : t("Offer this plan to vendors")}
                </button>
                {offerError && <p className="mt-1 text-[11px] text-red-700">{offerError}</p>}
              </div>
            )}
          </div>
        </div>
      )}
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-start transition-colors hover:bg-slate-50/80">
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-amber-soft text-brand-navy">
          <Receipt className="size-3.5" aria-hidden />
        </span>
        <span className="text-xs text-slate-500">{t("Plan estimate")}</span>
        <span className="ms-auto text-sm font-semibold tabular-nums text-brand-navy">{formatPrice(total)}</span>
        <ChevronUp className={`size-4 text-slate-400 transition-transform ${open ? "" : "rotate-180"}`} aria-hidden />
      </button>
    </div>
  );
}
