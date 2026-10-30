"use client";

import { useT } from "@/lib/i18n";
import { useState, type ReactNode } from "react";
import { ChevronDown, Ruler } from "lucide-react";
import type { CatalogModel, CompanyGroup } from "@/lib/plan/types";
import { Chip, PriceTag, rowClass } from "./SidebarStatus";

export function CompanyModelGroup({
  company,
  activeId,
  onPick,
  icon,
  showCompany = false,
}: {
  company: CompanyGroup;
  activeId: string | null;
  onPick: (model: CatalogModel) => void;
  /** Group header icon in place of the company logo (category groups). */
  icon?: ReactNode;
  /** Show each row's company (rows from several vendors in one group). */
  showCompany?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  return (
    <section className="px-3 pt-3">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md px-1 py-1 text-start text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-brand-navy"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon ? (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-amber-soft text-brand-navy">{icon}</span>
          ) : company.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logo_url} alt="" className="size-7 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-slate-200" />
          ) : (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-[11px] font-semibold normal-case text-white">
              {company.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate">{t(company.name)}</span>
        </span>
        <span className="flex items-center gap-1 font-medium normal-case tracking-normal text-slate-400">
          {company.models.length}
          <ChevronDown className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
        </span>
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 pb-1">
          {company.models.map((model) => (
            <li key={model.id}>
              <button type="button" onClick={() => onPick(model)} aria-pressed={activeId === model.id} className={`${rowClass(activeId === model.id)} !items-start`}>
                {/* Large photo so textures and colours are readable; zooms in on hover. */}
                <div className="relative size-22 shrink-0 overflow-hidden rounded-xl bg-slate-100 shadow-sm ring-1 ring-slate-900/10">
                  {model.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={model.thumbnail} alt="" loading="lazy" decoding="async" className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-125" />
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
                  <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-brand-navy">{model.title}</p>
                  {showCompany && <p className="truncate text-[11px] text-slate-500">{model.company}</p>}
                  <PriceTag price={model.price} unit={model.price_unit ?? "item"} />
                  <span className="mt-auto">
                    <Chip icon={<Ruler className="size-2.5 text-slate-400" aria-hidden />}>
                      {model.width_m && model.depth_m && model.height_m ? `${model.width_m.toFixed(2)} × ${model.depth_m.toFixed(2)} × ${model.height_m.toFixed(2)} m` : t("Size not set")}
                    </Chip>
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
