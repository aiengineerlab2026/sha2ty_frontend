"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Camera, ChevronDown, Loader2, RefreshCw, Shapes } from "lucide-react";
import { customisedModels, getDesign } from "@/lib/designs/api";
import type { Design, DesignData, DesignVersion } from "@/lib/designs/schema";
import { fetchCatalogModel } from "@/lib/plan/api";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import type { CatalogModel, PlacedItem } from "@/lib/plan/types";

type Saved = Design & { current: (DesignVersion & { data: DesignData }) | null };

/** The planner model for one saved version: the listing (category, price, vendor) when it still exists, the
 * design's size, name and look, pinned to that version. */
export async function asCatalogModel(design: Pick<Design, "id" | "title" | "thumbnail_url">, version: DesignVersion & { data: DesignData }): Promise<CatalogModel | null> {
  const item = version.data.item;
  const size = item?.dimensions ?? (item?.source.width_m && item.source.height_m ? { width: item.source.width_m, height: item.source.height_m, depth: item.source.depth_m ?? 0 } : null);
  if (!item || !size) return null;
  const listing = await fetchCatalogModel(item.source.model_id).catch(() => null);
  return {
    ...(listing ?? { id: item.source.model_id, company_id: item.source.vendor_id ?? "", company: "", category: "furniture" }),
    title: design.title,
    glb_url: item.source.glb_url, // the catalogue file; the version's edits are replayed on it (as in the editor)
    width_m: size.width,
    height_m: size.height,
    depth_m: size.depth || null,
    thumbnail: design.thumbnail_url ?? listing?.thumbnail ?? null,
    design: {
      id: design.id,
      version: version.number,
      materialEdits: item.material_edits as NonNullable<PlacedItem["materialEdits"]>,
      partPoses: item.part_poses as PlacedItem["partPoses"],
      partDocument: item.components,
      removedParts: item.removed_parts,
    },
  };
}

/** Planner sidebar: the signed-in user's customised models (latest version). Picking one starts placing it at its
 * saved size; the placement keeps that version. */
