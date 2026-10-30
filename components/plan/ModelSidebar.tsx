"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fetchCatalog } from "@/lib/plan/api";
import type { CatalogModel, CompanyGroup } from "@/lib/plan/types";
import { CompanyModelGroup } from "./CompanyModelGroup";
import { SIDEBAR_ACTION, SidebarStatus } from "./SidebarStatus";
import { CategoryIcon } from "@/components/shatably/CategoryIcon";
import { CATEGORIES, categoryOf } from "@/lib/plan/categories";

export function ModelSidebar({ activeId, onPick }: { activeId: string | null; onPick: (model: CatalogModel) => void }) {
  const t = useT();
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const handle = setTimeout(() => {
      void fetchCatalog(q, 0)
        .then((data) => {
          setGroups(data.companies);
          setOffset(data.count);
          setError(null);
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
    }, 200);
    return () => clearTimeout(handle);
  }, [q]);

  const visible = useMemo(() => {
    if (company === "all") return groups;
    return groups.filter((group) => group.id === company);
  }, [groups, company]);

  const byCategory = useMemo(() => {
    const models = visible.flatMap((g) => g.models);
    return CATEGORIES.map((c) => ({ id: c.id, name: c.label, logo_url: null, models: models.filter((m) => categoryOf(m.category) === c.id) })).filter((g) => g.models.length);
  }, [visible]);

  return (
    <aside className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 px-3 pb-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            aria-label={t("Search models")}
            placeholder={t("Search models")}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="h-9 rounded-lg border-slate-200 bg-slate-50/70 ps-9 text-sm shadow-none transition-colors placeholder:text-slate-400 hover:bg-white focus-visible:border-brand-amber focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-brand-amber/20"
          />
        </div>
        <div className="relative">
          <Building2 className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <select
            aria-label={t("Company")}
            className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-slate-50/70 ps-9 pe-8 text-sm text-slate-700 outline-none transition-colors hover:bg-white focus:border-brand-amber focus:bg-white focus:ring-[3px] focus:ring-brand-amber/20"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          >
            <option value="all">{t("All companies")}</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100">
        {error && <p className="m-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        {/* One group per category (Furniture, TV & AV, Lights, Ceiling lights, Air conditioners). */}
        {byCategory.map((group) => (
          <CompanyModelGroup key={group.id} company={group} activeId={activeId} onPick={onPick} icon={<CategoryIcon category={group.id} className="size-3.5" />} showCompany />
        ))}
        {byCategory.length === 0 && !error && <p className="p-4 text-center text-sm text-slate-400">{t("No ready models with a GLB yet.")}</p>}
      </div>
      <SidebarStatus
        count={visible.reduce((n, g) => n + g.models.length, 0)}
        noun={["model", "models"]}
        error={Boolean(error)}
        action={
          <button
            type="button"
            className={SIDEBAR_ACTION}
            onClick={() => {
              void fetchCatalog(q, offset).then((data) => {
                setGroups((current) => mergeGroups(current, data.companies));
                setOffset(offset + data.count);
              });
            }}
          >
            {t("Load more")}
          </button>
        }
      />
    </aside>
  );
}

function mergeGroups(current: CompanyGroup[], extra: CompanyGroup[]): CompanyGroup[] {
  const map = new Map(current.map((group) => [group.id, { ...group, models: [...group.models] }]));
  for (const group of extra) {
    const existing = map.get(group.id);
    if (!existing) map.set(group.id, group);
    else {
      const ids = new Set(existing.models.map((model) => model.id));
      existing.models.push(...group.models.filter((model) => !ids.has(model.id)));
    }
  }
  return [...map.values()];
}
