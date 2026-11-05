"use client";

import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Box, ChevronDown, Download, FileBox, FileText, Focus, Loader2, RotateCw, Ruler, Save, Shapes, Tag, Trees } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Header } from "@/components/shatably/Header";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import type { CatalogModel, VendorProfile } from "@/lib/vendor/types";
import { Dimensions, metersToInput, numberOrNull } from "./Dimensions";
import { PriceField, priceOrNull } from "./PriceField";
import { WoodsField } from "./WoodsField";
import { CategoryPicker } from "./CategoryPicker";
import { VariantsEditor } from "./VariantsEditor";
import { ShapeField, type ModelShape } from "./ShapeField";
import { categoryOf, type ModelCategory } from "@/lib/plan/categories";
import type { PriceUnit } from "@/lib/vendor/types";
import { RichText } from "./RichText";
import { catalogDimensions } from "@/lib/plan/modelNormalization";
import { customizedModelFields, updateModel, type PartEditorApi } from "@/lib/vendor/parts";
import { uploadPublicFile } from "@/lib/vendor/storage";
import { ReplaceGlb } from "./ReplaceGlb";

const ModelViewer = dynamic(() => import("./ModelViewer").then((mod) => mod.ModelViewer), {
  ssr: false,
  loading: () => <LoadingViewer />,
});

function LoadingViewer() {
  const t = useT();
  return <div className="flex h-[min(70vh,640px)] items-center justify-center rounded-2xl bg-brand-navy text-sm text-slate-400">{t("Loading viewer…")}</div>;
}

