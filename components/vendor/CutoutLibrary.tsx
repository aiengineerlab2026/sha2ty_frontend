"use client";

import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { uploadPublicFile } from "@/lib/vendor/storage";
import { extractCarpet } from "@/lib/plan/api";
import { ImagePicker } from "./ImagePicker";
import { VariantsEditor } from "./VariantsEditor";
import { addVariants } from "@/lib/catalog/variants";
import { PriceField, priceOrNull } from "./PriceField";
import { formatPrice } from "@/lib/plan/pricing";
import { Pencil, Trash2, X } from "lucide-react";
import type { PriceUnit, VendorProfile } from "@/lib/vendor/types";

/** A catalogue item that is an image at a real size: carpets (width × length), windows (width × height). */
type Cutout = { id: string; name: string; width_m: number; image_url: string; price: number | null; price_unit: PriceUnit } & Record<string, unknown>;

export interface CutoutKind {
  table: "carpets" | "windows" | "doors";
  /** Second dimension column and its label: carpets have a length, windows a height. */
  second: "length_m" | "height_m";
  secondLabel: string;
  noun: string;
  title: string;
  subtitle: string;
  photoLabel: string;
  namePlaceholder: string;
  defaults: [string, string];
}

export const CARPET_KIND: CutoutKind = {
  table: "carpets",
  second: "length_m",
  secondLabel: "Length",
  noun: "carpet",
  title: "Carpets",
  subtitle: "Upload a top-down photo and its real size. Shoppers lay it on the floor in the plan editor.",
  photoLabel: "Carpet photo",
  namePlaceholder: "e.g. Persian red",
  defaults: ["2", "3"],
};

export const WINDOW_KIND: CutoutKind = {
  table: "windows",
  second: "height_m",
  secondLabel: "Height",
  noun: "window",
  title: "Windows",
  subtitle: "Upload a front-on photo and the window's real size. Only the window is kept (transparent background); shoppers place it on a wall in the plan editor.",
  photoLabel: "Window photo",
  namePlaceholder: "e.g. Aluminium double casement",
  defaults: ["1.2", "1.4"],
};

export const DOOR_KIND: CutoutKind = {
  table: "doors",
  second: "height_m",
  secondLabel: "Height",
  noun: "door",
  title: "Doors",
  subtitle: "Upload a front-on photo of the door and its real width and height in metres. Only the door is kept; shoppers fit it into a doorway in the plan editor, which checks that the size fits.",
  photoLabel: "Door photo",
  namePlaceholder: "e.g. Oak panel door",
  defaults: ["0.9", "2.1"],
};

