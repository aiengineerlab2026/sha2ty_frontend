"use client";

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { LoaderCircle, MessageSquare, Trash2 } from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { deleteReview, listReviews, saveReview, summarize, type Review, type ReviewKind } from "@/lib/catalog/reviews";
import { Stars, StarInput } from "./Stars";

/** Hook: an item's reviews plus the signed-in user (id + display name), refreshed after a change. */
function useReviews(kind: ReviewKind, itemId: string) {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const reload = useCallback(() => {
    listReviews(kind, itemId)
      .then(setReviews)
      .catch(() => setReviews([]));
  }, [kind, itemId]);
  useEffect(() => {
    if (!supabaseConfigured()) return;
    reload();
    void supabase()
      .auth.getSession()
      .then(async ({ data }) => {
        const user = data.session?.user;
        if (!user) return;
        const { data: vendor } = await supabase().from("vendors").select("name").eq("id", user.id).maybeSingle();
        setMe({ id: user.id, name: vendor?.name ?? (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "") ?? "" });
      });
  }, [reload]);
  return { reviews, me, reload };
}

/** Compact rating (details panels): stars, average and count, linking to the full reviews. */
export function RatingSummary({ kind, itemId, href }: { kind: ReviewKind; itemId: string; href: string }) {
  const t = useT();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  useEffect(() => {
    if (!supabaseConfigured()) return;
    listReviews(kind, itemId)
      .then(setReviews)
      .catch(() => setReviews([]));
  }, [kind, itemId]);
  if (!reviews) return null;
  const { count, average } = summarize(reviews);
  return (
    <Link href={href} target="_blank" className="group inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-navy">
      <Stars value={average} size="size-3.5" />
      {count ? (
        <span className="tabular-nums">
          <b className="font-semibold text-brand-navy">{average.toFixed(1)}</b> · {count} review{count === 1 ? "" : "s"}
        </span>
      ) : (
        <span>{t("No reviews yet")}</span>
      )}
      <span className="underline-offset-2 group-hover:underline">· {count ? t("Read") : t("Write one")}</span>
    </Link>
  );
}

/** Full reviews section (catalogue item pages): summary with a 5-star breakdown, your review form, the list. */
export function Reviews({ kind, itemId }: { kind: ReviewKind; itemId: string }) {
  const t = useT();
  const { reviews, me, reload } = useReviews(kind, itemId);
  const mine = reviews?.find((r) => r.user_id === me?.id) ?? null;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const startEdit = () => {
    setRating(mine?.rating ?? 0);
    setComment(mine?.comment ?? "");
    setName(mine?.author_name || me?.name || "");
    setEditing(true);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!rating) {
      setError(t("Choose a star rating."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveReview(kind, itemId, rating, comment, name || me?.name || "");
      setEditing(false);
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!mine || !window.confirm(t("Delete your review?"))) return;
    await deleteReview(mine.id).catch(() => undefined);
    setEditing(false);
    reload();
  };

  const { count, average, byStar } = summarize(reviews ?? []);
  const showForm = me && (editing || !mine);

  return (
    <section aria-labelledby="reviews-title" className="mt-12 border-t border-slate-200 pt-8">
      <h2 id="reviews-title" className="flex items-center gap-2 text-xl font-semibold tracking-tight text-brand-navy">
        <MessageSquare className="size-5 text-brand-amber" aria-hidden /> {t("Reviews")}
      </h2>

      <div className="mt-5 grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-4xl font-semibold tabular-nums text-brand-navy">{count ? average.toFixed(1) : "–"}</p>
            <Stars value={average} className="mt-1" />
            <p className="mt-1 text-sm text-slate-500">
              {count} review{count === 1 ? "" : "s"}
            </p>
            <ul className="mt-4 space-y-1.5">
              {byStar.map(({ star, count: n }) => (
                <li key={star} className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="w-3 tabular-nums">{star}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-brand-amber" style={{ width: `${count ? (n / count) * 100 : 0}%` }} />
                  </span>
                  <span className="w-6 text-end tabular-nums text-slate-400">{n}</span>
                </li>
              ))}
            </ul>
          </div>
          {!me && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
              <Link href={`/vendor/login?next=${encodeURIComponent(typeof window === "undefined" ? "/" : window.location.pathname)}`} className="font-semibold text-brand-navy hover:underline">
                {t("Log in")}
              </Link>{" "}
              to rate this and leave a comment.
            </p>
          )}
        </div>

        <div className="space-y-4">
          {showForm && (
            <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-brand-navy">{mine ? t("Edit your review") : t("Write a review")}</p>
              <StarInput value={rating} onChange={setRating} />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={me?.name || t("Your name")}
                maxLength={80}
                aria-label={t("Your name")}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 text-sm outline-none focus:border-brand-amber focus:bg-white focus:ring-4 focus:ring-brand-amber/15"
              />
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("What did you like? How did it look in your home?")}
                maxLength={2000}
                rows={4}
                aria-label={t("Comment")}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm outline-none focus:border-brand-amber focus:bg-white focus:ring-4 focus:ring-brand-amber/15"
              />
              {error && <p className="text-sm text-red-700">{error}</p>}
              <div className="flex items-center gap-2">
                <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-60">
                  {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                  {mine ? t("Update review") : t("Post review")}
                </button>
                {editing && (
                  <button type="button" onClick={() => setEditing(false)} className="h-10 rounded-xl px-3 text-sm text-slate-500 hover:text-brand-navy">
                    {t("Cancel")}
                  </button>
                )}
              </div>
            </form>
          )}

          {reviews === null ? (
            <p className="text-sm text-slate-500">{t("Loading reviews…")}</p>
          ) : reviews.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">{t("No reviews yet. Be the first to share how it looks.")}</p>
          ) : (
            <ul className="space-y-3">
              {reviews.map((r) => (
                <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-full bg-brand-navy text-xs font-semibold text-white">{(r.author_name || "?").slice(0, 1).toUpperCase()}</span>
                      <div>
                        <p className="text-sm font-semibold text-brand-navy">{r.author_name || t("Anonymous")}</p>
                        <p className="text-[11px] text-slate-400">{new Date(r.updated_at || r.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
                      </div>
                    </div>
                    <Stars value={r.rating} size="size-3.5" />
                  </div>
                  {r.comment && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">{r.comment}</p>}
                  {r.user_id === me?.id && !editing && (
                    <div className="mt-3 flex gap-3 text-xs">
                      <button type="button" onClick={startEdit} className="font-medium text-brand-navy hover:underline">
                        {t("Edit")}
                      </button>
                      <button type="button" onClick={() => void remove()} className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600">
                        <Trash2 className="size-3" aria-hidden /> {t("Delete")}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
