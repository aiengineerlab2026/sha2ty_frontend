"use client";

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarClock, CalendarDays, Check, Clock, Gavel, History, MapPin, MessageSquare, MessagesSquare, Package, PencilRuler, Star, StickyNote, Users, Wallet } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { authSession } from "@/lib/auth/client";
import { formatPrice } from "@/lib/plan/pricing";
import { supabase } from "@/lib/supabase/client";
import {
  acceptBid, advanceTask, cancelTask, decideProposal, listProposals, loadTask, myReview, onMessages, placeBid, reviewVendor, reviseBid, taskMessages, vendorProfile,
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

  const router = useRouter();
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

  // The customer's chat tabs: everyone who bid or asked something (the hired vendor first).
  const contacts = mine ? [...new Set([...(hired ? [hired.vendor_id] : []), ...ranked.map((b) => b.vendor_id), ...askers])] : [];
  const metrics: { icon: typeof Wallet; label: string; value: string; accent?: boolean }[] = task
    ? [
        { icon: Wallet, label: "Budget", value: task.budget_max != null ? t("up to {price}", { price: formatPrice(task.budget_max) }) : t("Open"), accent: true },
        { icon: CalendarClock, label: "Wanted by", value: task.deadline ? new Date(task.deadline).toLocaleDateString() : t("Flexible") },
        { icon: MapPin, label: "Location", value: task.location || "—" },
        { icon: CalendarDays, label: "Published", value: new Date(task.created_at).toLocaleDateString() },
        ...(task.spec.design ? [{ icon: Package, label: "Quantity", value: t("{n} pieces", { n: task.spec.quantity ?? 1 }) }] : []),
      ]
    : [];
  const card = "rounded-2xl border border-slate-200/80 bg-white shadow-sm";

  return (
    <div className="min-h-full bg-[#F8FAFC]">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <Link href={vendor && !mine ? "/vendor/tasks" : "/tasks"} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-brand-navy">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t("Back to requests")}
        </Link>
        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!task && !error && (
          <div className="space-y-4" aria-busy="true">
            <div className={`${card} h-40 animate-pulse`} />
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]"><div className={`${card} h-96 animate-pulse`} /><div className={`${card} h-96 animate-pulse`} /></div>
          </div>
        )}
        {task && (
          <>
            {/* Hero: what is requested, its state, the actions, and the key facts in one strip. */}
            <section className={`${card} overflow-hidden`}>
              <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 space-y-2">
                  <h1 className="text-2xl font-bold tracking-tight text-brand-navy sm:text-3xl">{task.title}</h1>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${TONE[task.status]}`}>
                      <span className="size-1.5 rounded-full bg-current" aria-hidden /> {t(STATUS[task.status])}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                      <Users className="size-3.5" aria-hidden />
                      {task.audience === "vendor_exclusive" ? t("Only for {vendor}", { vendor: task.spec.vendor?.name || name(task.exclusive_vendor_id ?? "") }) : t("Open to all vendors")}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                  {/* The customer's own design (vendors edit theirs as a proposal, in the sidebar). Saving it updates this request. */}
                  {mine && task.design_id && (
                    <Link href={`/designs/${task.design_id}`} title={t("Changes you save there update this request too.")} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-amber px-4 text-sm font-semibold text-brand-navy shadow-sm shadow-brand-amber/30 transition hover:bg-[#e8952a]">
                      <PencilRuler className="size-4" aria-hidden /> {t("Edit customised model")}
                    </Link>
                  )}
                  <ReportButton taskId={task.id} />
                </div>
              </div>
              <dl className="grid grid-cols-2 border-t border-slate-100 bg-slate-50/60 sm:grid-cols-3 lg:grid-cols-5">
                {metrics.map(({ icon: Icon, label, value, accent }) => (
                  <div key={label} className="flex items-center gap-3 border-slate-100 px-5 py-4 [&:not(:last-child)]:border-e">
                    <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${accent ? "bg-brand-amber/15 text-[#b8731d]" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t(label)}</dt>
                      <dd className={`truncate text-sm font-semibold ${accent ? "text-[#b8731d]" : "text-brand-navy"}`}>{value}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            </section>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0 space-y-6">
                {task.description && (
                  <section className={`${card} p-5`}>
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-navy"><StickyNote className="size-4 text-slate-400" aria-hidden /> {t("Customer notes")}</h2>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{task.description}</p>
                  </section>
                )}

                {task.spec.design ? (
                  <DesignSpecView spec={task.spec.design} quantity={task.spec.quantity ?? 1} download={mine || Boolean(hired && hired.vendor_id === me)} />
                ) : (
                  <ul className={`${card} divide-y divide-slate-100`}>
                    {(task.spec.lines ?? []).map((line) => (
                      <li key={line.name + line.quantity} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                        <span>{line.name}<span className="text-slate-400"> · {line.quantity} {line.unit === "m2" ? "m²" : ""}</span></span>
                        <span className="font-semibold">{line.total == null ? "—" : formatPrice(line.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {mine && task.status === "completed" && hired && review === null && <ReviewForm onSubmit={(rating, comment) => act(() => reviewVendor(task.id, hired.vendor_id, rating, comment))} name={name(hired.vendor_id)} busy={busy} />}
                {mine && review && <p className={`${card} p-4 text-sm text-slate-600`}>{t("Your review: {stars} {comment}", { stars: "★".repeat(review.rating), comment: review.comment })}</p>}
              </div>

              <aside className="min-w-0 space-y-6">
                {/* Conversations: a tab per vendor (bidders and vendors who asked), the thread below. */}
                {mine && me && (
                  <section className={`${card} overflow-hidden`}>
                    <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                      <MessageSquare className="size-4 text-slate-400" aria-hidden />
                      <h2 className="text-sm font-semibold text-brand-navy">{t("Messages")}</h2>
                    </div>
                    {contacts.length > 0 && (
                      <div className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:thin]" role="tablist" aria-label={t("Vendors")}>
                        {contacts.map((v) => {
                          const on = customerThread === v;
                          const unread = unreadOf(v);
                          return (
                            <button key={v} type="button" role="tab" aria-selected={on} onClick={() => setChatWith(v)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${on ? "bg-brand-navy text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                              <Avatar name={name(v)} small />
                              <span className="max-w-[8rem] truncate">{name(v)}</span>
                              {unread > 0 && <span className="rounded-full bg-brand-amber px-1.5 text-[10px] text-brand-navy">{unread}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {customerThread ? (
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
                      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                        <span className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><MessagesSquare className="size-6" aria-hidden /></span>
                        <p className="text-sm font-semibold text-brand-navy">{contacts.length ? t("Choose a vendor to chat with") : t("No conversations yet")}</p>
                        <p className="text-xs text-slate-500">{contacts.length ? t("Pick a vendor above to see your messages.") : t("Vendors who bid or ask a question appear here.")}</p>
                      </div>
                    )}
                  </section>
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
                {!me && <p className={`${card} p-4 text-sm text-slate-500`}>{t("Log in to bid or chat.")}</p>}

                {mine && (
                  <section className="space-y-3">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-navy">
                      <Gavel className="size-4 text-slate-400" aria-hidden /> {t("Bids ({n})", { n: bids.filter((b) => b.status !== "withdrawn").length })}
                    </h2>
                    {bids.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">{t("No bids yet. Vendors who make this kind of furniture see your request and can ask you questions here.")}</p>}
                    {ranked.map((bid) => {
                      const p = profiles[bid.vendor_id];
                      const unread = unreadOf(bid.vendor_id);
                      return (
                        <article key={bid.id} className={`${card} p-4 transition hover:shadow-md ${bid.id === task.awarded_bid_id ? "ring-2 ring-emerald-300" : ""} ${bid.status === "withdrawn" ? "opacity-60" : ""}`}>
                          <div className="flex items-start gap-3">
                            <Avatar name={name(bid.vendor_id)} />
                            <div className="min-w-0 flex-1">
                              <Link href={`/vendors/${bid.vendor_id}`} className="block truncate font-semibold text-brand-navy hover:underline">{name(bid.vendor_id)}</Link>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                                {p?.stats.rating != null ? <span className="inline-flex items-center gap-0.5"><Star className="size-3 fill-brand-amber text-brand-amber" aria-hidden />{p.stats.rating.toFixed(1)} ({p.stats.reviews})</span> : <span>{t("No reviews yet")}</span>}
                                <span>{t("{n} completed projects", { n: p?.stats.completed_projects ?? 0 })}</span>
                              </p>
                            </div>
                            <div className="text-end">
                              <p className="text-lg font-bold tabular-nums text-brand-navy">{formatPrice(bid.price)}</p>
                              <p className="inline-flex items-center gap-1 text-xs text-slate-500"><Clock className="size-3" aria-hidden />{t("{n} days", { n: bid.days })}</p>
                            </div>
                          </div>
                          {bid.note && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{bid.note}</p>}
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                            {bid.id === lowest && bids.filter((b) => b.status === "submitted").length > 1 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">{t("Lowest price")}</span>}
                            {bid.id === task.awarded_bid_id && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"><Check className="size-3" aria-hidden />{t("Hired")}</span>}
                            {bid.status === "withdrawn" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{t("Withdrawn")}</span>}
                            {bid.status === "rejected" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">{t("Not selected")}</span>}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {open && bid.status === "submitted" && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => window.confirm(t("Hire {name} for {price}? Other bids are closed.", { name: name(bid.vendor_id), price: formatPrice(bid.price) })) && void act(() => acceptBid(bid.id))}
                                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-amber px-3 text-xs font-semibold text-brand-navy transition hover:bg-[#e8952a] disabled:opacity-60"
                              >
                                <Check className="size-3.5" aria-hidden /> {t("Accept bid")}
                              </button>
                            )}
                            <Link href={`/vendors/${bid.vendor_id}`} className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-brand-navy transition hover:bg-slate-50">{t("View profile")}</Link>
                            <button type="button" onClick={() => setChatWith(bid.vendor_id)} className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-brand-navy transition hover:bg-slate-50">
                              <MessageSquare className="size-3.5" aria-hidden /> {t("Chat")}
                              {unread > 0 && <span className="rounded-full bg-brand-amber px-1.5 text-[10px]">{unread}</span>}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    <div className="flex flex-wrap gap-2">
                      {open && (
                        <button type="button" disabled={busy} onClick={() => window.confirm(t("Cancel this request? It is deleted, with its offers and messages.")) && void act(async () => { await cancelTask(task.id); router.replace("/tasks"); })} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-red-200 hover:text-red-600">
                          {t("Cancel request")}
                        </button>
                      )}
                      {task.status === "in_progress" && (
                        <button type="button" disabled={busy} onClick={() => window.confirm(t("Confirm the work is finished?")) && void act(() => advanceTask(task.id, "completed"))} className="rounded-xl bg-brand-amber px-3 py-2 text-sm font-semibold text-brand-navy">
                          {t("Mark as completed")}
                        </button>
                      )}
                      {task.status === "awarded" && <p className="text-xs text-slate-500">{t("Waiting for {name} to start the work.", { name: hired ? name(hired.vendor_id) : t("the vendor") })}</p>}
                    </div>
                  </section>
                )}

                {mine && proposals.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-navy"><History className="size-4 text-slate-400" aria-hidden /> {t("Proposed changes ({n})", { n: proposals.length })}</h2>
                    {/* A timeline, newest first: who proposed what, its state, and the model on demand. */}
                    <ol className="relative space-y-4 border-s border-slate-200 ps-5">
                      {proposals.map((p) => (
                        <li key={p.id} className="relative">
                          <span className={`absolute -start-[1.65rem] top-4 size-3 rounded-full ring-4 ring-[#F8FAFC] ${p.status === "accepted" ? "bg-emerald-500" : p.status === "rejected" ? "bg-slate-300" : "bg-brand-amber"}`} aria-hidden />
                          <ProposalCard proposal={p} vendorName={name(p.vendor_id)} open={shownProposal === p.id} onToggle={() => setShownProposal((v) => (v === p.id ? null : p.id))}>
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
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {vendor && !mine && <VendorBid task={task} bid={myBid} vendorId={vendor.id} busy={busy} act={act} />}

                {vendor && !mine && task.spec.design && (open || proposals.length > 0) && (
                  <section className={`${card} space-y-3 p-4`}>
                    <div>
                      <h2 className="font-semibold text-brand-navy">{t("Propose changes")}</h2>
                      <p className="mt-0.5 text-sm text-slate-500">{t("Suggest a different size, parts or materials before you bid. The customer accepts or rejects your version.")}</p>
                    </div>
                    {open && (
                      <Link href={`/tasks/${task.id}/propose`} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-brand-navy transition hover:bg-slate-50">
                        <PencilRuler className="size-4" aria-hidden /> {proposals.some((p) => p.status === "pending") ? t("Edit my proposal") : t("Edit the model")}
                      </Link>
                    )}
                    {proposals.map((p) => (
                      <ProposalCard key={p.id} proposal={p} vendorName={t("Your proposal")} open={shownProposal === p.id} onToggle={() => setShownProposal((v) => (v === p.id ? null : p.id))} />
                    ))}
                  </section>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** A vendor's initials on a tinted tile (no photo needed). */
function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-brand-navy/10 font-semibold text-brand-navy ${small ? "size-5 text-[9px]" : "size-10 text-sm"}`} aria-hidden>
      {letters}
    </span>
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
