"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { ClipboardPaste, ImagePlus, LoaderCircle, Trash2, X } from "lucide-react";
import { addVariants, listVariants, removeVariants, type VariantKind, type VariantRow } from "@/lib/catalog/variants";

// One shared empty queue: a fresh `[]` default per render would re-run the preview effect every render.
const NO_FILES: File[] = [];

/**
 * Variant images for a catalogue item (models, paints, carpets, windows).
 * - Existing item (`itemId`): shows its variants; add (upload / paste) and remove one or all, saved at once.
 * - New item (no `itemId`): collects files in `pending` / `onPending`; the form uploads them after it saves
 *   the item (see addVariants).
 */
export function VariantsEditor({
  kind,
  itemId,
  vendorId,
  pending = NO_FILES,
  onPending,
}: {
  kind: VariantKind;
  itemId?: string | null;
  vendorId?: string | null;
  pending?: File[];
  onPending?: (files: File[]) => void;
}) {
  const t = useT();
  const live = Boolean(itemId && vendorId);
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    if (!itemId) return;
    let alive = true;
    listVariants(kind, itemId)
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [kind, itemId]);

  useEffect(() => {
    const urls = pending.map((f) => URL.createObjectURL(f));
    // Object URLs for the queued files; revoked when the queue changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [pending]);

  const add = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    setError(null);
    if (!live) {
      onPending?.([...pending, ...images]);
      return;
    }
    setBusy(true);
    try {
      const added = await addVariants(kind, itemId!, vendorId!, images, rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 0);
      setRows((r) => [...r, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ids: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await removeVariants(kind, ids);
      setRows((r) => r.filter((x) => !ids.includes(x.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    try {
      const files: File[] = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) files.push(new File([await item.getType(type)], `variant-${Date.now()}.${type.split("/")[1] ?? "png"}`, { type }));
      }
      if (files.length) await add(files);
      else setError(t("No image on the clipboard. Copy an image first."));
    } catch {
      setError(t("Browser blocked clipboard access. Use Add images instead."));
    }
  };

  const items: { key: string; src: string; onRemove: () => void }[] = live
    ? rows.map((r) => ({ key: r.id, src: r.image_url, onRemove: () => void remove([r.id]) }))
    : pending.map((f, i) => ({ key: `${f.name}-${i}`, src: previews[i] ?? "", onRemove: () => onPending?.(pending.filter((_, j) => j !== i)) }));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {t("Variant images")} <span className="font-normal text-slate-400">({items.length})</span>
        </span>
        {items.length > 1 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t("Remove all {n} variant images?", { n: items.length }))) return;
              if (live) void remove(rows.map((r) => r.id));
              else onPending?.([]);
            }}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600"
          >
            <Trash2 className="size-3.5" aria-hidden /> {t("Remove all")}
          </button>
        )}
      </div>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {items.map((it) => (
          <li key={it.key} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200">
            {it.src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.src} alt="" className="size-full object-cover" />
            )}
            <button
              type="button"
              aria-label={t("Remove this variant")}
              disabled={busy}
              onClick={it.onRemove}
              className="absolute end-1 top-1 flex size-6 items-center justify-center rounded-full bg-white/95 text-slate-600 shadow transition-opacity hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
        <li>
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 text-[11px] text-slate-500 transition-colors hover:border-slate-300 hover:bg-white hover:text-brand-navy">
            {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
            Add images
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                void add(e.target.files ? [...e.target.files] : []);
                e.target.value = "";
              }}
            />
          </label>
        </li>
      </ul>
      <button type="button" onClick={() => void paste()} disabled={busy} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand-navy">
        <ClipboardPaste className="size-3.5" aria-hidden /> {t("Paste a variant from clipboard")}
      </button>
      {!live && items.length > 0 && <p className="text-[11px] text-slate-400">{t("Uploaded when you save.")}</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