export function MyCustomisedModels({ signedIn, activeId, onPlace }: { signedIn: boolean; activeId: string | null; onPlace: (model: CatalogModel) => void }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<Saved[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    customisedModels().then(
      (list) => live && setRows(list),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [signedIn]);

  if (!signedIn) return null;
  const pick = async (row: Saved) => {
    if (!row.current) return;
    setPicking(row.id);
    setError(null);
    try {
      const model = await asCatalogModel(row, row.current);
      if (!model) throw new Error(t("{name} has no size saved.", { name: row.title }));
      onPlace(model);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPicking(null);
    }
  };

  return (
    <section className="mb-3 rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] font-semibold text-brand-navy">
        <Shapes className="size-4 text-brand-amber" aria-hidden />
        <span className="flex-1">{t("My customised models")}</span>
        {rows && <span className="text-xs font-normal text-slate-400">{rows.length}</span>}
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-slate-100 p-2">
          {error && <p className="text-xs text-red-700">{error}</p>}
          {rows === null && !error && <p className="text-xs text-slate-500">{t("Loading…")}</p>}
          {rows?.length === 0 && <p className="text-xs text-slate-500">{t("Customise a catalogue model and save it: it appears here to place in your plan.")}</p>}
          {rows?.map((row) => {
            const item = row.current?.data.item;
            const size = item?.dimensions;
            return (
              <button
                key={row.id}
                type="button"
                disabled={!row.current || picking === row.id}
                onClick={() => void pick(row)}
                className={`flex w-full items-center gap-2 rounded-lg border p-1.5 text-start transition-colors ${activeId === row.id ? "border-brand-amber bg-brand-amber-soft/50" : "border-slate-100 hover:bg-slate-50"}`}
              >
                <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                  {row.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumbnail_url} alt="" className="size-full object-contain" loading="lazy" />
                  ) : (
                    <Shapes className="size-5 text-slate-300" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-brand-navy">{row.title || t("Untitled design")}</span>
                  {size && <span className="block text-[11px] tabular-nums text-slate-500">{size.width.toFixed(2)} × {size.height.toFixed(2)} × {size.depth.toFixed(2)} m</span>}
                  <span className="block truncate text-[11px] text-slate-400">
                    {new Date(row.updated_at).toLocaleDateString()}{item?.source.title ? ` · ${t("from {title}", { title: item.source.title })}` : ""}
                  </span>
                </span>
                {picking === row.id && <Loader2 className="size-4 animate-spin text-slate-400" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** A placed customised model keeps the version it was placed with. When its design has a newer one, offer to
 * update this placement to it (size and look); nothing changes until the user asks. */
export function DesignVersionNotice({ item, onUpdate }: { item: PlacedItem; onUpdate: (patch: Partial<PlacedItem>) => void }) {
  const t = useT();
  const [latest, setLatest] = useState<{ design: Design; version: DesignVersion & { data: DesignData } } | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getDesign(item.designId!).then(
      (design) => live && design.current && setLatest({ design, version: design.current }),
      () => live && setGone(true),
    );
    return () => {
      live = false;
    };
  }, [item.designId]);

  if (gone) return <p className="mx-3 mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">{t("This customised model was removed from My designs; the placed copy stays as it was.")}</p>;
  if (!latest) return null;
  const newer = latest.version.number > (item.designVersion ?? 0);
  return (
    <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">
      <Shapes className="size-4 text-brand-amber" aria-hidden />
      <span className="flex-1">{newer ? t("{title} was changed since it was placed.", { title: latest.design.title }) : latest.design.title}</span>
      {newer && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void asCatalogModel(latest.design, latest.version)
              .then((model) => {
                if (!model?.design) return;
                const size = { width: model.width_m!, height: model.height_m!, depth: model.depth_m ?? item.depth_m };
                onUpdate({
                  designVersion: model.design.version,
                  materialEdits: model.design.materialEdits,
                  partPoses: model.design.partPoses,
                  partDocument: model.design.partDocument,
                  removedParts: model.design.removedParts,
                  title: model.title,
                  width_m: size.width,
                  height_m: size.height,
                  depth_m: size.depth,
                  catalogSize: size,
                });
              })
              .finally(() => setBusy(false));
          }}
          className="inline-flex items-center gap-1 rounded-md bg-brand-amber px-2 py-1 font-semibold text-brand-navy disabled:opacity-60"
        >
          <RefreshCw className="size-3" aria-hidden /> {t("Use the latest changes")}
        </button>
      )}
    </div>
  );
}

type PrivateModel = { id: string; title: string; category: string; width_m: number | null; height_m: number | null; depth_m: number | null; glb_url: string | null; source_image_url: string | null };

/** Planner sidebar: the signed-in user's private models, made from their own photos in the app
 * (supabase/user_models.sql; only theirs). Picking one starts placing it at its size. Hidden when there are none. */
export function MyPrivateModels({ signedIn, activeId, onPlace }: { signedIn: boolean; activeId: string | null; onPlace: (model: CatalogModel) => void }) {
  const t = useT();
  const [rows, setRows] = useState<PrivateModel[]>([]);
  useEffect(() => {
    if (!signedIn || !supabaseConfigured()) return;
    void supabase()
      .from("user_models")
      .select("id, title, category, width_m, height_m, depth_m, glb_url, source_image_url")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows(((data ?? []) as PrivateModel[]).filter((m) => m.glb_url && m.width_m && m.height_m))); // before user_models.sql: none
  }, [signedIn]);
  if (!rows.length) return null;
  return (
    <section className="mb-3 rounded-xl border border-slate-200 bg-white">
      <p className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-brand-navy">
        <Camera className="size-4 text-brand-amber" aria-hidden />
        <span className="flex-1">{t("My models")}</span>
        <span className="text-xs font-normal text-slate-400">{rows.length}</span>
      </p>
      <div className="space-y-1.5 border-t border-slate-100 p-2">
        {rows.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onPlace({ id: m.id, title: m.title, category: m.category, width_m: m.width_m, height_m: m.height_m, depth_m: m.depth_m, glb_url: m.glb_url!, thumbnail: m.source_image_url, company_id: "", company: t("My models") })}
            className={`flex w-full items-center gap-2 rounded-lg border p-1.5 text-start transition-colors ${activeId === m.id ? "border-brand-amber bg-brand-amber-soft/50" : "border-slate-100 hover:bg-slate-50"}`}
          >
            <span className="size-12 shrink-0 overflow-hidden rounded-md bg-slate-100">
              {m.source_image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.source_image_url} alt="" className="size-full object-cover" loading="lazy" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-brand-navy">{m.title || t("Model")}</span>
              <span className="block text-[11px] tabular-nums text-slate-500">{Number(m.width_m).toFixed(2)} × {Number(m.height_m).toFixed(2)}{m.depth_m ? ` × ${Number(m.depth_m).toFixed(2)}` : ""} m</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
