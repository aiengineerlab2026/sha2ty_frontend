"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Check, PanelRightClose, ShoppingCart } from "lucide-react";
import { addToCart } from "@/lib/cart";
import { formatPrice } from "@/lib/plan/pricing";
import type { PlacedItem } from "@/lib/plan/types";
import { designFromModel, saveItemVersion } from "@/lib/designs/api";
import { uploadPublicFile } from "@/lib/vendor/storage";
import type { MaterialEdit, PartInfo } from "@/lib/vendor/parts";
import { PartControls, PartList } from "@/components/vendor/PartEditor";
import { WHOLE } from "@/components/vendor/ModelViewer";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";

type Tab = "details" | "dimensions" | "parts" | "materials" | "transform";
type Unit = "m" | "cm";
type PaintTex = { id: string; name: string; url: string; price: number | null; price_unit: "item" | "m2"; vendor: string };

const TABS: Tab[] = ["details", "dimensions", "parts", "materials", "transform"];
const TAB_LABEL: Record<Tab, string> = { details: "Details", dimensions: "Dimensions", parts: "Parts", materials: "Materials", transform: "Transform" };

/** Right-hand editor for one placed model. Changes stay on this instance; the catalogue row is not written. */
export function PlacedItemEditor({
  item,
  parts,
  separated,
  partId,
  editing,
  fitNotes,
  canUndo,
  canRedo,
  userId,
  onClose,
  onEdit,
  onApply,
  onCancel,
  onUndo,
  onRedo,
  onPatch,
  onPickPart,
  onDuplicate,
  onExport,
}: {
  item: PlacedItem;
  parts: PartInfo[];
  separated: boolean;
  partId: string | null;
  editing: boolean;
  fitNotes: string[];
  canUndo: boolean;
  canRedo: boolean;
  userId: string | null;
  onClose: () => void;
  onEdit: () => void;
  onApply: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPatch: (patch: Partial<PlacedItem>) => void;
  onPickPart: (id: string) => void;
  onDuplicate: () => void;
  onExport: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("details");
  const [unit, setUnit] = useState<Unit>("m");
  const [paints, setPaints] = useState<PaintTex[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const named = parts.map((entry) => ({ ...entry, name: item.partNames?.[entry.id] ?? entry.name }));
  const part = named.find((entry) => entry.id === partId) ?? null;
  const edit = partId ? item.materialEdits?.[partId] ?? null : null;
  const pose = partId ? item.partPoses?.[partId] : undefined;
  const material = item.surfaceMaterials?.find((entry) => entry.partId === partId);
  const original = item.catalogSize ?? { width: item.width_m, height: item.height_m, depth: item.depth_m };
  const shown = item.size ?? { width: item.width_m, height: item.height_m, depth: item.depth_m };
  const scale = pose?.scale ?? [1, 1, 1];
  const stretched = Math.max(...scale) / Math.min(...scale) > 1.02;

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void supabase()
      .from("paints")
      .select("id, name, texture_url, price, price_unit")
      .eq("kind", "texture")
      .not("texture_url", "is", null)
      .limit(24)
      .then(({ data }) => {
        setPaints(
          (data ?? [])
            .filter((row) => row.texture_url)
            .map((row) => ({
              id: row.id as string,
              name: row.name as string,
              url: row.texture_url as string,
              price: (row.price as number | null) ?? null,
              price_unit: row.price_unit === "item" ? "item" : "m2",
              vendor: "",
            })),
        );
      });
  }, []);

  const patchEdit = (patch: MaterialEdit) => {
    if (!partId) return;
    onPatch({ materialEdits: { ...item.materialEdits, [partId]: { ...item.materialEdits?.[partId], ...patch } } });
  };

  const rememberPaint = (paint: PaintTex) => {
    if (!partId) return;
    const area = material?.area_m2 || boxArea(shown);
    const rest = (item.surfaceMaterials ?? []).filter((entry) => entry.partId !== partId);
    onPatch({
      materialEdits: { ...item.materialEdits, [partId]: { ...item.materialEdits?.[partId], mapUrl: paint.url, color: "#ffffff" } },
      surfaceMaterials: [...rest, { partId, refId: paint.id, name: paint.name, price: paint.price, price_unit: paint.price_unit, area_m2: area }],
    });
  };

  const setDim = (key: "width_m" | "height_m" | "depth_m", metres: number) => {
    if (!(metres > 0) || metres > 20) return;
    onPatch({
      [key]: metres,
      sizedByUser: true,
      catalogSize: item.catalogSize ?? { width: item.width_m, height: item.height_m, depth: item.depth_m },
    });
  };

  const setPose = (patch: NonNullable<PlacedItem["partPoses"]>[string]) => {
    if (!partId || !separated) return;
    onPatch({ partPoses: { ...item.partPoses, [partId]: { ...item.partPoses?.[partId], ...patch } }, sizedByUser: true });
  };

  const resetMesh = () => {
    if (!partId) return;
    const edits = { ...item.materialEdits };
    delete edits[partId];
    const poses = { ...item.partPoses };
    delete poses[partId];
    onPatch({
      materialEdits: edits,
      partPoses: poses,
      surfaceMaterials: (item.surfaceMaterials ?? []).filter((entry) => entry.partId !== partId),
    });
  };

  const resetItem = () => {
    onPatch({
      width_m: original.width,
      height_m: original.height,
      depth_m: original.depth,
      sizedByUser: false,
      materialEdits: {},
      partPoses: {},
      surfaceMaterials: [],
    });
  };

  const saveDesign = async () => {
    if (!userId) {
      setNotice(t("Sign in to keep this in My designs."));
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const edits = { ...(item.materialEdits ?? {}) };
      for (const [id, value] of Object.entries(edits)) {
        if (value.mapUrl?.startsWith("blob:")) {
          const file = await fetch(value.mapUrl).then((res) => res.blob());
          edits[id] = { ...value, mapUrl: await uploadPublicFile(userId, new File([file], "texture.png", { type: file.type || "image/png" }), `designs/planner/${item.instanceId}`) };
        }
      }
      const design = item.designId ? { id: item.designId } : await designFromModel(item.modelId, item.title);
      await saveItemVersion(design.id, {
        item: {
          dimensions: { width: item.width_m, height: item.height_m, depth: item.depth_m },
          material_edits: edits,
          ...(item.partPoses && Object.keys(item.partPoses).length ? { part_poses: item.partPoses } : {}),
          ...(named.length ? { components: { separated, components: named, limits: separated ? null : WHOLE } } : {}),
        },
        note: "Saved from the planner",
        clientToken: crypto.randomUUID(),
      });
      onPatch({ designId: design.id, materialEdits: edits });
      setNotice(t("Saved to My designs. The catalogue listing was not changed."));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const dim = (key: "width_m" | "height_m" | "depth_m", label: string) => (
    <label className="text-xs text-slate-500">
      {t(label)}
      <input
        type="number"
        min={unit === "m" ? 0.05 : 5}
        step={unit === "m" ? 0.01 : 1}
        value={round(item[key] * (unit === "cm" ? 100 : 1), unit === "cm" ? 1 : 3)}
        onChange={(e) => setDim(key, Number(e.target.value) / (unit === "cm" ? 100 : 1))}
        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
      />
    </label>
  );

  return (
    <aside aria-label={t("Item details")} className="flex h-full w-80 shrink-0 flex-col border-s border-slate-200 bg-white max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:h-[72dvh] max-md:w-full max-md:rounded-t-2xl max-md:border-t max-md:shadow-2xl">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-100 px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("Item details")}</h2>
        <button type="button" aria-label={t("Close details")} onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
          <PanelRightClose className="size-4" />
        </button>
      </div>
      {editing && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 px-2 py-1.5">
          {TABS.map((id) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`shrink-0 rounded-lg px-2 py-1 text-xs font-medium ${tab === id ? "bg-brand-navy text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {t(TAB_LABEL[id])}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {(!editing || tab === "details") && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{item.company}</p>
            <h3 className="text-lg font-semibold text-brand-navy">{item.title}</h3>
            <p className="text-sm font-semibold text-brand-navy">{formatPrice(item.price, item.price_unit ?? "item")}</p>
            <p className="text-xs tabular-nums text-slate-600">
              {t("Catalogue size")} {original.width.toFixed(2)} × {original.height.toFixed(2)} × {original.depth.toFixed(2)} m
            </p>
            <p className="text-xs tabular-nums text-slate-600">
              {t("In the room")} {shown.width.toFixed(2)} × {shown.height.toFixed(2)} × {shown.depth.toFixed(2)} m
            </p>
            <p className="text-xs text-slate-500">{t("Your edits stay on this copy. The vendor's listing is not changed.")}</p>
          </div>
        )}
        {editing && tab === "dimensions" && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              {dim("width_m", "Width")}
              {dim("height_m", "Height")}
              {dim("depth_m", "Depth")}
            </div>
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
              <option value="m">m</option>
              <option value="cm">cm</option>
            </select>
            <p className="text-xs text-slate-500">{t("The model stays on the floor. A different width, height and depth stretches the whole mesh.")}</p>
            {fitNotes.map((note) => (
              <p key={note} className="text-xs text-amber-800">{t(note)}</p>
            ))}
            {separated && part && (
              <div className="space-y-1 border-t border-slate-100 pt-2">
                <p className="text-xs font-semibold text-brand-navy">{t("Selected part")}</p>
                <div className="grid grid-cols-3 gap-2">
                  {(["width", "height", "depth"] as const).map((axis, index) => (
                    <label key={axis} className="text-xs text-slate-500">
                      {t(axis === "width" ? "Width" : axis === "height" ? "Height" : "Depth")}
                      <input
                        type="number"
                        min={0.2}
                        step={0.05}
                        value={round(scale[index], 2)}
                        onChange={(e) => {
                          const next = [...scale] as [number, number, number];
                          const value = Number(e.target.value);
                          if (value > 0 && value <= 5) next[index] = value;
                          setPose({ scale: next });
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      />
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">{t("Part size is a multiplier of the mesh as authored (1 = unchanged).")}</p>
                {stretched && <p className="text-xs text-amber-800">{t("This stretches the selected mesh. The other parts stay as they are.")}</p>}
              </div>
            )}
            {!separated && <p className="text-xs text-slate-500">{t(WHOLE)}</p>}
          </div>
        )}
        {editing && tab === "parts" && (
          parts.length ? (
            <PartList parts={named} selected={partId} limits={separated ? null : WHOLE} onSelect={onPickPart} onRename={(id, name) => onPatch({ partNames: { ...item.partNames, [id]: name } })} />
          ) : (
            <p className="text-xs text-slate-500">{t("Loading the model’s parts…")}</p>
          )
        )}
        {editing && tab === "materials" && (
          <div className="space-y-2">
            {!separated && <p className="text-xs text-slate-500">{t(WHOLE)}</p>}
            <PartControls
              name={part?.name ?? null}
              edit={part ? { color: edit?.color ?? "#cccccc", ...edit } : null}
              mapping={edit?.mapping}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={onUndo}
              onRedo={onRedo}
              onColor={(hex) => patchEdit({ color: hex })}
              onPreset={(roughness, metalness) => patchEdit({ roughness, metalness })}
              onLibrary={(url, tile, picked) => {
                const paint = paints.find((entry) => entry.url === url);
                if (paint) rememberPaint(paint);
                else patchEdit({ ...picked, mapUrl: url, color: "#ffffff", tile });
              }}
              onRepeat={(repeat) => patchEdit({ repeat })}
              onTile={(tile) => patchEdit({ tile })}
              onRotation={(rotation) => patchEdit({ rotation })}
              onOffset={(offset) => patchEdit({ offset })}
              onRoughness={(roughness) => patchEdit({ roughness })}
              onMetalness={(metalness) => patchEdit({ metalness })}
              onReset={resetMesh}
            />
            {material && (
              <div className="rounded-xl border border-slate-200 p-2 text-xs text-slate-600">
                <p className="font-semibold text-brand-navy">{material.name}{paints.find((entry) => entry.id === material.refId)?.vendor ? ` · ${paints.find((entry) => entry.id === material.refId)?.vendor}` : ""}</p>
                <p className="tabular-nums">{formatPrice(material.price, material.price_unit)} · {material.area_m2.toFixed(2)} m²</p>
                <button
                  type="button"
                  onClick={() => {
                    addToCart([{
                      key: `texture:${material.refId}`,
                      kind: "model",
                      refId: material.refId,
                      name: material.name,
                      quantity: material.price_unit === "m2" ? material.area_m2 : 1,
                      unit: material.price_unit,
                      price: material.price,
                    }]);
                    setAdded(true);
                    setTimeout(() => setAdded(false), 1500);
                  }}
                  className="mt-2 flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-brand-amber text-xs font-semibold text-brand-navy"
                >
                  {added ? <Check className="size-3.5" /> : <ShoppingCart className="size-3.5" />}
                  {added ? t("Added to cart") : t("Add material to cart")}
                </button>
              </div>
            )}
          </div>
        )}
        {editing && tab === "transform" && (
          <div className="space-y-2 text-xs text-slate-600">
            <div className="grid grid-cols-2 gap-2">
              <Num label={t("X")} value={item.x} onChange={(x) => onPatch({ x })} />
              <Num label={t("Z")} value={item.z} onChange={(z) => onPatch({ z })} />
              <Num label={t("Rotation")} value={item.rotation_y} onChange={(rotation_y) => onPatch({ rotation_y })} />
              <Num label={t("Tilt")} value={item.rotation_x ?? 0} onChange={(rotation_x) => onPatch({ rotation_x })} />
            </div>
            {separated && partId ? (
              <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-2">
                <Num label={t("Part X")} value={pose?.position?.[0] ?? 0} step={0.01} onChange={(v) => setPose({ position: [v, pose?.position?.[1] ?? 0, pose?.position?.[2] ?? 0] })} />
                <Num label={t("Part Y")} value={pose?.position?.[1] ?? 0} step={0.01} onChange={(v) => setPose({ position: [pose?.position?.[0] ?? 0, v, pose?.position?.[2] ?? 0] })} />
                <Num label={t("Part Z")} value={pose?.position?.[2] ?? 0} step={0.01} onChange={(v) => setPose({ position: [pose?.position?.[0] ?? 0, pose?.position?.[1] ?? 0, v] })} />
                <Num label={t("Part turn")} value={pose?.rotation?.[1] ?? 0} onChange={(v) => setPose({ rotation: [pose?.rotation?.[0] ?? 0, v, pose?.rotation?.[2] ?? 0] })} />
              </div>
            ) : (
              <p>{t(WHOLE)}</p>
            )}
          </div>
        )}
        {notice && <p className="text-xs text-slate-600">{notice}</p>}
      </div>
      <div className="shrink-0 space-y-2 border-t border-slate-100 p-3">
        {editing ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onApply} className="h-9 rounded-xl bg-brand-amber text-sm font-semibold text-brand-navy">{t("Apply")}</button>
            <button type="button" onClick={onCancel} className="h-9 rounded-xl border border-slate-200 text-sm font-semibold text-brand-navy">{t("Cancel")}</button>
            <button type="button" disabled={!canUndo} onClick={onUndo} className="h-9 rounded-xl border border-slate-200 text-sm disabled:opacity-40">{t("Undo")}</button>
            <button type="button" disabled={!canRedo} onClick={onRedo} className="h-9 rounded-xl border border-slate-200 text-sm disabled:opacity-40">{t("Redo")}</button>
          </div>
        ) : (
          <button type="button" onClick={onEdit} className="h-10 w-full rounded-xl bg-brand-amber text-sm font-semibold text-brand-navy">{t("Edit model")}</button>
        )}
        <button type="button" onClick={resetItem} className="h-8 w-full text-xs text-slate-500 underline">{t("Reset furniture")}</button>
        <button type="button" onClick={onDuplicate} className="h-8 w-full rounded-xl border border-slate-200 text-sm font-semibold text-brand-navy">{t("Duplicate")}</button>
        <button type="button" disabled={busy} onClick={() => void saveDesign()} className="h-8 w-full rounded-xl border border-slate-200 text-sm font-semibold text-brand-navy disabled:opacity-50">{t("Save to My designs")}</button>
        <button type="button" onClick={onExport} className="h-8 w-full text-xs text-slate-500 underline">{t("Export apartment GLB")}</button>
      </div>
    </aside>
  );
}

function Num({ label, value, step = 0.05, onChange }: { label: string; value: number; step?: number; onChange: (n: number) => void }) {
  return (
    <label>
      {label}
      <input type="number" step={step} value={round(value, 3)} onChange={(e) => onChange(Number(e.target.value) || 0)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900" />
    </label>
  );
}

function round(n: number, digits: number) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function boxArea(size: { width: number; height: number; depth: number }) {
  return 2 * (size.width * size.height + size.width * size.depth + size.height * size.depth);
}
