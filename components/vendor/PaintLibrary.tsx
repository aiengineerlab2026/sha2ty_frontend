"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { BrickWall, Check, Image as ImageIcon, LayoutGrid, LoaderCircle, Palette, Pencil, Ruler, Trash2, X } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { uploadPublicFile } from "@/lib/vendor/storage";
import { ImagePicker } from "./ImagePicker";
import { VariantsEditor } from "./VariantsEditor";
import { addVariants } from "@/lib/catalog/variants";
import { PriceField, priceOrNull } from "./PriceField";
import { formatPrice } from "@/lib/plan/pricing";
import { tileLabel, tileSize } from "@/lib/plan/roomMaterials";
import type { Paint, PaintKind, PaintSurface, PriceUnit, VendorProfile } from "@/lib/vendor/types";

const PRESETS = ["#f4f1ea", "#e8e1d4", "#d9c6a5", "#c8b593", "#b7c4b1", "#a9bccb", "#d7b4a3", "#5b6573"];

/** Vendor's paints: flat colours or tiling textures that plans apply to wall faces or floors. */
export function PaintLibrary() {
  const t = useT();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [paints, setPaints] = useState<Paint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Paint | null>(null);
  const [filter, setFilter] = useState<"all" | PaintSurface>("all");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PaintKind>("color");
  const [surface, setSurface] = useState<PaintSurface>("wall");
  const [color, setColor] = useState("#e8e1d4");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  // Tile size is entered in centimetres (how tiles are sold) and stored in metres.
  const [tileW, setTileW] = useState("100");
  const [tileH, setTileH] = useState("100");
  const [price, setPrice] = useState("");
  const [priceUnit, setPriceUnit] = useState<PriceUnit>("m2");
  const form = useRef<HTMLFormElement>(null);
  // Variant images for a new paint, uploaded once it is saved (an existing paint edits its variants live).
  const [pendingVariants, setPendingVariants] = useState<File[]>([]);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void supabase()
      .auth.getSession()
      .then(async ({ data }) => {
        if (!data.session) {
          window.location.href = "/vendor/login";
          return;
        }
        const id = data.session.user.id;
        const [profile, list] = await Promise.all([
          supabase().from("vendors").select("*").eq("id", id).maybeSingle(),
          supabase().from("paints").select("*").eq("vendor_id", id).order("created_at", { ascending: false }),
        ]);
        setVendor(profile.data);
        if (list.error) setError(list.error.message);
        else setPaints((list.data ?? []) as Paint[]);
      });
  }, []);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // Object URL for the live preview; revoked when the file changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => {
    setEditing(null);
    setName("");
    setFile(null);
    setFilePreview(null);
    setPrice("");
    setPendingVariants([]);
  };

  const startEdit = (paint: Paint) => {
    const [w, h] = tileSize(paint);
    setEditing(paint);
    setName(paint.name);
    setKind(paint.kind);
    setSurface(paint.surface ?? "wall");
    setColor(paint.color);
    setFile(null);
    setFilePreview(null);
    setTileW(String(Math.round(w * 1000) / 10));
    setTileH(String(Math.round(h * 1000) / 10));
    setPrice(paint.price == null ? "" : String(paint.price));
    setPriceUnit(paint.price_unit ?? "m2");
    setError(null);
    form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!vendor) return;
    const tw = Number(tileW) / 100;
    const th = Number(tileH) / 100;
    const hasImage = Boolean(file || (editing?.kind === "texture" && editing.texture_url));
    if (kind === "texture" && (!hasImage || !(tw > 0) || !(th > 0))) {
      setError(t("Choose a texture image and a tile width and height above 0 cm."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const texture = kind === "texture" ? (file ? await uploadPublicFile(vendor.id, file, "paints") : (editing?.texture_url ?? null)) : null;
      const row = {
        name: name.trim() || (kind === "color" ? color : (file?.name ?? editing?.name ?? t("Texture"))),
        kind,
        surface,
        color: kind === "color" ? color : file ? await averageColor(file) : (editing?.color ?? "#cccccc"),
        texture_url: texture,
        // One image tile covers tile_width_m × tile_height_m on the wall / floor; tile_m kept for older readers.
        tile_m: kind === "texture" ? Math.max(tw, th) : 1,
        tile_width_m: kind === "texture" ? tw : 1,
        tile_height_m: kind === "texture" ? th : 1,
        price: priceOrNull(price),
        price_unit: priceUnit,
      };
      const query = editing
        ? supabase().from("paints").update(row).eq("id", editing.id).select().single()
        : supabase().from("paints").insert({ ...row, vendor_id: vendor.id }).select().single();
      const { data, error: next } = await query;
      if (next) throw next;
      const saved = data as Paint;
      if (!editing && pendingVariants.length) await addVariants("paint", saved.id, vendor.id, pendingVariants);
      setPaints((list) => (editing ? list.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...list]));
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (paint: Paint) => {
    if (!window.confirm(t("Remove \"{name}\"? Plans that already use it keep their copy.", { name: paint.name }))) return;
    const { error: next } = await supabase().from("paints").delete().eq("id", paint.id);
    if (next) setError(next.message);
    else {
      setPaints((list) => list.filter((p) => p.id !== paint.id));
      if (editing?.id === paint.id) reset();
    }
  };

  const shown = useMemo(() => paints.filter((p) => filter === "all" || (p.surface ?? "wall") === filter), [paints, filter]);
  const preview = { color, texture_url: kind === "texture" ? (filePreview ?? editing?.texture_url ?? null) : null };
  const previewMeta = kind === "color" ? color.toUpperCase() : tileLabel({ tile_m: 1, tile_w: Number(tileW) / 100 || 1, tile_h: Number(tileH) / 100 || 1 });

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">Paints &amp; floors</h1>
          <p className="mt-1 text-sm text-slate-500">{t("Colours and textures shoppers apply to walls or floors in the floor-plan editor.")}</p>
        </div>

        <form ref={form} onSubmit={submit} className="scroll-mt-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="text-base font-semibold text-brand-navy">{editing ? t("Edit “{name}”", { name: editing.name }) : t("Add a paint or floor finish")}</h2>
            {editing && (
              <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-navy">
                <X className="size-4" aria-hidden /> {t("Cancel edit")}
              </button>
            )}
          </div>
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="divide-y divide-slate-100">
              <Section title={t("Details")} hint={t("How it is listed in the catalogue.")}>
                <label className="block space-y-1.5">
                  <span className="text-[13px] font-semibold text-slate-700">{t("Name")}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Sand beige")} className={INPUT} />
                </label>
              </Section>

              <Section title={t("Apply to")} hint={t("Where shoppers can use it.")}>
                <OptionCards
                  value={surface}
                  onChange={setSurface}
                  options={[
                    ["wall", t("Walls"), t("Wall faces, per side"), BrickWall],
                    ["floor", t("Floors"), t("Whole room floors"), LayoutGrid],
                  ]}
                />
              </Section>

              <Section title={t("Finish")} hint={t("A flat colour, or an image that tiles.")}>
                <OptionCards
                  value={kind}
                  onChange={setKind}
                  options={[
                    ["color", t("Colour"), t("Solid paint"), Palette],
                    ["texture", t("Texture"), t("Repeating image"), ImageIcon],
                  ]}
                />
              </Section>

              <Section title={t("Appearance")} hint={kind === "color" ? t("Pick the exact colour.") : t("One image tile and the real area it covers.")}>
                {kind === "color" ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-slate-200" style={{ background: color }} title={t("Open colour picker")}>
                        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={t("Colour")} />
                      </label>
                      <input
                        value={color}
                        onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setColor(e.target.value)}
                        aria-label={t("Hex colour")}
                        className={`${INPUT} w-32 font-mono uppercase`}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2" aria-label={t("Suggested colours")}>
                      {PRESETS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          aria-label={c}
                          onClick={() => setColor(c)}
                          className={`flex size-7 items-center justify-center rounded-full ring-1 ring-black/10 transition hover:scale-110 ${color.toLowerCase() === c ? "ring-2 ring-brand-amber ring-offset-2" : ""}`}
                          style={{ background: c }}
                        >
                          {color.toLowerCase() === c && <Check className="size-3.5 text-slate-700" aria-hidden />}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <ImagePicker variant="dropzone" label={t("Texture image")} value={file} onChange={setFile} current={editing?.texture_url} />
                    <div className="grid grid-cols-2 gap-3">
                      <Metric label={t("Tile width")} value={tileW} onChange={setTileW} title={t("Real width one image tile covers, in centimetres")} />
                      <Metric label={t("Tile height")} value={tileH} onChange={setTileH} title={t("Real height one image tile covers, in centimetres")} />
                    </div>
                  </div>
                )}
              </Section>

              <Section title={t("Variant images")} hint={t("Extra photos shoppers swipe through (rooms, close-ups, swatches).")}>
                <VariantsEditor kind="paint" itemId={editing?.id} vendorId={vendor?.id} pending={pendingVariants} onPending={setPendingVariants} />
              </Section>

              <Section title={t("Pricing")} hint={t("Per m² is charged by the area it covers in a plan; Total is charged once.")}>
                <PriceField price={price} unit={priceUnit} onPrice={setPrice} onUnit={setPriceUnit} />
              </Section>
            </div>

            <aside className="border-t border-slate-100 bg-slate-50/70 p-6 lg:border-s lg:border-t-0">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t("Preview")}</p>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <PaintSwatch paint={preview} className="aspect-[4/3] w-full" />
                <div className="space-y-1 p-3">
                  <p className="truncate text-sm font-semibold text-brand-navy">{name.trim() || (kind === "color" ? t("Untitled colour") : t("Untitled texture"))}</p>
                  <p className="text-xs text-slate-500">
                    {surface === "floor" ? t("Floor") : t("Wall")} · {previewMeta}
                  </p>
                  <p className="text-sm font-semibold text-brand-navy">{formatPrice(priceOrNull(price), priceUnit)}</p>
                </div>
              </div>
              {error && <p className="mt-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={saving || !vendor}
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-navy text-sm font-semibold text-white shadow-sm transition hover:bg-brand-navy-hover disabled:opacity-60"
              >
                {saving && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                {saving ? t("Saving…") : editing ? t("Save changes") : t("Add to catalogue")}
              </button>
            </aside>
          </div>
        </form>

        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-brand-navy">
              {t("Your finishes")} <span className="ms-1 rounded-full bg-slate-200/70 px-2 py-0.5 align-middle text-xs font-medium text-slate-600">{paints.length}</span>
            </h2>
            <div className="flex rounded-lg bg-slate-200/60 p-0.5 text-sm" role="tablist" aria-label={t("Filter")}>
              {(["all", "wall", "floor"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1 font-medium transition-colors ${filter === f ? "bg-white text-brand-navy shadow-sm" : "text-slate-500 hover:text-brand-navy"}`}
                >
                  {f === "all" ? t("All") : f === "wall" ? t("Walls") : t("Floors")}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
              {paints.length ? t("Nothing in this filter.") : t("No paints yet. Add your first one above.")}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((paint) => {
                const floor = paint.surface === "floor";
                return (
                  <li
                    key={paint.id}
                    className={`group overflow-hidden rounded-xl border bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/10 ${
                      editing?.id === paint.id ? "border-brand-amber ring-2 ring-brand-amber/25" : "border-slate-200"
                    }`}
                  >
                    <div className="relative">
                      <PaintSwatch paint={paint} className="aspect-[4/3] w-full" />
                      <span className="absolute start-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-slate-700 shadow-sm backdrop-blur">
                        {floor ? <LayoutGrid className="size-3" aria-hidden /> : <BrickWall className="size-3" aria-hidden />}
                        {floor ? t("Floor") : t("Wall")}
                      </span>
                      {/* Shown on hover / keyboard focus; always visible on touch screens, which cannot hover. */}
                      <div className="absolute end-2 top-2 flex gap-1 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                        <IconAction label={`Edit ${paint.name}`} onClick={() => startEdit(paint)}>
                          <Pencil className="size-3.5" />
                        </IconAction>
                        <IconAction label={`Remove ${paint.name}`} danger onClick={() => void remove(paint)}>
                          <Trash2 className="size-3.5" />
                        </IconAction>
                      </div>
                    </div>
                    <div className="space-y-2 p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-brand-navy">{paint.name}</p>
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{paint.kind === "color" ? t("Colour") : t("Texture")}</span>
                      </div>
                      <p className="flex items-center gap-1.5 text-xs text-slate-500">
                        {paint.kind === "color" ? (
                          <>
                            <span className="size-2.5 rounded-full ring-1 ring-black/10" style={{ background: paint.color }} aria-hidden />
                            <span className="font-mono uppercase">{paint.color}</span>
                          </>
                        ) : (
                          <>
                            <Ruler className="size-3 text-slate-400" aria-hidden /> {tileLabel(paint)}
                          </>
                        )}
                      </p>
                      <p className="text-sm font-semibold tabular-nums text-brand-navy">{formatPrice(paint.price, paint.price_unit)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

const INPUT =
  "h-11 w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 hover:bg-white focus:border-brand-amber focus:bg-white focus:ring-4 focus:ring-brand-amber/15";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3 px-6 py-5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6">
      <div>
        <h3 className="text-sm font-semibold text-brand-navy">{title}</h3>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{hint}</p>}
      </div>
      <div>{children}</div>
    </section>
  );
}

/** Radio-style option cards with an icon, title and one-line description. */
function OptionCards<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string, string, ComponentType<{ className?: string }>][] }) {
  return (
    <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
      {options.map(([v, title, desc, Icon]) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v)}
            className={`flex items-center gap-3 rounded-xl border p-3 text-start transition ${
              on ? "border-brand-amber bg-brand-amber-soft/60 ring-2 ring-brand-amber/20" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${on ? "bg-white text-brand-amber shadow-sm" : "bg-slate-100 text-slate-500"}`}>
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-brand-navy">{title}</span>
              <span className="block text-xs text-slate-500">{desc}</span>
            </span>
            <span className={`ms-auto flex size-4 shrink-0 items-center justify-center rounded-full border ${on ? "border-brand-amber bg-brand-amber" : "border-slate-300"}`} aria-hidden>
              {on && <span className="size-1.5 rounded-full bg-white" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Metric({ label, value, onChange, title }: { label: string; value: string; onChange: (v: string) => void; title: string }) {
  const t = useT();
  return (
    <label className="block space-y-1.5" title={title}>
      <span className="text-[13px] font-semibold text-slate-700">{label}</span>
      <span className="relative block">
        <input type="number" min="1" step="0.5" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} pe-12 tabular-nums`} />
        <span className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">{t("cm")}</span>
      </span>
    </label>
  );
}

function IconAction({ label, onClick, danger = false, children }: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex size-8 items-center justify-center rounded-lg bg-white/95 shadow-sm ring-1 ring-black/5 backdrop-blur transition-colors ${danger ? "text-slate-500 hover:text-red-600" : "text-slate-500 hover:text-brand-navy"}`}
    >
      {children}
    </button>
  );
}

export function PaintSwatch({ paint, className = "" }: { paint: Pick<Paint, "color" | "texture_url">; className?: string }) {
  const t = useT();
  return (
    <span
      className={`block bg-cover bg-center ${className}`}
      style={{ backgroundColor: paint.color, backgroundImage: paint.texture_url ? `url(${JSON.stringify(paint.texture_url)})` : undefined }}
    />
  );
}

/** Average colour of an image, so exports (vertex colours, no textures) still match the texture's tone. */
async function averageColor(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "#cccccc";
  ctx.drawImage(bitmap, 0, 0, 1, 1); // the browser averages while downscaling
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
