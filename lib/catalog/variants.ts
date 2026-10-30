"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { uploadPublicFile } from "@/lib/vendor/storage";

/** Catalogue item kinds with variant images. Models keep their own model_variants table. */
export type VariantKind = "model" | "paint" | "carpet" | "window";

export interface VariantRow {
  id: string;
  image_url: string;
  sort_order: number;
}

const table = (kind: VariantKind) => (kind === "model" ? "model_variants" : "item_variants");

export async function listVariants(kind: VariantKind, itemId: string): Promise<VariantRow[]> {
  const q = supabase().from(table(kind)).select("id, image_url, sort_order").order("sort_order");
  const { data, error } = kind === "model" ? await q.eq("model_id", itemId) : await q.eq("item_kind", kind).eq("item_id", itemId);
  if (error) throw error;
  return (data ?? []) as VariantRow[];
}

/** Upload images and append them as variants after the existing ones. */
export async function addVariants(kind: VariantKind, itemId: string, vendorId: string, files: File[], startAt = 0): Promise<VariantRow[]> {
  const rows = [];
  for (const [i, file] of files.entries()) {
    const url = await uploadPublicFile(vendorId, file, `${kind}s/${itemId}/variants`);
    rows.push(kind === "model" ? { model_id: itemId, image_url: url, sort_order: startAt + i } : { item_kind: kind, item_id: itemId, image_url: url, sort_order: startAt + i });
  }
  if (!rows.length) return [];
  const { data, error } = await supabase().from(table(kind)).insert(rows).select("id, image_url, sort_order");
  if (error) throw error;
  return (data ?? []) as VariantRow[];
}

export async function removeVariants(kind: VariantKind, ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase().from(table(kind)).delete().in("id", ids);
  if (error) throw error;
}

/** Variant image URLs of a paint / carpet / window, for viewers (public read). */
export function useVariantUrls(kind: Exclude<VariantKind, "model">, itemId: string | null | undefined) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    if (!itemId || !supabaseConfigured()) return;
    let live = true;
    listVariants(kind, itemId)
      .then((rows) => live && setUrls(rows.map((r) => r.image_url)))
      .catch(() => live && setUrls([]));
    return () => {
      live = false;
    };
  }, [kind, itemId]);
  return itemId ? urls : [];
}
