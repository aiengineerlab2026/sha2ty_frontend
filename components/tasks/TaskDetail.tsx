"use client";

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, MessageSquare, PencilRuler, Star } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { authSession } from "@/lib/auth/client";
import { formatPrice } from "@/lib/plan/pricing";
import { supabase } from "@/lib/supabase/client";
import {
  acceptBid, advanceTask, decideProposal, listProposals, loadTask, myReview, onMessages, placeBid, reviewVendor, reviseBid, taskMessages, vendorProfile,
  type BidRow, type Message, type Proposal, type TaskRow, type VendorProfileData,
} from "@/lib/tasks";
import type { VendorProfile } from "@/lib/vendor/types";
import { DesignSpecView } from "./DesignSpecView";
import { ReportButton } from "./ReportButton";
import { TaskChat } from "./TaskChat";

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

/** One request. The customer compares bids (with each vendor's profile), chats with any bidder, hires one,
 * follows the work up with them and reviews them at the end. A vendor sees the full model specification, asks
 * questions, bids, revises or withdraws, and starts the work once hired. */
export function TaskDetail({ id }: { id: string }) {
  const t = useT();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [bids, setBids] = useState<BidRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, VendorProfileData | null>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [shownProposal, setShownProposal] = useState<string | null>(null); // the one opened in 3D
  // ?chat=<vendor id>: opened from a notification.
  const [chatWith, setChatWith] = useState<string | null>(useSearchParams().get("chat"));
  const [review, setReview] = useState<{ rating: number; comment: string } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const next = await loadTask(id);
    setTask(next.task);
    setBids(next.bids);
    const thread = await taskMessages(id).catch(() => [] as Message[]);
    setMessages(thread);
    // Before proposals.sql (or for plan requests) there are none.
    const offered = next.task?.spec.design ? await listProposals(id).catch(() => [] as Proposal[]) : [];
    setProposals(offered);
    if (next.task?.status === "completed") setReview(await myReview(id));
    // Bidders, and vendors who wrote before bidding.
    const ids = [...new Set([...next.bids.map((b) => b.vendor_id), ...thread.map((m) => m.vendor_id), ...offered.map((p) => p.vendor_id)])];
    const loaded = await Promise.all(ids.map((v) => vendorProfile(v).catch(() => null)));
    setProfiles(Object.fromEntries(ids.map((v, i) => [v, loaded[i]])));
  }, [id]);

  useEffect(() => {
    void authSession().then(async ({ data }) => {
      const uid = data.session?.user.id ?? null;
      setMe(uid);
      if (uid) {
        const profile = await supabase().from("vendors").select("*").eq("id", uid).maybeSingle();
        setVendor(profile.data);
      }
      reload().catch((e: Error) => setError(e.message));
    });
  }, [reload]);

  // Live: messages of this task arrive as they are sent (each user only receives what they may read).
  useEffect(() => onMessages(id, (m) => setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))), [id]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const mine = Boolean(task && me === task.customer_id);
  const myBid = bids.find((b) => b.vendor_id === me);
  const hired = bids.find((b) => b.id === task?.awarded_bid_id) ?? null;
  const open = task?.status === "published";
  const live = task && task.status !== "cancelled";
  const threadOf = (vendorId: string) => messages.filter((m) => m.vendor_id === vendorId);
  const unreadOf = (vendorId: string) => threadOf(vendorId).filter((m) => m.sender_id !== me && !m.read_at).length;
  const ranked = useMemo(() => [...bids].sort((a, b) => Number(a.status === "withdrawn") - Number(b.status === "withdrawn") || a.price - b.price), [bids]);
  const lowest = ranked.find((b) => b.status === "submitted")?.id;
  // The customer's open thread: the chosen vendor once hired, else the one picked (or the first bidder).
  const customerThread = mine ? chatWith ?? hired?.vendor_id ?? null : null;
  const name = (vendorId: string) => profiles[vendorId]?.vendor.name ?? t("Vendor");
  // Vendors who asked something without bidding (yet): the customer sees and answers them too.
  const askers = [...new Set(messages.filter((m) => m.sender_id === m.vendor_id).map((m) => m.vendor_id))].filter((v) => !bids.some((b) => b.vendor_id === v));
  const canAnswer = (vendorId: string) => bids.some((b) => b.vendor_id === vendorId) || messages.some((m) => m.vendor_id === vendorId && m.sender_id === vendorId);

  return (
    <div className="min-h-full bg-slate-50">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <Link href={vendor && !mine ? "/vendor/tasks" : "/tasks"} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-navy">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t("Requests")}
        </Link>
        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!task && !error && <p className="text-sm text-slate-500">{t("Loading…")}</p>}
        {task && (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold text-brand-navy">{task.title}</h1>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${TONE[task.status]}`}>{t(STATUS[task.status])}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
                    {task.audience === "vendor_exclusive"
                      ? t("Only for {vendor}", { vendor: task.spec.vendor?.name || name(task.exclusive_vendor_id ?? "") })
                      : t("Open to all vendors")}
                  </span>
                  <span className="ms-auto flex flex-wrap items-start gap-2">
                    {/* The customer's own design (vendors edit theirs as a proposal, below). The request keeps the version it was sent with. */}
                    {mine && task.design_id && (
                      <Link href={`/designs/${task.design_id}`} title={t("Changes you save there update this request too.")} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy shadow-sm transition hover:bg-slate-50">
                        <PencilRuler className="size-4" aria-hidden /> {t("Edit customised model")}
                      </Link>
                    )}
                    <ReportButton taskId={task.id} />
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-5">
                  {[
                    ...(task.spec.design ? [["Pieces", String(task.spec.quantity ?? 1)]] : []),
                    ["Budget", task.budget_max != null ? t("up to {price}", { price: formatPrice(task.budget_max) }) : t("Open")],
                    ["Wanted by", task.deadline ? new Date(task.deadline).toLocaleDateString() : t("Flexible")],
                    ["Location", task.location || "—"],
                    ["Published", new Date(task.created_at).toLocaleDateString()],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <dt className="text-[11px] text-slate-500">{t(label)}</dt>
                      <dd className="truncate font-semibold text-brand-navy">{value}</dd>
                    </div>
                  ))}
                </dl>
                {task.description && <p className="mt-3 whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">{task.description}</p>}
              </div>

              {task.spec.design ? (
                <DesignSpecView spec={task.spec.design} quantity={task.spec.quantity ?? 1} download={mine || Boolean(hired && hired.vendor_id === me)} />
              ) : (
                <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                  {(task.spec.lines ?? []).map((line) => (
                    <li key={line.name + line.quantity} className="flex justify-between gap-3 px-4 py-2 text-sm">
                      <span>{line.name}<span className="text-slate-400"> · {line.quantity} {line.unit === "m2" ? "m²" : ""}</span></span>
                      <span className="font-semibold">{line.total == null ? "—" : formatPrice(line.total)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {mine && (
                <section className="space-y-3">
                  <h2 className="font-semibold text-brand-navy">{t("Bids ({n})", { n: bids.filter((b) => b.status !== "withdrawn").length })}</h2>
                  {bids.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">{t("No bids yet. Vendors who make this kind of furniture see your request and can ask you questions here.")}</p>}
                  {ranked.map((bid) => {
                    const p = profiles[bid.vendor_id];
                    const unread = unreadOf(bid.vendor_id);
                    return (
                      <div key={bid.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${bid.id === task.awarded_bid_id ? "border-emerald-300" : "border-slate-200"} ${bid.status === "withdrawn" ? "opacity-60" : ""}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link href={`/vendors/${bid.vendor_id}`} className="font-semibold text-brand-navy hover:underline">{name(bid.vendor_id)}</Link>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                              {p?.stats.rating != null ? <span className="inline-flex items-center gap-0.5"><Star className="size-3 fill-brand-amber text-brand-amber" aria-hidden />{p.stats.rating.toFixed(1)} ({p.stats.reviews})</span> : <span>{t("No reviews yet")}</span>}
                              <span>{t("{n} completed projects", { n: p?.stats.completed_projects ?? 0 })}</span>
                              {p?.vendor.location && <span>{p.vendor.location}</span>}
                            </p>
                          </div>
                          <div className="text-end">
                            <p className="text-lg font-semibold tabular-nums text-brand-navy">{formatPrice(bid.price)}</p>
                            <p className="text-xs text-slate-500">{t("{n} days", { n: bid.days })}</p>
                          </div>
                        </div>
                        {bid.note && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{bid.note}</p>}
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          {bid.id === lowest && bids.filter((b) => b.status === "submitted").length > 1 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{t("Lowest price")}</span>}
                          {bid.id === task.awarded_bid_id && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700"><Check className="size-3" aria-hidden />{t("Hired")}</span>}
                          {bid.status === "withdrawn" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{t("Withdrawn")}</span>}
                          {bid.status === "rejected" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{t("Not selected")}</span>}
                          <Link href={`/vendors/${bid.vendor_id}`} className="text-brand-navy underline">{t("Profile, previous work and reviews")}</Link>
                          <button type="button" onClick={() => setChatWith(bid.vendor_id)} className="ms-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-brand-navy hover:bg-slate-50">
                            <MessageSquare className="size-3.5" aria-hidden /> {t("Chat")}
                            {unread > 0 && <span className="rounded-full bg-brand-amber px-1.5 text-[10px]">{unread}</span>}
                          </button>
                          {open && bid.status === "submitted" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => window.confirm(t("Hire {name} for {price}? Other bids are closed.", { name: name(bid.vendor_id), price: formatPrice(bid.price) })) && void act(() => acceptBid(bid.id))}
                              className="rounded-lg bg-brand-amber px-3 py-1 font-semibold text-brand-navy disabled:opacity-60"
                            >
                              {t("Hire this vendor")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}

              {mine && proposals.length > 0 && (
                <section className="space-y-3">
                  <h2 className="font-semibold text-brand-navy">{t("Proposed changes ({n})", { n: proposals.length })}</h2>
                  {proposals.map((p) => (
                    <ProposalCard key={p.id} proposal={p} vendorName={name(p.vendor_id)} open={shownProposal === p.id} onToggle={() => setShownProposal((v) => (v === p.id ? null : p.id))}>
                      {open && p.status === "pending" && (
                        <>
                          <button type="button" disabled={busy} onClick={() => window.confirm(t("Accept this change? It becomes your design's latest version and what every vendor bids on.")) && void act(() => decideProposal(p.id, true))} className="rounded-lg bg-brand-amber px-3 py-1 font-semibold text-brand-navy disabled:opacity-60">
                            {t("Accept change")}
                          </button>
                          <button type="button" disabled={busy} onClick={() => void act(() => decideProposal(p.id, false))} className="rounded-lg border border-slate-200 px-3 py-1 font-semibold text-slate-600 disabled:opacity-60">
                            {t("Reject")}
                          </button>
                        </>
                      )}
                    </ProposalCard>
                  ))}
                </section>
              )}

              {mine && askers.length > 0 && (
                <section className="space-y-2">
                  <h2 className="font-semibold text-brand-navy">{t("Questions from vendors")}</h2>
                  {askers.map((v) => (
                    <div key={v} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
                      <Link href={`/vendors/${v}`} className="font-semibold text-brand-navy hover:underline">{name(v)}</Link>
                      <span className="text-xs text-slate-500">{t("No bid yet")}</span>
                      <button type="button" onClick={() => setChatWith(v)} className="ms-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-brand-navy hover:bg-slate-50">
                        <MessageSquare className="size-3.5" aria-hidden /> {t("Chat")}
                        {unreadOf(v) > 0 && <span className="rounded-full bg-brand-amber px-1.5 text-[10px]">{unreadOf(v)}</span>}
                      </button>
                    </div>
                  ))}
                </section>
              )}

              {mine && (
                <div className="flex flex-wrap gap-2">
                  {open && (
                    <button type="button" disabled={busy} onClick={() => window.confirm(t("Cancel this request? Vendors can no longer bid.")) && void act(() => advanceTask(task.id, "cancelled"))} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                      {t("Cancel request")}
                    </button>
                  )}
                  {task.status === "in_progress" && (
                    <button type="button" disabled={busy} onClick={() => window.confirm(t("Confirm the work is finished?")) && void act(() => advanceTask(task.id, "completed"))} className="rounded-lg bg-brand-amber px-3 py-2 text-sm font-semibold text-brand-navy">
                      {t("Mark as completed")}
                    </button>
                  )}
                  {task.status === "awarded" && <p className="text-sm text-slate-500">{t("Waiting for {name} to start the work.", { name: hired ? name(hired.vendor_id) : t("the vendor") })}</p>}
                </div>
              )}

              {mine && task.status === "completed" && hired && review === null && <ReviewForm onSubmit={(rating, comment) => act(() => reviewVendor(task.id, hired.vendor_id, rating, comment))} name={name(hired.vendor_id)} busy={busy} />}
              {mine && review && <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">{t("Your review: {stars} {comment}", { stars: "★".repeat(review.rating), comment: review.comment })}</p>}

              {vendor && !mine && task.spec.design && (open || proposals.length > 0) && (
                <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-brand-navy">{t("Propose changes")}</h2>
                      <p className="mt-0.5 text-sm text-slate-500">{t("Suggest a different size, parts or materials before you bid. The customer accepts or rejects your version.")}</p>
                    </div>
                    {open && (
                      <Link href={`/tasks/${task.id}/propose`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-slate-50">
                        <PencilRuler className="size-4" aria-hidden /> {proposals.some((p) => p.status === "pending") ? t("Edit my proposal") : t("Edit the model")}
                      </Link>
                    )}
                  </div>
                  {proposals.map((p) => (
                    <ProposalCard key={p.id} proposal={p} vendorName={t("Your proposal")} open={shownProposal === p.id} onToggle={() => setShownProposal((v) => (v === p.id ? null : p.id))} />
                  ))}
                </section>
              )}

              {vendor && !mine && <VendorBid task={task} bid={myBid} vendorId={vendor.id} busy={busy} act={act} />}
            </div>

            <aside className="space-y-3 lg:sticky lg:top-20">
              {mine && me && (
                customerThread ? (
                  <TaskChat
                    taskId={task.id}
                    vendorId={customerThread}
                    me={me}
                    title={hired?.vendor_id === customerThread ? t("{name} · your vendor", { name: name(customerThread) }) : name(customerThread)}
                    messages={threadOf(customerThread)}
                    canSend={Boolean(live && canAnswer(customerThread))}
                    onSent={(m) => setMessages((list) => [...list, m])}
                  />
                ) : (
                  <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">{bids.length ? t("Choose “Chat” on a bid to talk to that vendor.") : t("Conversations with vendors appear here.")}</p>
                )
              )}
              {vendor && !mine && me && (
                <TaskChat
                  taskId={task.id}
                  vendorId={vendor.id}
                  me={me}
                  title={t("Chat with the customer")}
                  messages={threadOf(vendor.id)}
                  canSend={Boolean(live && (open || myBid))}
                  onSent={(m) => setMessages((list) => [...list, m])}
                />
              )}
              {!me && <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">{t("Log in to bid or chat.")}</p>}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

const PROPOSAL_TONE: Record<Proposal["status"], string> = {
  pending: "bg-amber-50 text-amber-800",
  accepted: "bg-emerald-50 text-emerald-700",
  rejected: "bg-slate-100 text-slate-500",
};
const PROPOSAL_STATUS: Record<Proposal["status"], string> = { pending: "Waiting for the customer", accepted: "Accepted", rejected: "Rejected" };

/** One proposed change: who, why, its status, and the proposed model in full (3D, size, materials) on demand. */
function ProposalCard({ proposal, vendorName, open, onToggle, children }: { proposal: Proposal; vendorName: string; open: boolean; onToggle: () => void; children?: ReactNode }) {
  const t = useT();
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {proposal.thumbnail_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={proposal.thumbnail_url} alt="" className="size-16 shrink-0 rounded-lg border border-slate-200 bg-slate-50 object-contain" />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <Link href={`/vendors/${proposal.vendor_id}`} className="font-semibold text-brand-navy hover:underline">{vendorName}</Link>
            <span className={`rounded-full px-2 py-0.5 text-xs ${PROPOSAL_TONE[proposal.status]}`}>{t(PROPOSAL_STATUS[proposal.status])}</span>
            <span className="text-xs text-slate-400">{new Date(proposal.created_at).toLocaleDateString()}</span>
          </p>
          {proposal.note && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{proposal.note}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={onToggle} aria-expanded={open} className="rounded-lg border border-slate-200 px-3 py-1 font-semibold text-brand-navy hover:bg-slate-50">
          {open ? t("Hide the proposed model") : t("View the proposed model")}
        </button>
        {children}
      </div>
      {open && <DesignSpecView spec={proposal.spec} download />}
    </div>
  );
}

function VendorBid({ task, bid, vendorId, busy, act }: { task: TaskRow; bid?: BidRow; vendorId: string; busy: boolean; act: (work: () => Promise<unknown>) => Promise<void> }) {
  const t = useT();
  const [price, setPrice] = useState(bid ? String(bid.price) : "");
  const [days, setDays] = useState(bid ? String(bid.days) : "14");
  const [note, setNote] = useState(bid?.note ?? "");
  const open = task.status === "published";
  const hiredMe = bid && task.awarded_bid_id === bid.id;
  if (hiredMe) {
    return (
      <section className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <p className="font-semibold text-emerald-800">{t("You were hired for {price} in {n} days.", { price: formatPrice(bid.price), n: bid.days })}</p>
        {task.status === "awarded" && (
          <button type="button" disabled={busy} onClick={() => void act(() => advanceTask(task.id, "in_progress"))} className="rounded-lg bg-brand-amber px-3 py-2 font-semibold text-brand-navy">
            {t("Start work")}
          </button>
        )}
        {task.status === "in_progress" && <p className="text-emerald-800">{t("Share progress photos in the chat. The customer marks the work completed.")}</p>}
      </section>
    );
  }
  if (!open) return bid ? <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500">{t(bid.status === "rejected" ? "The customer chose another vendor." : "This request is closed.")}</p> : null;
  const withdrawn = bid?.status === "withdrawn";
  return (
    <form
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const p = Number(price);
        const d = Number(days);
        if (!(p >= 0) || !(d >= 1)) return;
        void act(() => (bid ? reviseBid(bid.id, { price: p, days: d, note: note.trim(), status: "submitted" }) : placeBid(task.id, vendorId, p, d, note.trim())));
      }}
    >
      <h2 className="font-semibold text-brand-navy">{bid ? (withdrawn ? t("Your bid (withdrawn)") : t("Your bid")) : t("Place a bid")}</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">{t("Price (EGP)")}<input required type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></label>
        <label className="block text-sm">{t("Days to deliver")}<input required type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></label>
      </div>
      <label className="block text-sm">{t("What is included (materials, delivery, installation)")}<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-amber px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60">
          {!bid ? t("Submit bid") : withdrawn ? t("Submit again") : t("Update bid")}
        </button>
        {bid && !withdrawn && (
          <button type="button" disabled={busy} onClick={() => window.confirm(t("Withdraw your bid?")) && void act(() => reviseBid(bid.id, { status: "withdrawn" }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            {t("Withdraw")}
          </button>
        )}
      </div>
    </form>
  );
}

function ReviewForm({ name, busy, onSubmit }: { name: string; busy: boolean; onSubmit: (rating: number, comment: string) => void }) {
  const t = useT();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(rating, comment.trim());
      }}
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="font-semibold text-brand-navy">{t("How was {name}?", { name })}</h2>
      <div className="flex gap-1" role="radiogroup" aria-label={t("Rating")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} onClick={() => setRating(n)} className="p-0.5">
            <Star className={`size-6 ${n <= rating ? "fill-brand-amber text-brand-amber" : "text-slate-300"}`} aria-hidden />
          </button>
        ))}
      </div>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} placeholder={t("Quality, timing, communication…")} className="w-full rounded-lg border px-2 py-1.5 text-sm" />
      <button type="submit" disabled={busy} className="rounded-lg bg-brand-amber px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60">{t("Publish review")}</button>
      <p className="text-xs text-slate-500">{t("Reviews are public on the vendor's page and cannot be edited by the vendor.")}</p>
    </form>
  );
}
