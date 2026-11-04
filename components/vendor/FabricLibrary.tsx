"use client";

import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { uploadPublicFile } from "@/lib/vendor/storage";
import { ImagePicker } from "./ImagePicker";
import { CURRENCY, formatPrice } from "@/lib/plan/pricing";
import { UNIT_LABEL, WOOD_TYPES, woodType, type MaterialKind, type MaterialUnit } from "@/lib/designs/materials";

type Row = {
  id: string;
  name: string;
  texture_url: string;
  paint_color_id?: string | null;
  coverage_m2?: number | null;
  tile_m: number;
  price_per_m: number | null;
  kind: MaterialKind;
  wood_type: string | null;
  description: string | null;
  price: number | null;
  price_unit: MaterialUnit;
  thicknesses_mm: number[] | null;
  sheet_w_m: number | null;
  sheet_h_m: number | null;
  normal_url: string | null;
  roughness: number | null;
};

const COPY = {
  fabric: {
    title: "Upholstery fabrics",
    intro: "Upload a flat, seamless fabric photo; it repeats across the part. Shoppers pick it as the texture of a part when they customise a model.",
    photo: "Fabric photo",
    placeholder: "e.g. Grey linen",
    add: "Add fabric",
    empty: "No fabrics yet.",
    confirm: "Remove this fabric? Designs that already use it keep their look.",
  },
  wood: {
    title: "Wood materials",
    intro: "Add the woods and finishes you make furniture from: a flat photo of the grain, what it is priced by and the thicknesses you offer. Shoppers pick them per part (frame, legs, headboard) and see the cost.",
    photo: "Grain photo",
    placeholder: "e.g. European oak, natural oil",
    add: "Add wood",
    empty: "No woods yet.",
    confirm: "Remove this wood? Designs that already use it keep their look.",
  },
  paint: {
    title: "Furniture paints",
    intro: "Add the paints you sell in the platform's colours, priced per kg or litre. Customers painting a part see how much paint it takes and what it costs.",
    photo: "",
    placeholder: "e.g. Satin enamel",
    add: "Add paint",
    empty: "No paints yet.",
    confirm: "Remove this paint? Designs that already use it keep their colour.",
  },
} as const;
type PaintColor = { id: string; name: string; hex: string };

// A wood's tile: one photo covers 60 cm of grain unless set otherwise (fabrics: 30 cm, the column default).
const WOOD_TILE_M = 0.6;

/** Vendor's part materials (supabase/fabrics.sql): upholstery fabrics or woods, the textures and prices shoppers
 * put on model parts. */
