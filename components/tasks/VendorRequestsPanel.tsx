"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Hammer, Package, Wallet } from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/plan/pricing";
import type { TaskRow } from "@/lib/tasks";

const SHOWN = 5;

/** Vendor home: the newest open requests this vendor can take (row-level security shows open ones and those made
 * for them only), each linking to its page to propose changes, ask or bid. */
export function VendorRequestsPanel() {
  const t = useT();
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void supabase()
      .from("freelance_tasks")
      .select("*", { count: "exact" })
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(SHOWN)
      .then(({ data, count, error: next }) => {
        if (next) setError(next.message);
        setTasks((data ?? []) as TaskRow[]);
        setTotal(count ?? data?.length ?? 0);
      });
  }, []);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Hammer className="size-5 text-brand-amber" aria-hidden />
          <h2 className="text-lg font-semibold text-brand-navy">{t("Open requests")}</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{total}</span>
        </div>
        <Link href="/vendor/tasks" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-navy hover:underline">
          {t("All requests")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>
      <p className="mt-1 text-sm text-slate-500">{t("Customers looking for a vendor. Open one to propose changes, ask a question or bid.")}</p>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {tasks === null && !error && <p className="mt-4 text-sm text-slate-500">{t("Loading…")}</p>}
      {tasks?.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">{t("No open requests right now.")}</p>}
      <ul className="mt-4 divide-y divide-slate-100">
        {(tasks ?? []).map((task) => {
          const design = task.spec.design;
          return (
            <li key={task.id}>
              <Link href={`/tasks/${task.id}`} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-slate-50">
                <span className="size-14 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                  {design?.thumbnail_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={design.thumbnail_url} alt="" className="size-full object-contain" loading="lazy" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-brand-navy">{task.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    {design && <span className="inline-flex items-center gap-1"><Package className="size-3" aria-hidden />{t("{n} pieces", { n: task.spec.quantity ?? 1 })}</span>}
                    <span className="inline-flex items-center gap-1"><Wallet className="size-3" aria-hidden />{task.budget_max != null ? t("up to {price}", { price: formatPrice(task.budget_max) }) : t("Open budget")}</span>
                    <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" aria-hidden />{task.deadline ? new Date(task.deadline).toLocaleDateString() : t("Flexible")}</span>
                    {task.audience === "vendor_exclusive" && <span className="rounded-full bg-amber-50 px-1.5 text-amber-800">{t("Only for you")}</span>}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-slate-400">{new Date(task.created_at).toLocaleDateString()}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
