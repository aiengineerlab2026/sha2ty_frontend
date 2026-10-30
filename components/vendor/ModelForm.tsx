"use client";

import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/shatably/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { generateFromPhoto } from "@/lib/vendor/generate";
import { uploadPublicFile } from "@/lib/vendor/storage";
import type { ModelProvider, ModelSource, VendorProfile } from "@/lib/vendor/types";
import { Dimensions, numberOrNull } from "./Dimensions";
import { PriceField, priceOrNull } from "./PriceField";
import { ImagePicker } from "./ImagePicker";
import { VariantsEditor } from "./VariantsEditor";
import { CategoryPicker } from "./CategoryPicker";
import { ShapeField, type ModelShape } from "./ShapeField";
import { categoryOf, type ModelCategory } from "@/lib/plan/categories";
import type { PriceUnit } from "@/lib/vendor/types";
import { RichText } from "./RichText";

export function ModelForm() {
  const t = useT();
  const router = useRouter();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [width, setWidth] = useState("");
  const [price, setPrice] = useState("");
  const [priceUnit, setPriceUnit] = useState<PriceUnit>("item");
  const [category, setCategory] = useState<ModelCategory>("furniture");
  const [shape, setShape] = useState<ModelShape>("straight");
  const [length2, setLength2] = useState("");
  const [height, setHeight] = useState("");
  const [depth, setDepth] = useState("");
  const [source, setSource] = useState<ModelSource>("photo");
  const [provider, setProvider] = useState<ModelProvider>("meshy");
  const [photo, setPhoto] = useState<File | null>(null);
  const [glb, setGlb] = useState<File | null>(null);
  const [variants, setVariants] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void authSession()
      .then(async ({ data }) => {
        if (!data.session) {
          window.location.href = "/vendor/login";
          return;
        }
        const profile = await supabase().from("vendors").select("*").eq("id", data.session.user.id).maybeSingle();
        setVendor(profile.data);
      });
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!vendor) return;
    setBusy(true);
    setError(null);
    setProgressLabel(null);
    setProgressPercent(0);
    let createdId: string | null = null;
    try {
      const row = await supabase()
        .from("models")
        .insert({
          vendor_id: vendor.id,
          title: title || t("Untitled model"),
          description,
          width_m: numberOrNull(width),
          height_m: numberOrNull(height),
          depth_m: numberOrNull(depth),
          price: priceOrNull(price),
          price_unit: priceUnit,
          category,
          shape,
          length2_m: shape === "straight" ? null : numberOrNull(length2),
          source,
          provider: source === "photo" ? provider : null,
          status: "generating",
        })
        .select("id")
        .single();
      if (row.error || !row.data) throw new Error(row.error?.message ?? t("Could not save the model."));
      const id = row.data.id as string;
      createdId = id;

      let sourceImageUrl: string | null = null;
      let glbUrl: string | null = null;
      if (photo) {
        setProgressLabel(t("Uploading photo…"));
        setProgressPercent(6);
        sourceImageUrl = await uploadPublicFile(vendor.id, photo, `${id}/photo`);
      }
      if (source === "upload") {
        if (!glb) throw new Error(t("Choose a GLB file."));
        setProgressLabel(t("Uploading GLB…"));
        setProgressPercent(20);
        glbUrl = await uploadPublicFile(vendor.id, glb, `${id}/model`);
        setProgressPercent(100);
        setProgressLabel(t("Upload complete"));
      } else {
        if (!photo) throw new Error(t("Choose a photo to generate from."));
        glbUrl = await generateFromPhoto(
          photo,
          provider,
          id,
          ({ percent, status }) => {
            setProgressPercent(percent);
            setProgressLabel(status);
          },
          sourceImageUrl ?? undefined,
          { category, title },
        );
      }

      const variantUrls: { model_id: string; image_url: string; sort_order: number }[] = [];
      for (const [index, file] of variants.entries()) {
        setProgressLabel(t("Uploading variant images…"));
        setProgressPercent(Math.min(99, 90 + Math.round(((index + 1) / variants.length) * 8)));
        const url = await uploadPublicFile(vendor.id, file, `${id}/variants`);
        variantUrls.push({ model_id: id, image_url: url, sort_order: index });
      }
      if (variantUrls.length) {
        const inserted = await supabase().from("model_variants").insert(variantUrls);
        if (inserted.error) throw new Error(inserted.error.message);
      }

      const updated = await supabase()
        .from("models")
        .update({
          status: "ready",
          glb_url: glbUrl,
          source_image_url: sourceImageUrl,
          error: null,
        })
        .eq("id", id);
      if (updated.error) throw new Error(updated.error.message);
      router.push("/vendor");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (createdId) {
        await supabase().from("models").update({ status: "failed", error: message }).eq("id", createdId);
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="font-serif text-3xl">{t("Add a model")}</h1>
        <form onSubmit={submit} className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-1.5">
            <Label htmlFor="title">{t("Name")}</Label>
            <Input id="title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>{t("Description")}</Label>
            <RichText value={description} onChange={setDescription} />
          </div>
          <ShapeField shape={shape} onShape={setShape} length2={length2} onLength2={setLength2} />
          <Dimensions width={width} height={height} depth={depth} onWidth={setWidth} onHeight={setHeight} onDepth={setDepth} labels={shape === "straight" ? undefined : ["Length on wall A m", "Height m", "Arm depth m"]} />
          <CategoryPicker value={category} onChange={setCategory} />
          <PriceField price={price} unit={priceUnit} onPrice={setPrice} onUnit={setPriceUnit} />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("Source")}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={source === "photo"} onChange={() => setSource("photo")} />
              {t("Upload a photo and generate 3D")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={source === "upload"} onChange={() => setSource("upload")} />
              {t("Upload an existing GLB")}
            </label>
          </fieldset>
          {source === "photo" && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("Generator")}</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={provider === "meshy"} onChange={() => setProvider("meshy")} />
                  {t("Meshy")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={provider === "astra"} onChange={() => setProvider("astra")} />
                  {t("GPT Astra")}
                </label>
              </fieldset>
              {/* Upload, drag and drop, or paste a copied image (button or Ctrl/⌘+V). */}
              <ImagePicker variant="dropzone" label={t("Photo")} value={photo} onChange={setPhoto} />
            </>
          )}
          {source === "upload" && (
            <div className="space-y-1.5">
              <Label htmlFor="glb">{t("GLB file")}</Label>
              <Input id="glb" type="file" accept=".glb,model/gltf-binary" onChange={(event) => setGlb(event.target.files?.[0] ?? null)} required />
            </div>
          )}
          <VariantsEditor kind="model" pending={variants} onPending={setVariants} />
          {busy && progressLabel && (
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <p className="text-slate-700">{progressLabel}</p>
                <p className="tabular-nums text-slate-500">{progressPercent}%</p>
              </div>
              <Progress value={progressPercent} className="h-2 bg-slate-200" />
            </div>
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? (progressLabel ?? t("Saving…")) : t("Save model")}
          </Button>
        </form>
      </main>
    </div>
  );
}

