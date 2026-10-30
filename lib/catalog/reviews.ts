"use client";

import { authSession } from "@/lib/auth/client";
import { supabase } from "@/lib/supabase/client";
import type { VariantKind } from "./variants";

export type ReviewKind = VariantKind;

export interface Review {
  id: string;
  user_id: string;
  author_name: string;
  rating: number;
  comment: string;
  created_at: string;
  updated_at: string;
}

export async function listReviews(kind: ReviewKind, itemId: string): Promise<Review[]> {
  const { data, error } = await supabase()
    .from("reviews")
    .select("id, user_id, author_name, rating, comment, created_at, updated_at")
    .eq("item_kind", kind)
    .eq("item_id", itemId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Review[];
}

/** One review per user per item: a second submit updates it. */
export async function saveReview(kind: ReviewKind, itemId: string, rating: number, comment: string, authorName: string) {
  const { data: session } = await authSession();
  const user = session.session?.user;
  if (!user) throw new Error("Log in to leave a review.");
  const { error } = await supabase()
    .from("reviews")
    .upsert(
      { item_kind: kind, item_id: itemId, user_id: user.id, rating, comment: comment.trim(), author_name: authorName.trim().slice(0, 80), updated_at: new Date().toISOString() },
      { onConflict: "item_kind,item_id,user_id" },
    );
  if (error) throw error;
}

export async function deleteReview(id: string) {
  const { error } = await supabase().from("reviews").delete().eq("id", id);
  if (error) throw error;
}

export function summarize(reviews: Pick<Review, "rating">[]) {
  const count = reviews.length;
  const average = count ? reviews.reduce((s, r) => s + r.rating, 0) / count : 0;
  const byStar = [5, 4, 3, 2, 1].map((star) => ({ star, count: reviews.filter((r) => r.rating === star).length }));
  return { count, average, byStar };
}
