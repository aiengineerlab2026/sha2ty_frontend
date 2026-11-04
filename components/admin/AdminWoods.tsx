"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImagePicker } from "@/components/vendor/ImagePicker";
import { CURRENCY, formatPrice } from "@/lib/plan/pricing";
import { UNIT_LABEL, WOOD_TYPES, woodType, type MaterialUnit } from "@/lib/designs/materials";

type Wood = {
  id: string; name: string; wood_type: string; description: string | null; texture_url: string; normal_url: string | null; tile_m: number;
  price: number | null; price_unit: MaterialUnit; thicknesses_mm: number[] | null; sheet_w_m: number | null; sheet_h_m: number | null; roughness: number | null; vendors: number;
};
type Call = (path: string, init?: RequestInit) => Promise<Record<string, unknown> | null>;

const SURFACES = [["matte", 0.75], ["satin", 0.5], ["gloss", 0.25]] as const;
const surfaceOf = (r: number | null) => (r == null || r >= 0.65 ? "matte" : r >= 0.4 ? "satin" : "gloss");
const GROUP_LABEL = { natural: "Natural wood", engineered: "Engineered wood", finish: "Finishes" } as const;

/** Admin portal: the default woods (supabase/woods.sql) customers pick per part and vendors tick. Only admins edit
 * them (backend/app/api/admin_woods.py); vendors see the result on their Woods page. */
