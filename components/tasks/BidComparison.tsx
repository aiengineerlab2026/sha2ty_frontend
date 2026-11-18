"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Clock, Loader2, MapPin, MessageSquare, Star, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { formatPrice } from "@/lib/plan/pricing";
import { bidTotals, type BidRow, type TaskRow, type VendorProfileData } from "@/lib/tasks";

/** The customer's bids side by side: one column per vendor, one row per term (full names, never cut). The lowest
 * total and the fastest delivery are marked, never named the best. Once a vendor is chosen their bid comes first and
 * the others read "Not selected". Accepting asks in a modal that says what happens next. */
export function BidComparison({
  task, bids, profiles, busy, unread, onChat, onAccept,
}: {
  task: TaskRow;
  bids: BidRow[];
  profiles: Record<string, VendorProfileData | null>;
  busy: boolean;
  unread: (vendorId: string) => number;
  onChat: (vendorId: string) => void;
  onAccept: (bid: BidRow) => Promise<void>;
}) {
  const t = useT();
  const [asking, setAsking] = useState<BidRow | null>(null);
  const requested = task.spec.quantity ?? 1;
  const open = task.status === "published";
  const shown = bids.filter((b) => b.status !== "withdrawn");
  const live = shown.filter((b) => b.status === "submitted" || b.status === "accepted");
  // The chosen bid first, then the open ones by total, then the rest.
  const rank = (b: BidRow) => (b.id === task.awarded_bid_id ? 0 : b.status === "submitted" ? 1 : 2);
  const sorted = [...shown].sort((a, b) => rank(a) - rank(b) || bidTotals(a, requested).total - bidTotals(b, requested).total);
  const lowest = live.length > 1 ? Math.min(...live.map((b) => bidTotals(b, requested).total)) : null;
  const fastest = live.length > 1 ? Math.min(...live.map((b) => b.days)) : null;
  const name = (v: string) => profiles[v]?.vendor.name ?? t("Vendor");
  // The vendor's own words, in their own direction (Arabic right-to-left on an English page and back).
  const text = (v: string) => <span dir="auto" className="block">{v.trim() || "—"}</span>;

  const rows: { label: string; cell: (b: BidRow) => ReactNode }[] = [
    { label: "City", cell: (b) => <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 text-slate-400" aria-hidden /><span dir="auto">{profiles[b.vendor_id]?.vendor.location || "—"}</span></span> },
    {
      label: "Rating",
      cell: (b) => {
        const p = profiles[b.vendor_id];
        return p?.stats.rating != null ? <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-brand-amber text-brand-amber" aria-hidden />{p.stats.rating.toFixed(1)} ({p.stats.reviews})</span> : t("No reviews yet");
      },
    },
    { label: "Completed projects", cell: (b) => String(profiles[b.vendor_id]?.stats.completed_projects ?? 0) },
    {
      label: "Price",
      cell: (b) => {
        const { quantity, total, each } = bidTotals(b, requested);
        return (
          <div className="space-y-1">
            <p className="text-lg font-bold tabular-nums text-brand-navy">{formatPrice(total)}</p>
            <p className="text-xs text-slate-500">{t("Total for {n} pieces · {price} each", { n: quantity, price: formatPrice(Math.round(each)) })}</p>
            {b.price_basis === "per_item" && <p className="text-[11px] text-slate-400">{t("Quoted per piece: {price}", { price: formatPrice(b.price) })}</p>}
            {quantity !== requested && <p className="text-[11px] font-medium text-amber-700">{t("You asked for {n} pieces", { n: requested })}</p>}
            {lowest != null && total === lowest && b.status !== "rejected" && <Badge>{t("Lowest price")}</Badge>}
          </div>
        );
      },
    },
    {
      label: "Delivery",
      cell: (b) => (
        <div className="space-y-1">
          <p className="inline-flex items-center gap-1 font-semibold text-brand-navy"><Clock className="size-3.5" aria-hidden />{t("{n} days", { n: b.days })}</p>
          {fastest != null && b.days === fastest && b.status !== "rejected" && <div><Badge>{t("Fastest delivery")}</Badge></div>}
        </div>
      ),
    },
    { label: "Material and wood", cell: (b) => text(b.material) },
    { label: "Fabric", cell: (b) => text(b.fabric) },
    { label: "Installation", cell: (b) => (b.installation == null ? "—" : b.installation ? t("Included") : t("Not included")) },
    { label: "Warranty", cell: (b) => text(b.warranty) },
    { label: "Payment terms", cell: (b) => text(b.payment_terms) },
    { label: "Notes", cell: (b) => <p dir="auto" className="max-w-xs whitespace-pre-wrap text-slate-600">{b.note.trim() || "—"}</p> },
  ];

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold text-brand-navy"><Wallet className="size-4 text-[#b8731d]" aria-hidden /> {t("Compare bids ({n})", { n: shown.length })}</h2>
        {open && shown.length > 0 && <p className="text-xs text-slate-500">{t("Totals are for the whole request. Compare the terms, chat with vendors, then accept one bid.")}</p>}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">{t("No bids yet. Vendors who make this kind of furniture see your request and can ask you questions here.")}</p>
      ) : (
        <div className="overflow-x-auto [scrollbar-width:thin]">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky start-0 z-10 w-36 bg-white" />
                {sorted.map((b) => (
                  <th key={b.id} scope="col" className={`min-w-56 rounded-t-xl border-x border-t px-3 py-3 text-start align-top font-normal ${b.id === task.awarded_bid_id ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 bg-slate-50/60"}`}>
                    <Link dir="auto" href={`/vendors/${b.vendor_id}`} className="block font-semibold leading-snug text-brand-navy hover:underline">{name(b.vendor_id)}</Link>
                    <div className="mt-1.5">
                      {b.id === task.awarded_bid_id ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"><Check className="size-3" aria-hidden />{t("Selected")}</span>
                      ) : b.status === "rejected" ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{t("Not selected")}</span>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="sticky start-0 z-10 bg-white py-2.5 pe-3 text-start align-top text-xs font-medium text-slate-500">{t(row.label)}</th>
                  {sorted.map((b) => (
                    <td key={b.id} className={`border-x border-t px-3 py-2.5 align-top text-slate-700 ${b.id === task.awarded_bid_id ? "border-emerald-300 bg-emerald-50/30" : "border-slate-200"} ${b.status === "rejected" ? "opacity-60" : ""}`}>{row.cell(b)}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th className="sticky start-0 z-10 bg-white" />
                {sorted.map((b) => (
                  <td key={b.id} className={`rounded-b-xl border-x border-b border-t px-3 py-3 align-top ${b.id === task.awarded_bid_id ? "border-emerald-300 bg-emerald-50/30" : "border-slate-200"}`}>
                    <div className="flex flex-wrap gap-2">
                      {open && b.status === "submitted" && (
                        <button type="button" disabled={busy} onClick={() => setAsking(b)} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-amber px-3 text-xs font-semibold text-brand-navy transition hover:bg-[#e8952a] disabled:opacity-60">
                          <Check className="size-3.5" aria-hidden /> {t("Choose this vendor")}
                        </button>
                      )}
                      <button type="button" onClick={() => onChat(b.vendor_id)} className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-brand-navy transition hover:bg-slate-50">
                        <MessageSquare className="size-3.5" aria-hidden /> {t("Chat")}
                        {unread(b.vendor_id) > 0 && <span className="rounded-full bg-brand-amber px-1.5 text-[10px]">{unread(b.vendor_id)}</span>}
                      </button>
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {asking && (
        <Dialog open onOpenChange={(o) => !o && !busy && setAsking(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("Choose {name}?", { name: name(asking.vendor_id) })}</DialogTitle>
              <DialogDescription>{t("{total} for {n} pieces, delivered in {days} days.", { total: formatPrice(bidTotals(asking, requested).total), n: bidTotals(asking, requested).quantity, days: asking.days })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm text-slate-700">
              <p className="font-semibold text-brand-navy">{t("What happens next")}</p>
              <ol className="list-decimal space-y-1.5 ps-5">
                <li>{t("The request stops receiving bids. The other vendors' bids are marked not selected.")}</li>
                <li>{t("{name} sees your choice on the request and starts the work.", { name: name(asking.vendor_id) })}</li>
                <li>{asking.payment_terms.trim() ? t("You pay the vendor directly, as in their bid: {terms}", { terms: asking.payment_terms.trim() }) : t("You agree payment and delivery with the vendor in the chat. Nothing is paid on sha2ty.")}</li>
                <li>{t("When it is delivered, mark the request completed and review the vendor.")}</li>
              </ol>
              <p className="text-xs text-slate-500">{t("This cannot be undone.")}</p>
            </div>
            <DialogFooter>
              <button type="button" disabled={busy} onClick={() => setAsking(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">{t("Cancel")}</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onAccept(asking).then(() => setAsking(null))}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-amber px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60"
              >
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {t("Choose this vendor")}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

const Badge = ({ children }: { children: ReactNode }) => <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">{children}</span>;