export function FabricLibrary({ kind = "fabric" }: { kind?: MaterialKind }) {
  const t = useT();
  const copy = COPY[kind];
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [normal, setNormal] = useState<File | null>(null);
  const [type, setType] = useState("oak");
  const [unit, setUnit] = useState<MaterialUnit>(kind === "paint" ? "l" : "m3");
  const [description, setDescription] = useState("");
  const [thicknesses, setThicknesses] = useState("18");
  const [sheet, setSheet] = useState(["1.22", "2.44"]);
  const [finish, setFinish] = useState<"matte" | "satin" | "gloss">("satin");
  // Paints: a colour from the admins' palette (supabase/model_paints.sql), and how far one unit goes.
  const [colors, setColors] = useState<PaintColor[]>([]);
  const [colorId, setColorId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The row being edited: the form saves over it, keeping its photos unless new ones are chosen.
  const [editing, setEditing] = useState<Row | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void authSession().then(async ({ data }) => {
      if (!data.session) {
        window.location.href = "/vendor/login";
        return;
      }
      const id = data.session.user.id;
      setVendorId(id);
      const list = await supabase().from("fabrics").select("*").eq("vendor_id", id).eq("kind", kind).order("created_at", { ascending: false });
      if (list.error) setError(list.error.message);
      else setRows(list.data as Row[]);
      if (kind === "paint") {
        const palette = await supabase().from("paint_colors").select("id, name, hex").order("created_at");
        if (palette.error) setError(palette.error.message);
        else setColors(palette.data as PaintColor[]);
      }
    });
  }, [kind]);

  const pickType = (id: string) => {
    setType(id);
    setUnit(woodType(id)?.unit ?? "m2"); // the usual unit for it; the vendor can still change it
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (kind === "paint" && !colorId) {
      setError(t("Choose the paint's colour."));
      return;
    }
    if (!vendorId || (kind !== "paint" && !file && !editing)) {
      setError(t(kind === "wood" ? "Add a grain photo." : "Add a fabric image."));
      return;
    }
    const amount = price.trim() === "" ? null : Number(price);
    if (amount !== null && !(amount >= 0)) {
      setError(t("Enter a price of 0 or more, or leave it empty."));
      return;
    }
    const mm = thicknesses.split(/[,،\s]+/).filter(Boolean).map(Number);
    if (kind === "wood" && mm.some((x) => !(x > 0 && x <= 500))) {
      setError(t("Thicknesses are numbers in mm, separated by commas."));
      return;
    }
    const [sw, sh] = sheet.map(Number);
    if (kind === "wood" && unit === "sheet" && !(sw > 0 && sh > 0)) {
      setError(t("Enter the sheet width and length in metres."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const texture_url = kind === "paint" ? null : file ? await uploadPublicFile(vendorId, file, kind === "wood" ? "woods" : "fabrics") : editing!.texture_url;
      const normal_url = normal ? await uploadPublicFile(vendorId, normal, "woods/normal") : editing?.normal_url ?? null;
      const fallbackName = file?.name.replace(/\.[^.]+$/, "") || editing?.name || "";
      const row =
        kind === "fabric"
          ? { name: name.trim() || fallbackName, texture_url, price_per_m: amount }
          : kind === "paint"
          ? {
              name: name.trim() || t(colors.find((c) => c.id === colorId)?.name ?? "Paint"),
              texture_url,
              kind,
              paint_color_id: colorId,
              description: description.trim() || null,
              price: amount,
              price_unit: unit === "kg" ? "kg" : "l",
            }
          : {
              name: name.trim() || t(woodType(type)?.name ?? "Wood"),
              texture_url,
              kind,
              wood_type: type,
              description: description.trim() || null,
              price: amount,
              price_unit: unit,
              thicknesses_mm: mm.length ? mm : null,
              sheet_w_m: unit === "sheet" ? sw : null,
              sheet_h_m: unit === "sheet" ? sh : null,
              normal_url,
              roughness: { matte: 0.75, satin: 0.5, gloss: 0.25 }[finish],
              ...(editing ? {} : { tile_m: WOOD_TILE_M }),
            };
      const { data, error: next } = await (editing
        ? supabase().from("fabrics").update(row).eq("id", editing.id).select().single()
        : supabase().from("fabrics").insert({ ...row, vendor_id: vendorId }).select().single());
      if (next) throw next;
      const saved = data as Row;
      setRows((list) => (editing ? list.map((f) => (f.id === saved.id ? saved : f)) : [saved, ...list]));
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setEditing(null);
    setName("");
    setPrice("");
    setFile(null);
    setNormal(null);
    setDescription("");
    setThicknesses("18");
    setColorId(null);
  };

  const startEdit = (row: Row) => {
    setEditing(row);
    setName(row.name);
    const amount = kind === "fabric" ? row.price_per_m : row.price;
    setPrice(amount == null ? "" : String(Number(amount)));
    if (kind === "wood") {
      setType(row.wood_type ?? "oak");
      setUnit(row.price_unit);
      setDescription(row.description ?? "");
      setThicknesses((row.thicknesses_mm ?? []).join(", "));
      setSheet([String(row.sheet_w_m ?? 1.22), String(row.sheet_h_m ?? 2.44)]);
      setFinish(row.roughness == null || row.roughness >= 0.65 ? "matte" : row.roughness >= 0.4 ? "satin" : "gloss");
    }
    if (kind === "paint") {
      setColorId(row.paint_color_id ?? null);
      setUnit(row.price_unit);
      setDescription(row.description ?? "");
    }
    setFile(null);
    setNormal(null);
    setError(null);
    form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const remove = async (id: string) => {
    if (!window.confirm(t(copy.confirm))) return;
    const { error: next } = await supabase().from("fabrics").delete().eq("id", id);
    if (next) setError(next.message);
    else {
      setRows((list) => list.filter((f) => f.id !== id));
      if (editing?.id === id) resetForm();
    }
  };

  const priceText = (row: Row) => {
    const amount = kind === "fabric" ? row.price_per_m : row.price;
    if (amount == null) return t("Price on request");
    return `${formatPrice(Number(amount))} / ${t(UNIT_LABEL[kind === "fabric" ? "m" : row.price_unit])}`;
  };
  const label = "block text-sm text-slate-600";
  const select = "mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm";

  return (
    <div className="min-h-full bg-slate-50">
      <Header />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand-navy">{t(copy.title)}</h1>
          <p className="mt-1 text-sm text-slate-500">{t(copy.intro)}</p>
        </div>
        <form ref={form} onSubmit={add} className={`grid scroll-mt-20 gap-4 rounded-2xl border bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr] ${editing ? "border-brand-amber ring-2 ring-brand-amber/20" : "border-slate-200"}`}>
          {kind === "paint" ? (
            <fieldset className="space-y-2">
              <legend className="text-sm text-slate-600">{t("Colour")}</legend>
              <p className="text-xs text-slate-500">{t("Paint colours are set by the platform; choose the one this paint is.")}</p>
              {colors.length === 0 && <p className="text-xs text-slate-400">{t("No paint colours yet.")}</p>}
              <div role="radiogroup" aria-label={t("Colour")} className="grid grid-cols-5 gap-2 sm:grid-cols-6">
                {colors.map((c) => (
                  <label key={c.id} className="flex cursor-pointer flex-col items-center gap-1 text-center text-[11px] text-slate-600">
                    <input type="radio" name="paint-color" value={c.id} checked={colorId === c.id} onChange={() => setColorId(c.id)} className="peer sr-only" />
                    <span className={`size-10 rounded-full border transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-amber/40 ${colorId === c.id ? "border-brand-amber ring-2 ring-brand-amber ring-offset-2" : "border-slate-200"}`} style={{ background: c.hex }} />
                    <span className="line-clamp-2">{t(c.name)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : <div className="space-y-3">
            <ImagePicker value={file} onChange={setFile} label={t(copy.photo)} variant="dropzone" current={editing?.texture_url} />
            {kind === "wood" && <ImagePicker value={normal} onChange={setNormal} label={t("Normal map (optional)")} current={editing?.normal_url} />}
          </div>}
          <div className="space-y-3">
            {kind === "wood" && (
              <fieldset className="space-y-2">
                <legend className="text-sm text-slate-600">{t("Wood type")}</legend>
                {(["natural", "engineered", "finish"] as const).map((group) => (
                  <div key={group} role="radiogroup" aria-label={t(group === "natural" ? "Natural wood" : group === "engineered" ? "Engineered wood" : "Finishes")}>
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{t(group === "natural" ? "Natural wood" : group === "engineered" ? "Engineered wood" : "Finishes")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {WOOD_TYPES.filter((w) => w.class === group).map((w) => (
                        <label key={w.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-amber/40 ${type === w.id ? "border-brand-amber bg-brand-amber-soft text-brand-navy" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                          <input type="radio" name="wood-type" value={w.id} checked={type === w.id} onChange={() => pickType(w.id)} className="sr-only" />
                          {t(w.name)}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
            )}
            <label className={label}>{t("Name")}
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t(copy.placeholder)} className="mt-1" />
            </label>
            {kind !== "fabric" && (
              <label className={label}>{t("Description")}
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
            )}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <label className={label}>{kind === "fabric" ? t("Price per metre ({currency})", { currency: CURRENCY }) : t("Price ({currency})", { currency: CURRENCY })}
                <Input type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={t("Leave empty for price on request")} className="mt-1 tabular-nums" />
              </label>
              {kind === "paint" && (
                <label className={label}>{t("Per")}
                  <select value={unit === "kg" ? "kg" : "l"} onChange={(e) => setUnit(e.target.value as MaterialUnit)} className={select}>
                    <option value="l">{t("litre")}</option>
                    <option value="kg">{t("kg")}</option>
                  </select>
                </label>
              )}
              {kind === "wood" && (
                <label className={label}>{t("Per")}
                  <select value={unit} onChange={(e) => setUnit(e.target.value as MaterialUnit)} className={select}>
                    <option value="m2">{t("m²")}</option>
                    <option value="m3">{t("m³")}</option>
                    <option value="sheet">{t("sheet")}</option>
                  </select>
                </label>
              )}
            </div>
            {kind === "wood" && (
              <>
                {unit === "sheet" && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className={label}>{t("Sheet width (m)")}
                      <Input type="number" min="0.1" step="0.01" value={sheet[0]} onChange={(e) => setSheet([e.target.value, sheet[1]])} className="mt-1 tabular-nums" />
                    </label>
                    <label className={label}>{t("Sheet length (m)")}
                      <Input type="number" min="0.1" step="0.01" value={sheet[1]} onChange={(e) => setSheet([sheet[0], e.target.value])} className="mt-1 tabular-nums" />
                    </label>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <label className={label}>{t("Thicknesses (mm)")}
                    <Input value={thicknesses} onChange={(e) => setThicknesses(e.target.value)} placeholder="18, 25" className="mt-1 tabular-nums" />
                  </label>
                  <label className={label}>{t("Surface")}
                    <select value={finish} onChange={(e) => setFinish(e.target.value as typeof finish)} className={select}>
                      <option value="matte">{t("Matte")}</option>
                      <option value="satin">{t("Satin")}</option>
                      <option value="gloss">{t("Gloss")}</option>
                    </select>
                  </label>
                </div>
              </>
            )}
            {error && <p className="text-sm text-red-700">{error}</p>}
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={saving}>
                {saving && <LoaderCircle className="size-4 animate-spin" aria-hidden />} {editing ? t("Save changes") : t(copy.add)}
              </Button>
              {editing && <Button type="button" variant="outline" onClick={resetForm}>{t("Cancel")}</Button>}
            </div>
          </div>
        </form>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {rows.map((row) => (
            <div key={row.id} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${editing?.id === row.id ? "border-brand-amber ring-2 ring-brand-amber/30" : "border-slate-200"}`}>
              {kind === "paint" ? (
                <div className="aspect-square w-full" style={{ background: colors.find((c) => c.id === row.paint_color_id)?.hex ?? "#e2e8f0" }} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.texture_url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
              )}
              <div className="flex items-center gap-2 p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-navy">{row.name}</p>
                  {kind === "wood" && (
                    <p className="truncate text-xs text-slate-500">
                      {[t(woodType(row.wood_type)?.name ?? ""), row.thicknesses_mm?.length ? `${row.thicknesses_mm.join(" / ")} ${t("mm")}` : null].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {kind === "paint" && (
                    <p className="truncate text-xs text-slate-500">
                      {t(colors.find((c) => c.id === row.paint_color_id)?.name ?? "")}
                    </p>
                  )}
                  <p className="text-xs font-medium tabular-nums text-brand-navy">{priceText(row)}</p>
                </div>
                <button type="button" onClick={() => startEdit(row)} title={t("Edit")} aria-label={t("Edit")} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-brand-navy">
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button type="button" onClick={() => void remove(row.id)} title={t("Remove")} aria-label={t("Remove")} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
        {rows.length === 0 && !error && <p className="text-sm text-slate-500">{t(copy.empty)}</p>}
      </main>
    </div>
  );
}