export function AdminWoods({ call }: { call: Call }) {
  const t = useT();
  const [woods, setWoods] = useState<Wood[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Wood | "new" | null>(null);

  useEffect(() => {
    call("/woods").then(
      (body) => body && setWoods(body.woods as Wood[]),
      (caught: Error) => setError(caught.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (wood: Wood) => {
    if (!window.confirm(t("Delete “{name}”? {n} vendors work with it. Designs that used it keep their look.", { name: t(wood.name), n: wood.vendors }))) return;
    try {
      await call(`/woods/${wood.id}`, { method: "DELETE" });
      setWoods((list) => list?.filter((w) => w.id !== wood.id) ?? null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const order = (w: Wood) => WOOD_TYPES.findIndex((x) => x.id === w.wood_type);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-brand-navy">{t("Wood types")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t("The woods and finishes customers choose per part. Vendors tick the ones they work with; prices here are the reference for customers' estimates.")}</p>
        </div>
        <Button type="button" onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden /> {t("Add wood")}
        </Button>
      </div>
      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}
      {woods === null && !error && <p className="mt-4 text-sm text-slate-500">{t("Loading…")}</p>}
      {woods?.length === 0 && <p className="mt-4 text-sm text-slate-500">{t("No woods yet. Run supabase/woods.sql to add the defaults.")}</p>}
      {(["natural", "engineered", "finish"] as const).map((group) => {
        const list = (woods ?? []).filter((w) => woodType(w.wood_type)?.class === group).sort((a, b) => order(a) - order(b));
        if (!list.length) return null;
        return (
          <div key={group} className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t(GROUP_LABEL[group])}</h3>
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100">
              {list.map((w) => (
                <li key={w.id} className="flex items-center gap-3 p-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.texture_url} alt="" className="size-12 shrink-0 rounded-lg border border-slate-200 object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-brand-navy">{t(w.name)} <span className="font-normal text-slate-400">· {t(woodType(w.wood_type)?.name ?? w.wood_type)}</span></p>
                    <p className="truncate text-xs text-slate-500">
                      {[w.thicknesses_mm?.length ? `${w.thicknesses_mm.join(" / ")} ${t("mm")}` : null, w.price_unit === "sheet" && w.sheet_w_m ? `${t("sheet")} ${w.sheet_w_m} × ${w.sheet_h_m} m` : null, t(surfaceOf(w.roughness) === "matte" ? "Matte" : surfaceOf(w.roughness) === "satin" ? "Satin" : "Gloss"), t("{n} vendors", { n: w.vendors })].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-brand-navy">{w.price == null ? t("Price on request") : `${formatPrice(Number(w.price))} / ${t(UNIT_LABEL[w.price_unit])}`}</p>
                  <button type="button" onClick={() => setEditing(w)} title={t("Edit")} aria-label={t("Edit")} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-brand-navy">
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  <button type="button" onClick={() => void remove(w)} title={t("Delete")} aria-label={t("Delete")} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {editing && (
        <WoodDialog
          wood={editing === "new" ? null : editing}
          call={call}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setWoods((list) => (list?.some((w) => w.id === saved.id) ? list.map((w) => (w.id === saved.id ? { ...w, ...saved } : w)) : [...(list ?? []), saved]));
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function WoodDialog({ wood, call, onClose, onSaved }: { wood: Wood | null; call: Call; onClose: () => void; onSaved: (wood: Wood) => void }) {
  const t = useT();
  const [type, setType] = useState(wood?.wood_type ?? "oak");
  const [name, setName] = useState(wood?.name ?? "");
  const [description, setDescription] = useState(wood?.description ?? "");
  const [price, setPrice] = useState(wood?.price == null ? "" : String(Number(wood.price)));
  const [unit, setUnit] = useState<MaterialUnit>(wood?.price_unit ?? "m3");
  const [thicknesses, setThicknesses] = useState((wood?.thicknesses_mm ?? [18]).join(", "));
  const [sheet, setSheet] = useState([String(wood?.sheet_w_m ?? 1.22), String(wood?.sheet_h_m ?? 2.44)]);
  const [surface, setSurface] = useState<string>(surfaceOf(wood?.roughness ?? 0.5));
  const [tile, setTile] = useState(String(Math.round((wood?.tile_m ?? 0.6) * 100)));
  const [image, setImage] = useState<File | null>(null);
  const [normal, setNormal] = useState<File | null>(null);
  const [dropNormal, setDropNormal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!wood && !image) return setError(t("Add a grain photo."));
    const form = new FormData();
    const fields: Record<string, string> = {
      name, wood_type: type, description, price, price_unit: unit, thicknesses, sheet_w: sheet[0], sheet_h: sheet[1],
      roughness: String(SURFACES.find(([id]) => id === surface)![1]), tile_cm: tile,
    };
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (image) form.append("image", image);
    if (normal) form.append("normal", normal);
    if (dropNormal && !normal) form.append("remove_normal", "1");
    setSaving(true);
    setError(null);
    try {
      const body = await call(wood ? `/woods/${wood.id}` : "/woods", { method: wood ? "PATCH" : "POST", body: form });
      if (body) onSaved(body.wood as Wood);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const label = "block text-sm text-slate-600";
  const select = "mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={wood ? t("Edit wood") : t("Add wood")}>
      <form onSubmit={submit} className="max-h-[92dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-brand-navy">{wood ? t("Edit wood") : t("Add wood")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Close")} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-brand-navy">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm text-slate-600">{t("Wood type")}</legend>
          {(["natural", "engineered", "finish"] as const).map((group) => (
            <div key={group} role="radiogroup" aria-label={t(GROUP_LABEL[group])} className="flex flex-wrap items-center gap-1.5">
              <span className="w-28 shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400">{t(GROUP_LABEL[group])}</span>
              {WOOD_TYPES.filter((w) => w.class === group).map((w) => (
                <label key={w.id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-amber/40 ${type === w.id ? "border-brand-amber bg-brand-amber-soft text-brand-navy" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <input type="radio" name="admin-wood-type" value={w.id} checked={type === w.id} onChange={() => { setType(w.id); if (!wood) setUnit(w.unit); }} className="sr-only" />
                  {t(w.name)}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <ImagePicker value={image} onChange={setImage} label={t("Grain photo")} variant="dropzone" current={wood?.texture_url} />
            <ImagePicker value={normal} onChange={(f) => { setNormal(f); setDropNormal(false); }} label={t("Normal map (optional)")} current={dropNormal ? null : wood?.normal_url} />
            {wood?.normal_url && !normal && !dropNormal && (
              <button type="button" onClick={() => setDropNormal(true)} className="text-xs text-slate-500 underline">{t("Remove normal map")}</button>
            )}
          </div>
          <div className="space-y-3">
            <label className={label}>{t("Name")}
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t(woodType(type)?.name ?? "")} className="mt-1" />
            </label>
            <label className={label}>{t("Description")}
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <label className={label}>{t("Price ({currency})", { currency: CURRENCY })}
                <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={t("Leave empty for price on request")} className="mt-1 tabular-nums" />
              </label>
              <label className={label}>{t("Per")}
                <select value={unit} onChange={(e) => setUnit(e.target.value as MaterialUnit)} className={select}>
                  <option value="m2">{t("m²")}</option>
                  <option value="m3">{t("m³")}</option>
                  <option value="sheet">{t("sheet")}</option>
                </select>
              </label>
            </div>
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
            <div className="grid grid-cols-3 gap-2">
              <label className={`${label} col-span-2`}>{t("Thicknesses (mm)")}
                <Input value={thicknesses} onChange={(e) => setThicknesses(e.target.value)} placeholder="18, 25" className="mt-1 tabular-nums" />
              </label>
              <label className={label}>{t("Grain repeat (cm)")}
                <Input type="number" min="1" max="500" value={tile} onChange={(e) => setTile(e.target.value)} className="mt-1 tabular-nums" />
              </label>
            </div>
            <div role="radiogroup" aria-label={t("Surface")} className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-slate-600">{t("Surface")}</span>
              {SURFACES.map(([id]) => (
                <label key={id} className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition ${surface === id ? "border-brand-amber bg-brand-amber-soft text-brand-navy" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <input type="radio" name="admin-wood-surface" value={id} checked={surface === id} onChange={() => setSurface(id)} className="sr-only" />
                  {t(id === "matte" ? "Matte" : id === "satin" ? "Satin" : "Gloss")}
                </label>
              ))}
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button type="submit" disabled={saving}>
            {saving && <LoaderCircle className="size-4 animate-spin" aria-hidden />} {wood ? t("Save changes") : t("Add wood")}
          </Button>
        </div>
      </form>
    </div>
  );
}
