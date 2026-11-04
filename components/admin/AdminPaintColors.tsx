"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState, type FormEvent } from "react";
import { Check, LoaderCircle, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Color = { id: string; name: string; hex: string };
type Call = (path: string, init?: RequestInit) => Promise<Record<string, unknown> | null>;

/** Admin portal: the paint palette (supabase/model_paints.sql). Customers paint model parts in these colours only;
 * vendors sell paints in them (backend/app/api/admin_paint_colors.py). */
export function AdminPaintColors({ call }: { call: Call }) {
  const t = useT();
  const [colors, setColors] = useState<Color[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // a colour's id, or "new"
  const [name, setName] = useState("");
  const [hex, setHex] = useState("#cccccc");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    call("/paint-colors").then(
      (body) => body && setColors(body.colors as Color[]),
      (caught: Error) => setError(caught.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = (color: Color | null) => {
    setEditing(color?.id ?? "new");
    setName(color?.name ?? "");
    setHex(color?.hex ?? "#cccccc");
    setError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const init = { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), hex }) };
      const body = editing === "new" ? await call("/paint-colors", { method: "POST", ...init }) : await call(`/paint-colors/${editing}`, { method: "PATCH", ...init });
      const saved = body?.color as Color | undefined;
      if (saved) setColors((list) => (editing === "new" ? [...(list ?? []), saved] : (list ?? []).map((c) => (c.id === saved.id ? saved : c))));
      setEditing(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (color: Color) => {
    if (!window.confirm(t("Delete “{name}”? Vendors' paints in this colour are removed too. Designs already painted keep their colour.", { name: t(color.name) }))) return;
    try {
      await call(`/paint-colors/${color.id}`, { method: "DELETE" });
      setColors((list) => list?.filter((c) => c.id !== color.id) ?? null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const form = (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2 rounded-xl border border-brand-amber/50 bg-brand-amber-soft/30 p-2.5">
      <label className="text-xs text-slate-600">{t("Colour")}
        <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} aria-label={t("Colour")} className="mt-1 block h-9 w-14 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5" />
      </label>
      <label className="min-w-40 flex-1 text-xs text-slate-600">{t("Name")}
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder={t("e.g. Sage green")} className="mt-1" />
      </label>
      <Button type="submit" disabled={saving}>
        {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />} {t("Save")}
      </Button>
      <Button type="button" variant="outline" onClick={() => setEditing(null)} aria-label={t("Cancel")}>
        <X className="size-4" aria-hidden />
      </Button>
    </form>
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-brand-navy">{t("Paint colours")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t("The only colours customers can paint model parts in. Vendors add their paints in these colours.")}</p>
        </div>
        <Button type="button" onClick={() => start(null)}>
          <Plus className="size-4" aria-hidden /> {t("Add colour")}
        </Button>
      </div>
      {error && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}
      {colors === null && !error && <p className="mt-4 text-sm text-slate-500">{t("Loading…")}</p>}
      {editing === "new" && <div className="mt-4">{form}</div>}
      {colors?.length === 0 && editing !== "new" && <p className="mt-4 text-sm text-slate-500">{t("No paint colours yet.")}</p>}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(colors ?? []).map((c) =>
          editing === c.id ? (
            <li key={c.id} className="sm:col-span-2 lg:col-span-3">{form}</li>
          ) : (
            <li key={c.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-2">
              <span className="size-10 shrink-0 rounded-full border border-slate-200" style={{ background: c.hex }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-brand-navy">{t(c.name)}</span>
                <span className="block font-mono text-xs uppercase text-slate-400">{c.hex}</span>
              </span>
              <button type="button" onClick={() => start(c)} title={t("Edit")} aria-label={t("Edit")} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-brand-navy">
                <Pencil className="size-4" aria-hidden />
              </button>
              <button type="button" onClick={() => void remove(c)} title={t("Delete")} aria-label={t("Delete")} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
