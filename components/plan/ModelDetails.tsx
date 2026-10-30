"use client";

import { useT } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { Armchair, Check, PanelRightClose, ShoppingCart } from "lucide-react";
import { addToCart } from "@/lib/cart";
import { ImageCarousel } from "@/components/shatably/ImageCarousel";
import { RatingSummary } from "@/components/shatably/Reviews";
import { formatPrice } from "@/lib/plan/pricing";
import type { CatalogModel } from "@/lib/plan/types";

/** Docked end-hand panel for a catalogue item: photos and variants, title, description, size, "Show in my apartment". */
export function ModelDetails({ model, onClose, onShow }: { model: CatalogModel; onClose: () => void; onShow: () => void }) {
  const t = useT();
  const photos = useMemo(() => [...new Set([model.thumbnail, ...(model.variants ?? [])].filter((u): u is string => Boolean(u)))], [model]);
  const [added, setAdded] = useState(false);
  const description = useMemo(() => safeHtml(model.description ?? ""), [model.description]);
  const dims = model.width_m && model.height_m && model.depth_m ? `${model.width_m.toFixed(2)} × ${model.height_m.toFixed(2)} × ${model.depth_m.toFixed(2)} m` : null;

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
      {/* Main photo + variants as a swipeable carousel. */}
      <div className="mx-4 mt-4 shrink-0">
        <ImageCarousel images={photos} alt={model.title} className="aspect-4/3" />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {model.company_logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={model.company_logo} alt="" className="size-5 rounded-md bg-white object-contain ring-1 ring-slate-200" />
            )}
            {model.company}
          </p>
          <h3 className="mt-0.5 text-lg font-semibold leading-snug tracking-tight text-brand-navy">{model.title}</h3>
          <RatingSummary kind="model" itemId={model.id} href={`/catalog/models/${model.id}#reviews-title`} />
        </div>
        <p className="text-xl font-semibold tabular-nums text-brand-navy">{formatPrice(model.price, model.price_unit ?? "item")}</p>
        {dims && <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[11px] tabular-nums text-slate-600">{dims}</span>}
        {description ? (
          <div className="text-sm leading-relaxed text-slate-600 [&_h3]:mt-2 [&_h3]:font-semibold [&_h3]:text-brand-navy [&_li]:ms-4 [&_ol]:list-decimal [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: description }} />
        ) : (
          <p className="text-sm text-slate-400">{t("No description.")}</p>
        )}
      </div>
      <div className="shrink-0 space-y-2 border-t border-slate-100 p-4">
        <button
          type="button"
          onClick={onShow}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-amber text-sm font-semibold text-brand-navy shadow-sm shadow-brand-amber/30 transition hover:-translate-y-px hover:bg-[#e8952a] hover:shadow-md active:translate-y-0"
        >
          <Armchair className="size-4" aria-hidden /> {t("Show in my apartment")}
        </button>
        <button
          type="button"
          onClick={() => {
            const unit = model.price_unit ?? "item";
            // A per-m² model is sold by its footprint.
            const quantity = unit === "m2" && model.width_m && model.depth_m ? model.width_m * model.depth_m : 1;
            addToCart([{ key: `model:${model.id}`, kind: "model", refId: model.id, name: model.title, quantity, unit, price: model.price ?? null }]);
            setAdded(true);
            setTimeout(() => setAdded(false), 1500);
          }}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-brand-navy transition-colors hover:bg-slate-50"
        >
          {added ? <Check className="size-4 text-emerald-600" aria-hidden /> : <ShoppingCart className="size-4" aria-hidden />}
          {added ? t("Added to cart") : t("Add to cart")}
        </button>
      </div>
    </aside>
  );
}

const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "P", "BR", "DIV", "SPAN", "H3"]);

/** Vendor HTML comes from another account: keep basic formatting tags only, drop every attribute. */
export function safeHtml(html: string) {
  if (!html || typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const clean = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent ?? "");
    if (!(node instanceof Element)) return null;
    const kids = [...node.childNodes].map(clean).filter((n): n is Node => n !== null);
    if (!ALLOWED.has(node.tagName)) {
      if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(node.tagName)) return null;
      const frag = document.createDocumentFragment();
      kids.forEach((k) => frag.appendChild(k)); // unknown tag: keep its text
      return frag;
    }
    const el = document.createElement(node.tagName.toLowerCase());
    kids.forEach((k) => el.appendChild(k));
    return el;
  };
  const out = document.createElement("div");
  [...doc.body.childNodes].map(clean).forEach((n) => n && out.appendChild(n));
  return out.innerHTML.trim();
}
