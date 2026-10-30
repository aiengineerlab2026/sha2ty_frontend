"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Header } from "@/components/shatably/Header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import type { CatalogModel, VendorProfile } from "@/lib/vendor/types";
import { Dimensions, metersToInput, numberOrNull } from "./Dimensions";
import { PriceField, priceOrNull } from "./PriceField";
import { CategoryPicker } from "./CategoryPicker";
import { VariantsEditor } from "./VariantsEditor";
import { ShapeField, type ModelShape } from "./ShapeField";
import { categoryOf, type ModelCategory } from "@/lib/plan/categories";
import type { PriceUnit } from "@/lib/vendor/types";
import { RichText } from "./RichText";
import { catalogDimensions } from "@/lib/plan/modelNormalization";

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
  const [description, setDescription] = useState("");
  const [width, setWidth] = useState("");
  const [price, setPrice] = useState("");
  const [priceUnit, setPriceUnit] = useState<PriceUnit>("item");
  const [category, setCategory] = useState<ModelCategory>("furniture");
  const [shape, setShape] = useState<ModelShape>("straight");
  const [length2, setLength2] = useState("");
  const [height, setHeight] = useState("");
  const [depth, setDepth] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured()) {
      setError(t("Supabase is not configured."));
      return;
    }
    void (async () => {
      const { data: session } = await supabase().auth.getSession();
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
        setDescription(next.description ?? "");
        setWidth(metersToInput(next.width_m));
        setHeight(metersToInput(next.height_m));
        setDepth(metersToInput(next.depth_m));
        setPrice(next.price == null ? "" : String(next.price));
        setPriceUnit(next.price_unit ?? "item");
        setCategory(categoryOf(next.category));
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
    const updated = await supabase()
      .from("models")
      .update({
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
      })
      .eq("id", model.id);
    setBusy(false);
    if (updated.error) {
      setError(updated.error.message);
      return;
    }
    setSaved(true);
  };

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link href="/vendor" className="text-sm text-slate-500 hover:text-slate-800">
              {t("← Models")}
            </Link>
            <h1 className="mt-2 font-serif text-3xl">{model?.title ?? t("Model")}</h1>
            {model?.status && (
              <p className="mt-1 text-sm capitalize text-slate-500">{model.status}</p>
            )}
          </div>
          {model?.glb_url && (
            <Button asChild variant="outline">
              <a href={model.glb_url} target="_blank" rel="noreferrer">
                {t("Download GLB")}
              </a>
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {model && (
          <form onSubmit={save} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-1.5">
              <Label>{t("Description")}</Label>
              <RichText key={model.id} value={description} onChange={setDescription} />
            </div>
            <ShapeField shape={shape} onShape={setShape} length2={length2} onLength2={setLength2} />
            <Dimensions width={width} height={height} depth={depth} onWidth={setWidth} onHeight={setHeight} onDepth={setDepth} labels={shape === "straight" ? undefined : ["Length on wall A m", "Height m", "Arm depth m"]} />
            <CategoryPicker value={category} onChange={setCategory} />
            {/* Changes to variants save immediately (add / remove one / remove all). */}
            {model && <VariantsEditor kind="model" itemId={model.id} vendorId={vendor?.id} />}
            <PriceField price={price} unit={priceUnit} onPrice={setPrice} onUnit={setPriceUnit} />
            <p className="text-xs text-slate-500">{t("Dimensions are stored in meters.")}</p>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? t("Saving…") : t("Save changes")}
              </Button>
              {saved && <p className="text-sm text-slate-600">{t("Saved.")}</p>}
            </div>
          </form>
        )}
        {model && !model.glb_url && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            {t("This model does not have a GLB yet. Generate or upload one first.")}
          </p>
        )}
        {model?.glb_url && <ModelViewer url={model.glb_url} dimensions={catalogDimensions(model)} />}
        {model?.glb_url && <p className="text-xs text-slate-500">{t("Drag to orbit, scroll to zoom, end-drag to pan.")}</p>}
      </main>
    </div>
  );
}
