"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Gavel, MapPin, Package, Ruler, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/shatably/Header";
import { authSession } from "@/lib/auth/client";
import { formatPrice } from "@/lib/plan/pricing";
import { supabase } from "@/lib/supabase/client";
import { type BidRow, type TaskRow } from "@/lib/tasks";
import type { VendorProfile } from "@/lib/vendor/types";

const STATUS: Record<TaskRow["status"], string> = {
  published: "Receiving bids",
  awarded: "Vendor chosen",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const TONE: Record<TaskRow["status"], string> = {
  published: "bg-amber-50 text-amber-800 ring-amber-200",
  awarded: "bg-sky-50 text-sky-800 ring-sky-200",
  in_progress: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
};

const FILTERS: (TaskRow["status"] | "all")[] = ["all", "published", "awarded", "in_progress", "completed", "cancelled"];

/** Requests: a customer's own (with how many bids came in), or for a vendor the open ones plus those they bid on. */
export function RequestList({ as }: { as: "customer" | "vendor" }) {
  const t = useT();
  const router = useRouter();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [bids, setBids] = useState<BidRow[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskRow["status"] | "all">("all");

  useEffect(() => {
    void authSession().then(async ({ data }) => {
      if (!data.session) {
        router.push(`/vendor/login?next=${encodeURIComponent(as === "vendor" ? "/vendor/tasks" : "/tasks")}`);
        return;
      }
      const uid = data.session.user.id;
      setMe(uid);
      const profile = await supabase().from("vendors").select("*").eq("id", uid).maybeSingle();
      setVendor(profile.data);
      const [tasks, visibleBids] = await Promise.all([
        supabase().from("freelance_tasks").select("*").order("created_at", { ascending: false }).limit(200),
        supabase().from("task_bids").select("*").limit(1000),
      ]);
      if (tasks.error) {
        setError(tasks.error.message);
        return;
      }
      const all = (tasks.data ?? []) as TaskRow[];
      setRows(as === "customer" ? all.filter((x) => x.customer_id === uid) : all.filter((x) => x.customer_id !== uid));
      setBids((visibleBids.data ?? []) as BidRow[]);
    });
  }, [as, router]);

  return (
    <div className="min-h-full bg-slate-50">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{as === "customer" ? t("My requests") : t("Customer requests")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {as === "customer" ? t("Models and plans you asked vendors to make. Open one to compare bids and chat.") : t("Customers looking for a vendor. Each shows the exact model they want made.")}
        </p>
        {rows && rows.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2" role="tablist">
            {FILTERS.filter((f) => ["all", "published", "in_progress", "completed"].includes(f) || rows.some((r) => r.status === f)).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${filter === f ? "bg-slate-900 text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-900"}`}>
                {f === "all" ? t("All") : t(STATUS[f])} <span className="ms-1 tabular-nums opacity-70">{f === "all" ? rows.length : rows.filter((r) => r.status === f).length}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        {rows === null && !error && <p className="mt-6 text-sm text-slate-500">{t("Loading…")}</p>}
        <ul className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {(rows ?? []).filter((task) => filter === "all" || task.status === filter).map((task) => {
            const design = task.spec.design;
            const taskBids = bids.filter((b) => b.task_id === task.id && b.status !== "withdrawn");
            const mine = bids.find((b) => b.task_id === task.id && b.vendor_id === me);
            const size = design?.dimensions;
            const count = taskBids.length;
            const facts: { icon: typeof Ruler; label: string; value: string; strong?: boolean }[] = [
              { icon: Ruler, label: "Size", value: size ? `${(["width", "height", "depth"] as const).map((k) => Math.round(size[k] * 100)).join(" × ")} cm` : "—" },
              ...(design ? [{ icon: Package, label: "Pieces", value: String(task.spec.quantity ?? 1), strong: (task.spec.quantity ?? 1) > 1 }] : []),
              { icon: Wallet, label: "Budget", value: task.budget_max != null ? t("up to {price}", { price: formatPrice(task.budget_max) }) : t("Open budget"), strong: task.budget_max != null },
              { icon: CalendarDays, label: "Wanted by", value: task.deadline ? new Date(task.deadline).toLocaleDateString() : t("Flexible") },
              { icon: MapPin, label: "Location", value: task.location || "—" },
            ];
            return (
              <li key={task.id}>
                <Link
                  href={`/tasks/${task.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-amber"
                >
                  {/* The model on a soft studio backdrop, status on the image. */}
                  <span className="relative block h-52 w-full bg-[radial-gradient(ellipse_at_50%_35%,#ffffff_0%,#f1f5f9_60%,#e2e8f0_100%)]">
                    {design?.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={design.thumbnail_url} alt="" className="size-full object-contain p-4 drop-shadow-[0_10px_18px_rgba(15,23,42,0.18)] transition duration-300 group-hover:scale-105" />
                    ) : (
                      <span className="flex size-full items-center justify-center text-xs text-slate-400">{t("No preview")}</span>
                    )}
                    <span className={`absolute end-3 top-3 rounded-full px-2.5 py-1 text-xs font-medium shadow-sm ring-1 backdrop-blur ${TONE[task.status]}`}>{t(STATUS[task.status])}</span>
                  </span>

                  <span className="flex flex-1 flex-col gap-4 p-4">
                    <span className="block min-w-0">
                      <span className="block truncate text-lg font-semibold tracking-tight text-slate-900">{task.title}</span>
                      {task.description && <span className="mt-0.5 line-clamp-1 block text-sm text-slate-500">{task.description}</span>}
                    </span>
                    <span className="grid grid-cols-2 gap-x-3 gap-y-3">
                      {facts.map(({ icon: Icon, label, value, strong }) => (
                        <span key={label} className="flex min-w-0 items-start gap-2">
                          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                            <Icon className="size-3.5" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[11px] text-slate-400">{t(label)}</span>
                            <bdi className={`block truncate text-sm tabular-nums ${strong ? "font-semibold text-brand-navy" : "text-slate-700"}`}>{value}</bdi>
                          </span>
                        </span>
                      ))}
                    </span>
                    <span className="mt-auto flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1.5">
                        <Gavel className="size-4 text-slate-400" aria-hidden />
                        {as === "customer" ? t("Bids received") : t("Your bid")}
                      </span>
                      {as === "customer" ? (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${count ? "bg-brand-amber text-brand-navy" : "bg-slate-200 text-slate-500"}`}>{count}</span>
                      ) : (
                        <span className={`text-sm font-semibold tabular-nums ${mine ? "text-brand-navy" : "text-slate-400"}`}>{mine ? formatPrice(mine.price) : t("None yet")}</span>
                      )}
                    </span>
                  </span>

                  <span className="border-t border-slate-100 bg-slate-50/50 p-4">
                    <span className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors group-hover:bg-slate-800">
                      {as === "customer" ? t("View bids & chat") : mine ? t("View your bid") : t("View & bid")}
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {rows && rows.length > 0 && !rows.some((task) => filter === "all" || task.status === filter) && (
          <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">{t("Nothing here yet.")}</p>
        )}
        {rows?.length === 0 && (
          <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            {as === "customer" ? t("No requests yet. Open a customised model in My designs and choose “Request implementation”.") : t("No open requests right now.")}
          </p>
        )}
      </main>
    </div>
  );
}