/** Vendor's image items: the photo is cut out (background removed, straightened to the real size) and saved. */
export function CutoutLibrary({ kind }: { kind: CutoutKind }) {
  const t = useT();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [carpets, setCarpets] = useState<Cutout[]>([]);
  const [editing, setEditing] = useState<Cutout | null>(null);
  // Variant images for a new item, uploaded once it is saved (an existing item edits its variants live).
  const [pendingVariants, setPendingVariants] = useState<File[]>([]);
  const variantKind = kind.table === "carpets" ? "carpet" : kind.table === "doors" ? "door" : "window";
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [width, setWidth] = useState(kind.defaults[0]);
  const [length, setLength] = useState(kind.defaults[1]);
  const [price, setPrice] = useState("");
  const [priceUnit, setPriceUnit] = useState<PriceUnit>("item");
  const [file, setFile] = useState<File | null>(null);
  // Only the item is saved: the photo is cut out and straightened on the backend, previewed here.
  const [extracted, setExtracted] = useState<{ blob: Blob; url: string; key: string } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const extractKey = file ? `${file.name}:${file.size}:${file.lastModified}:${width}:${length}` : null;

  useEffect(() => {
    const w = Number(width);
    const l = Number(length);
    if (!file || !(w > 0) || !(l > 0)) return;
    let live = true;
    const timer = setTimeout(() => {
      setExtracting(true);
      setExtractError(null);
      extractCarpet(file, w, l)
        .then((blob) => live && setExtracted({ blob, url: URL.createObjectURL(blob), key: `${file.name}:${file.size}:${file.lastModified}:${width}:${length}` }))
        .catch((caught) => live && setExtractError(caught instanceof Error ? caught.message : String(caught)))
        .finally(() => live && setExtracting(false));
    }, 400); // dimensions are typed: wait for a pause
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [file, width, length]);

  useEffect(() => () => (extracted ? URL.revokeObjectURL(extracted.url) : undefined), [extracted]);
  const ready = extracted && extracted.key === extractKey ? extracted : null;

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void authSession()
      .then(async ({ data }) => {
        if (!data.session) {
          window.location.href = "/vendor/login";
          return;
        }
        const id = data.session.user.id;
        const [profile, list] = await Promise.all([
          supabase().from("vendors").select("*").eq("id", id).maybeSingle(),
          supabase().from(kind.table).select("*").eq("vendor_id", id).order("created_at", { ascending: false }),
        ]);
        setVendor(profile.data);
        if (list.error) setError(list.error.message);
        else setCarpets((list.data ?? []) as Cutout[]);
      });
  }, [kind.table]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!vendor) return;
    const w = Number(width);
    const l = Number(length);
    // Editing keeps the saved image unless a new photo is chosen (which is extracted again).
    if ((!file && !editing) || !(w > 0) || !(l > 0)) {
      setError(t("Add an image and a width and {second} above 0 m.", { second: t(kind.secondLabel) }));
      return;
    }
    if (file && !ready) {
      setError(extracting ? t("Still extracting the {noun} from the photo…", { noun: t(kind.noun) }) : t("The {noun} could not be extracted from this photo. Try another photo.", { noun: t(kind.noun) }));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const image_url =
        file && ready
          ? await uploadPublicFile(vendor.id, new File([ready.blob], `${file.name.replace(/\.[^.]+$/, "") || kind.noun}.png`, { type: "image/png" }), kind.table)
          : editing!.image_url;
      const row = { name: name.trim() || file?.name || editing?.name || kind.noun, width_m: w, [kind.second]: l, image_url, price: priceOrNull(price), price_unit: priceUnit };
      const query = editing
        ? supabase().from(kind.table).update(row).eq("id", editing.id).select().single()
        : supabase().from(kind.table).insert({ ...row, vendor_id: vendor.id }).select().single();
      const { data, error: next } = await query;
      if (next) throw next;
      const saved = data as Cutout;
      if (!editing && pendingVariants.length) await addVariants(variantKind, saved.id, vendor.id, pendingVariants);
      setCarpets((list) => (editing ? list.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...list]));
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setEditing(null);
    setPendingVariants([]);
    setName("");
    setFile(null);
    setExtracted(null);
    setPrice("");
    setWidth(kind.defaults[0]);
    setLength(kind.defaults[1]);
  };

  const startEdit = (item: Cutout) => {
    setEditing(item);
    setName(item.name);
    setWidth(String(Number(item.width_m)));
    setLength(String(Number(item[kind.second])));
    setPrice(item.price == null ? "" : String(item.price));
    setPriceUnit(item.price_unit ?? "item");
    setFile(null);
    setExtracted(null);
    setError(null);
    form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const remove = async (id: string) => {
    if (!window.confirm(t("Remove this {noun}? Plans that already use it keep their copy.", { noun: t(kind.noun) }))) return;
    const { error: next } = await supabase().from(kind.table).delete().eq("id", id);
    if (next) setError(next.message);
    else {
      setCarpets((list) => list.filter((c) => c.id !== id));
      if (editing?.id === id) resetForm();
    }
  };

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">{t(kind.title)}</h1>
        <p className="mt-1 text-sm text-slate-500">{t(kind.subtitle)}</p>

        <form ref={form} onSubmit={add} className="mt-6 grid scroll-mt-20 gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-[1fr_auto]">
          {editing && (
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-brand-navy">
                <Pencil className="size-4 text-brand-amber" aria-hidden /> Editing “{editing.name}”
                <span className="font-normal text-slate-500">{t("· keep the image, or choose a new photo to replace it")}</span>
              </p>
              <button type="button" onClick={resetForm} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-navy">
                <X className="size-4" aria-hidden /> {t("Cancel edit")}
              </button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[1fr_6rem_6rem_auto_minmax(12rem,1fr)]">
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">{t("Name")}</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t(kind.namePlaceholder)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">{t("Width m")}</span>
              <Input type="number" min="0.1" step="0.05" value={width} onChange={(e) => setWidth(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-slate-600">{t(kind.secondLabel)} m</span>
              <Input type="number" min="0.1" step="0.05" value={length} onChange={(e) => setLength(e.target.value)} />
            </label>
            <ImagePicker
              label={t(kind.photoLabel)}
              value={file}
              onChange={(next) => {
                setFile(next);
                setExtractError(null);
              }}
            />
            <PriceField price={price} unit={priceUnit} onPrice={setPrice} onUnit={setPriceUnit} />
          </div>
          {file && (
            <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
              <div
                className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[length:16px_16px] ring-1 ring-slate-200 [background-image:repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)]"
                title={t("Transparent areas are not part of the {noun}", { noun: t(kind.noun) })}
              >
                {ready ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ready.url} alt={t("Extracted {noun}", { noun: t(kind.noun) })} className="max-h-full max-w-full object-contain" />
                ) : extracting ? (
                  <LoaderCircle className="size-5 animate-spin text-slate-400" aria-hidden />
                ) : null}
              </div>
              <div className="space-y-1 text-xs">
                <p className="flex items-center gap-1.5 font-semibold text-brand-navy">
                  <Sparkles className="size-3.5 text-brand-amber" aria-hidden /> {t(kind.noun === "carpet" ? "Carpet only" : kind.noun === "door" ? "Door only" : "Window only")}
                </p>
                <p className="text-slate-500">
                  {extracting
                    ? t("Cutting the {noun} out of the photo and straightening it…", { noun: t(kind.noun) })
                    : extractError
                      ? null
                      : ready
                        ? t("Background removed and straightened to {w} × {l} m. This is what will be saved.", { w: Number(width).toFixed(2), l: Number(length).toFixed(2) })
                        : t("Enter the width and {second} to extract the {noun}.", { second: t(kind.secondLabel), noun: t(kind.noun) })}
                </p>
                {extractError && <p className="text-red-700">{extractError}</p>}
              </div>
            </div>
          )}
          <div className="sm:col-span-2">
            <VariantsEditor kind={variantKind} itemId={editing?.id} vendorId={vendor?.id} pending={pendingVariants} onPending={setPendingVariants} />
          </div>
          <Button type="submit" disabled={saving || !vendor || (Boolean(file) && !ready)} className="self-end">
            {saving ? t("Saving…") : editing ? t("Save changes") : t(kind.noun === "carpet" ? "Add carpet" : kind.noun === "door" ? "Add door" : "Add window")}
          </Button>
        </form>

        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {carpets.map((carpet) => (
            <li
              key={carpet.id}
              className={`overflow-hidden rounded-xl border bg-white shadow-sm ${editing?.id === carpet.id ? "border-brand-amber ring-2 ring-brand-amber/25" : "border-slate-200"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={carpet.image_url}
                alt=""
                className="aspect-square w-full bg-[length:16px_16px] object-contain [background-image:repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)]"
              />
              <div className="flex items-center justify-between gap-1 p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-brand-navy">{carpet.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {Number(carpet.width_m).toFixed(2)} × {Number(carpet[kind.second]).toFixed(2)} m
                  </p>
                  <p className="text-[11px] font-semibold text-brand-navy">{formatPrice(carpet.price, carpet.price_unit)}</p>
                </div>
                <button type="button" aria-label={`Edit ${carpet.name}`} title={t("Edit")} onClick={() => startEdit(carpet)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-navy">
                  <Pencil className="size-4" />
                </button>
                <button type="button" aria-label={`Remove ${carpet.name}`} onClick={() => remove(carpet.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {carpets.length === 0 && !error && <p className="mt-6 text-sm text-slate-500">{t(kind.noun === "carpet" ? "No carpets yet." : kind.noun === "door" ? "No doors yet." : "No windows yet.")}</p>}
      </main>
    </div>
  );
}