export function ModelDetail({ id }: { id: string }) {
  const t = useT();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [model, setModel] = useState<CatalogModel | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resetView, setResetView] = useState(0);
  const [spin, setSpin] = useState(false);
  const [width, setWidth] = useState("");
  const [price, setPrice] = useState("");
  const [priceUnit, setPriceUnit] = useState<PriceUnit>("item");
  const [category, setCategory] = useState<ModelCategory>("furniture");
  const [woods, setWoods] = useState<string[] | null>(null);
  const [shape, setShape] = useState<ModelShape>("straight");
  const [length2, setLength2] = useState("");
  const [height, setHeight] = useState("");
  const [depth, setDepth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const editor = useRef<PartEditorApi | null>(null);
  // A new 3D file uploaded but not saved yet: Save puts it on the listing (a fresh part list, look and picture).
  const [replaced, setReplaced] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState(0); // the viewer starts over on a new file

  useEffect(() => {
    if (!supabaseConfigured()) return; // shown below, from the same check
    void (async () => {
      const { data: session } = await authSession();
      if (!session.session) {
        window.location.href = "/vendor/login";
        return;
      }
      const userId = session.session.user.id;
      const profile = await supabase().from("vendors").select("*").eq("id", userId).maybeSingle();
      setVendor(profile.data);
      const row = await supabase()
        .from("models")
        .select("*, model_variants(*)")
        .eq("id", id)
        .eq("vendor_id", userId)
        .maybeSingle();
      if (row.error) setError(row.error.message);
      else if (!row.data) setError(t("Model not found."));
      else {
        const next = row.data as CatalogModel;
        setModel(next);
        setTitle(next.title ?? "");
        setDescription(next.description ?? "");
        setWidth(metersToInput(next.width_m));
        setHeight(metersToInput(next.height_m));
        setDepth(metersToInput(next.depth_m));
        setPrice(next.price == null ? "" : String(next.price));
        setPriceUnit(next.price_unit ?? "item");
        setCategory(categoryOf(next.category));
        setWoods(next.woods ?? null);
        setShape(next.shape ?? "straight");
        setLength2(metersToInput(next.length2_m));
      }
    })();
  }, [id]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!model) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const materials = editor.current && vendor && model.glb_url
        ? await customizedModelFields(vendor.id, model.id, replaced ?? model.glb_url, replaced ? null : model.source_glb_url ?? null, editor.current, model.version ?? 1)
        : null;
      // Customers' designs keep the file they started from (their design stores it); new ones start from this file.
      const newFile = replaced ? { glb_url: replaced, source_glb_url: replaced, components: null, material_edits: {} } : {};
      const updated = await updateModel(model.id, {
          title: title.trim() || model.title,
          description,
          width_m: numberOrNull(width),
          height_m: numberOrNull(height),
          depth_m: numberOrNull(depth),
          price: priceOrNull(price),
          price_unit: priceUnit,
          category,
          shape,
          length2_m: shape === "straight" ? null : numberOrNull(length2),
          updated_at: new Date().toISOString(),
          ...newFile,
          ...(materials?.fields ?? {}),
          // Only when changed: saving keeps working before woods.sql adds the column.
          // Sha2ty's models are offered in every wood (an earlier pick is cleared); a vendor's keep their choice.
          ...(vendor?.platform ? (model.woods != null ? { woods: null } : {}) : JSON.stringify(woods) !== JSON.stringify(model.woods ?? null) ? { woods } : {}),
        });
      if (updated.error) {
        setError(updated.error.message);
        return;
      }
      setModel({ ...model, ...newFile, ...(materials?.fields ?? {}), woods: vendor?.platform ? null : woods, title: title.trim() || model.title } as CatalogModel);
      setReplaced(null);
      if (materials?.thumbnailError) {
        setError(t("Saved, but the model image could not be updated ({error}). The previous image is kept; save again to retry.", { error: materials.thumbnailError }));
        return;
      }
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const status = model?.status ?? null;
  const size = [numberOrNull(width), numberOrNull(height), numberOrNull(depth)];
  const form = model && (
    <form id="model-form" onSubmit={save} className="space-y-4">
      <Card title={t("General info")} icon={<FileText className="size-4" aria-hidden />}>
        <div className="space-y-1.5">
          <Label htmlFor="model-title">{t("Model name")}</Label>
          <Input id="model-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Description")}</Label>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-brand-amber focus-within:ring-2 focus-within:ring-brand-amber/20">
            <RichText key={model.id} value={description} onChange={setDescription} />
          </div>
        </div>
      </Card>
      <Card title={t("Classification")} icon={<Shapes className="size-4" aria-hidden />}>
        <CategoryPicker value={category} onChange={setCategory} />
      </Card>
      <Card title={t("Shape & specs")} icon={<Ruler className="size-4" aria-hidden />}>
        <ShapeField shape={shape} onShape={setShape} length2={length2} onLength2={setLength2} />
        <Dimensions width={width} height={height} depth={depth} onWidth={setWidth} onHeight={setHeight} onDepth={setDepth} labels={shape === "straight" ? undefined : ["Length on wall A m", "Height m", "Arm depth m"]} />
        <p className="text-xs text-slate-500">{t("Dimensions are stored in meters.")}</p>
      </Card>
      <Card title={t("Price & variants")} icon={<Tag className="size-4" aria-hidden />}>
        <PriceField price={price} unit={priceUnit} onPrice={setPrice} onUnit={setPriceUnit} />
        {/* Changes to variants save immediately (add / remove one / remove all). */}
        <VariantsEditor kind="model" itemId={model.id} vendorId={vendor?.id} />
      </Card>
      {/* Sha2ty's models (admins) come in every wood: the customer picks one when customising. */}
      {category === "furniture" && !vendor?.platform && (
        <Card title={t("Wood types")} icon={<Trees className="size-4" aria-hidden />}>
          <WoodsField vendorId={vendor?.id} platform={vendor?.platform} value={woods} onChange={setWoods} />
        </Card>
      )}
    </form>
  );
  // Icons only on phones (one compact row that does not cover the model), with labels from sm up.
  const tool = "inline-flex items-center gap-1.5 rounded-full p-2 transition hover:bg-slate-100 hover:text-brand-navy sm:px-3 sm:py-1.5";
  const label = "hidden sm:inline";
  return (
    // A fixed workspace the height of the window (the page never scrolls; the header and this bar stay put):
    // details | 3D viewport | parts and materials. ModelViewer lays out the columns, drawers and phone tabs, and on
    // phones scrolls the area under the bar itself.
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900">
      <Header vendor={vendor} />
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-5">
        <Link href="/vendor" className="inline-flex shrink-0 items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-navy">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> <span className="sr-only sm:not-sr-only">{t("Models")}</span>
        </Link>
        <span className="hidden text-slate-300 sm:inline" aria-hidden>/</span>
        <h1 className="min-w-0 truncate text-[15px] font-semibold text-brand-navy">{title || model?.title || t("Model")}</h1>
        {status && (
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${status === "ready" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : status === "failed" ? "bg-red-50 text-red-700 ring-red-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
            {t(status === "ready" ? "Ready" : status === "draft" ? "Draft" : status === "failed" ? "Failed" : status)}
          </span>
        )}
        <div className="ms-auto flex shrink-0 items-center gap-2">
          {saved && <span role="status" className="hidden text-sm text-emerald-700 sm:inline">{t("Saved.")}</span>}
          <button
            type="submit"
            form="model-form"
            disabled={busy || !model}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-amber px-3 text-sm sm:px-4 font-semibold text-brand-navy shadow-sm shadow-brand-amber/30 transition hover:bg-[#e8952a] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
            {/* Phones: "Save" fits beside the name; wider screens: "Save changes". */}
            <span className="sm:hidden">{busy ? t("Saving…") : t("Save")}</span>
            <span className="hidden sm:inline">{busy ? t("Saving…") : t("Save changes")}</span>
          </button>
        </div>
      </div>
      {(error ?? (supabaseConfigured() ? null : t("Supabase is not configured."))) && <p className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error ?? t("Supabase is not configured.")}</p>}
      {replaced && <p role="status" className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{t("New 3D file loaded. Save changes to put it on the listing.")}</p>}

      {model && !model.glb_url && (
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(18rem,24rem)_1fr]">
          {form}
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-gradient-to-b from-slate-50 to-slate-100 p-6 text-center text-sm text-slate-600">
            <Box className="size-8 text-slate-300" aria-hidden />
            {t("No 3D model: it is listed with its photos only and can't be placed in the plan builder.")}
          </div>
        </div>
      )}
      {model?.glb_url && (
        // The preview follows the fields as they are typed (the saved size until they form a valid one).
        <ModelViewer
          key={fileKey}
          edit
          fill
          details={form}
          parts={replaced ? null : model.components}
          edits={replaced ? {} : model.material_edits}
          replay={Boolean(replaced) || !model.source_glb_url || model.source_glb_url === model.glb_url}
          onApi={(api) => { editor.current = api; }}
          url={replaced ?? model.glb_url}
          woodVendor={vendor?.platform ? null : vendor?.id}
          woodModel={model.id}
          // Other shapes for a part, offered to customers (saved in the part list with the model).
          onUploadVariant={vendor ? (file) => uploadPublicFile(vendor.id, file, `${model.id}/part-variants`) : undefined}
          resetView={resetView}
          autoRotate={spin}
          dimensions={
            catalogDimensions({ width_m: numberOrNull(width), height_m: numberOrNull(height), depth_m: numberOrNull(depth), shape, length2_m: numberOrNull(length2) }) ??
            catalogDimensions(model)
          }
          overlay={
            <>
              {size.every((x) => x != null && x > 0) && (
                <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                  <span className="rounded-full border border-white/70 bg-white/90 px-2.5 py-0.5 text-[11px] font-medium tabular-nums sm:px-3 sm:py-1 sm:text-xs text-brand-navy shadow-sm backdrop-blur">
                    {size.map((x) => x!.toFixed(2)).join(" × ")} m
                  </span>
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
                <div className="pointer-events-auto flex max-w-full items-center justify-center gap-0.5 rounded-full border border-white/70 bg-white/90 p-1 text-xs font-medium text-slate-600 shadow-lg shadow-slate-900/5 backdrop-blur">
                  <a href={model.glb_url} target="_blank" rel="noreferrer" className={tool} title={t("Download GLB")} aria-label={t("Download GLB")}>
                    <Download className="size-4 sm:size-3.5" aria-hidden /> <span className={label}>{t("Download GLB")}</span>
                  </a>
                  {model.source_glb_url && model.source_glb_url !== model.glb_url && (
                    <a href={model.source_glb_url} target="_blank" rel="noreferrer" className={tool} title={t("Original GLB")} aria-label={t("Original GLB")}>
                      <FileBox className="size-4 sm:size-3.5" aria-hidden /> <span className={label}>{t("Original GLB")}</span>
                    </a>
                  )}
                  {vendor && (
                    <ReplaceGlb
                      upload={(file) => uploadPublicFile(vendor.id, file, `${model.id}/model`)}
                      onReplaced={(url) => { setReplaced(url); setFileKey((k) => k + 1); editor.current = null; setSaved(false); setError(null); }}
                      onError={setError}
                      label={false}
                      className={tool}
                    />
                  )}
                  <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
                  <button type="button" onClick={() => setResetView((n) => n + 1)} className={tool} title={t("Reset view")} aria-label={t("Reset view")}>
                    <Focus className="size-4 sm:size-3.5" aria-hidden /> <span className={label}>{t("Reset view")}</span>
                  </button>
                  <button type="button" aria-pressed={spin} onClick={() => setSpin((on) => !on)} className={`${tool} ${spin ? "bg-brand-amber-soft text-brand-navy" : ""}`} title={t("Auto-rotate")} aria-label={t("Auto-rotate")}>
                    <RotateCw className="size-4 sm:size-3.5" aria-hidden /> <span className={label}>{t("Auto-rotate")}</span>
                  </button>
                </div>
              </div>
            </>
          }
        />
      )}
    </div>
  );
}

/** A collapsible form section (native <details>: keyboard and screen readers work as is). */
function Card({ title, icon, children, defaultOpen = true }: { title: string; icon: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-semibold text-brand-navy [&::-webkit-details-marker]:hidden">
        <span className="flex size-7 items-center justify-center rounded-lg bg-brand-amber-soft text-brand-navy">{icon}</span>
        <span className="flex-1">{title}</span>
        <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-slate-100 px-5 pb-5 pt-4">{children}</div>
    </details>
  );
}
