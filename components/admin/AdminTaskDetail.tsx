"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Mail, MapPin, Paperclip, Phone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DesignSpecView } from "@/components/tasks/DesignSpecView";
import { ReportButton } from "@/components/tasks/ReportButton";
import { formatPrice } from "@/lib/plan/pricing";
import type { BidRow, Proposal, TaskRow } from "@/lib/tasks";

type Person = { id?: string; name: string; email: string; phone: string };
type Thread = {
  vendor: Person & { logo_url: string | null; location: string; status?: string | null };
  bid: BidRow | null;
  hired: boolean;
  proposals: Proposal[];
  messages: { id: string; from: "vendor" | "customer"; body: string; attachment_url: string | null; created_at: string }[];
};
type Detail = { task: TaskRow; customer: Partial<Person>; vendors: Thread[] };

const card = "rounded-xl border border-slate-200 bg-white p-4";
const date = (iso: string) => new Date(iso).toLocaleString();

/** One request as the admin sees it (GET /api/admin/tasks/{id}): the customer's side (what they asked for, their
 * design, who they are) and the vendors' side (each one's offer, proposed changes and chat with the customer). */
export function AdminTaskDetail({ id, call, onClose }: { id: string; call: (path: string) => Promise<Record<string, unknown> | null>; onClose: () => void }) {
  const t = useT();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<"customer" | "vendors">("customer");

  useEffect(() => {
    call(`/tasks/${id}`).then(
      (body) => body && setDetail(body as unknown as Detail),
      (caught: Error) => setError(caught.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const task = detail?.task;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{task?.title ?? t("Request")}</DialogTitle>
          <DialogDescription>{task ? [t(task.status), date(task.created_at)].join(" · ") : t("Loading…")}</DialogDescription>
        </DialogHeader>
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {detail && task && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="tablist" className="inline-flex rounded-lg bg-slate-100 p-0.5 text-sm font-medium">
                {(["customer", "vendors"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={side === s}
                    onClick={() => setSide(s)}
                    className={`rounded-md px-3 py-1.5 ${side === s ? "bg-white text-brand-navy shadow-sm" : "text-slate-500 hover:text-brand-navy"}`}
                  >
                    {s === "customer" ? t("Customer") : `${t("Vendors")} · ${detail.vendors.length}`}
                  </button>
                ))}
              </div>
              <ReportButton taskId={task.id} />
            </div>
            {side === "customer" ? <CustomerSide detail={detail} /> : <VendorsSide threads={detail.vendors} />}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CustomerSide({ detail }: { detail: Detail }) {
  const t = useT();
  const { task, customer } = detail;
  const hired = detail.vendors.find((v) => v.hired);
  const facts: [string, ReactNode][] = [
    [t("Budget"), task.budget_max != null ? formatPrice(task.budget_max, "item") : "—"],
    [t("Deadline"), task.deadline ? new Date(task.deadline).toLocaleDateString() : "—"],
    [t("Location"), task.location || "—"],
    [t("Who can offer"), task.audience === "vendor_exclusive" ? t("Only the model's vendor") : t("Every approved vendor")],
    [t("Hired"), hired ? `${hired.vendor.name} · ${formatPrice(hired.bid?.price ?? null, "item")}` : "—"],
  ];
  return (
    <div className="space-y-4">
      <section className={card}>
        <h3 className="text-sm font-semibold text-brand-navy">{t("Customer")}</h3>
        {customer.email ? <Contact person={{ name: customer.name ?? "", email: customer.email, phone: customer.phone ?? "" }} /> : <p className="mt-1 text-sm text-slate-500">{t("Account not found.")}</p>}
      </section>
      <section className={card}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 sm:block">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="font-medium text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
        {task.description && <p className="mt-3 whitespace-pre-line border-t border-slate-100 pt-3 text-sm text-slate-700">{task.description}</p>}
      </section>
      {task.spec.design ? (
        <DesignSpecView spec={task.spec.design} quantity={task.spec.quantity ?? 1} download />
      ) : (
        (task.spec.lines ?? []).length > 0 && (
          <ul className={`${card} divide-y divide-slate-100 text-sm`}>
            {(task.spec.lines ?? []).map((line, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span>
                  {line.name} × {line.quantity} {line.unit}
                </span>
                <span className="tabular-nums">{formatPrice(line.total, "item")}</span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function VendorsSide({ threads }: { threads: Thread[] }) {
  const t = useT();
  if (!threads.length) return <p className="text-sm text-slate-500">{t("No vendor has offered, proposed changes or written yet.")}</p>;
  return (
    <div className="space-y-4">
      {threads.map((th) => (
        <VendorThread key={th.vendor.id} thread={th} />
      ))}
    </div>
  );
}

function VendorThread({ thread }: { thread: Thread }) {
  const t = useT();
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const { vendor, bid, proposals, messages } = thread;
  return (
    <section className={`${card} space-y-3 ${thread.hired ? "ring-2 ring-brand-amber/60" : ""}`}>
      <header className="flex items-start gap-3">
        {vendor.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={vendor.logo_url} alt="" className="size-10 shrink-0 rounded-full object-cover ring-1 ring-slate-200" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-navy text-sm font-semibold text-white">{(vendor.name || "?").slice(0, 1).toUpperCase()}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-brand-navy">
            {vendor.name || t("Unknown studio")}
            {thread.hired && <span className="rounded-full bg-brand-amber/20 px-2 py-0.5 text-xs font-medium text-brand-navy">{t("Hired")}</span>}
          </p>
          <Contact person={vendor} location={vendor.location} />
        </div>
      </header>

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
        {bid ? (
          <p>
            <span className="font-semibold tabular-nums">{formatPrice(bid.price, "item")}</span> · {t("{n} days", { n: bid.days })} · {t(bid.status)} · <span className="text-slate-500">{date(bid.created_at)}</span>
            {bid.note && <span className="mt-1 block whitespace-pre-line text-slate-700">{bid.note}</span>}
          </p>
        ) : (
          <p className="text-slate-500">{t("No offer yet.")}</p>
        )}
      </div>

      {proposals.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("Proposed changes")}</h4>
          {proposals.map((p) => (
            <div key={p.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                {p.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnail_url} alt="" className="size-14 rounded-md bg-slate-50 object-contain ring-1 ring-slate-200" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block">{p.note || t("No note.")}</span>
                  <span className="text-xs text-slate-500">
                    {t(p.status)} · {date(p.created_at)}
                  </span>
                </span>
                <button type="button" onClick={() => setOpenProposal(openProposal === p.id ? null : p.id)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-brand-navy ring-1 ring-slate-200 hover:bg-slate-50">
                  {openProposal === p.id ? t("Hide") : t("View")}
                </button>
              </div>
              {openProposal === p.id && <div className="mt-3"><DesignSpecView spec={p.spec} download /></div>}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("Chat with the customer")}</h4>
        {messages.length ? (
          <ol className="max-h-72 space-y-2 overflow-y-auto">
            {messages.map((m) => (
              <li key={m.id} className={`flex ${m.from === "vendor" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === "vendor" ? "bg-brand-navy text-white" : "bg-slate-100 text-slate-800"}`}>
                  <p className="text-[11px] opacity-70">
                    {m.from === "vendor" ? vendor.name || t("Vendor") : t("Customer")} · {date(m.created_at)}
                  </p>
                  {m.body && <p className="whitespace-pre-line">{m.body}</p>}
                  {m.attachment_url && (
                    <a href={m.attachment_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 underline">
                      <Paperclip className="size-3.5" aria-hidden /> {t("Attachment")}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-500">{t("No messages.")}</p>
        )}
      </div>
    </section>
  );
}

function Contact({ person, location }: { person: Person; location?: string }) {
  return (
    <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
      {person.name && <span className="font-medium text-slate-800">{person.name}</span>}
      {person.email && (
        <a href={`mailto:${person.email}`} className="inline-flex items-center gap-1 hover:text-brand-navy">
          <Mail className="size-3.5" aria-hidden /> <bdi>{person.email}</bdi>
        </a>
      )}
      {person.phone && (
        <a href={`tel:${person.phone}`} className="inline-flex items-center gap-1 hover:text-brand-navy">
          <Phone className="size-3.5" aria-hidden /> <bdi>{person.phone}</bdi>
        </a>
      )}
      {location && (
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3.5" aria-hidden /> {location}
        </span>
      )}
    </p>
  );
}
