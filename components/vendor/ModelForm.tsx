"use client";

import { authSession } from "@/lib/auth/client";
import { useLocale, useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/shatably/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { on } from "@/lib/events";
import { fetchGenerationQuota, generateFromPhoto, type PhotoReading } from "@/lib/vendor/generate";
import { glbSize } from "@/lib/vendor/glbSize";
import { uploadPublicFile } from "@/lib/vendor/storage";
import type { ModelProvider, ModelSource, VendorProfile } from "@/lib/vendor/types";
import { Dimensions, numberOrNull } from "./Dimensions";
import { PriceField, priceOrNull } from "./PriceField";
import { ImagePicker } from "./ImagePicker";
import { VariantsEditor } from "./VariantsEditor";
import { CategoryPicker } from "./CategoryPicker";
import { WoodsField } from "./WoodsField";
import { ShapeField, type ModelShape } from "./ShapeField";
import { categoryLabel, categoryOf, type ModelCategory } from "@/lib/plan/categories";
import type { PriceUnit } from "@/lib/vendor/types";
import { RichText } from "./RichText";
import { ModelViewer } from "./ModelViewer";
import { customizedModelFields, updateModel, type ModelValidation, type PartDocument, type PartEditorApi } from "@/lib/vendor/parts";

/**
 * cacheComponents keeps this route alive but hidden (React Activity) after leaving it, so coming back would show the
 * last model's review. Hiding runs effect cleanups: bump the key there so every visit starts a blank form.
 */
export function ModelForm() {
  const [visit, setVisit] = useState(0);
  useEffect(() => () => setVisit((n) => n + 1), []);
  return <ModelFormBody key={visit} />;
}

function ModelFormBody() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  // Signed in without a vendor profile (a customer): the model is their own private one (supabase/user_models.sql),
  // used in their planner and the app's AR, never in the catalogue. null until the session is read.
  const [userId, setUserId] = useState<string | null>(null);
  const mine = Boolean(userId) && !vendor;
  const ownerId = vendor?.id ?? userId;
  const table = mine ? "user_models" : "models";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [width, setWidth] = useState("");
  const [price, setPrice] = useState("");
  const [priceUnit, setPriceUnit] = useState<PriceUnit>("item");
  const [category, setCategory] = useState<ModelCategory>("furniture");
  const [woods, setWoods] = useState<string[] | null>(null); // null: all the vendor works with
  // Furniture: what exactly it is ("corner sofa"), sent to the vision model and Meshy / Astra.
  const [kind, setKind] = useState("");
  const [shape, setShape] = useState<ModelShape>("straight");
  const [length2, setLength2] = useState("");
  const [height, setHeight] = useState("");
  const [depth, setDepth] = useState("");
  const [source, setSource] = useState<ModelSource>("photo");
  // The generator is the admin's choice (admin portal); the backend uses it whatever is sent. Known from the quota.
  const [provider, setProvider] = useState<ModelProvider>("meshy");
  const [photo, setPhoto] = useState<File | null>(null);
  const [glb, setGlb] = useState<File | null>(null);
  // The size read from the chosen GLB (glTF is in metres), shown under the file input.
  const [glbMeasured, setGlbMeasured] = useState<string | null>(null);
  const chooseGlb = async (file: File | null) => {
    setGlb(file);
    setGlbMeasured(null);
    const size = file ? await glbSize(file) : null;
    if (!size) return;
    const cm = (v: number) => String(Math.round(v * 100) / 100); // to the centimetre
    setWidth(cm(size.width));
    setHeight(cm(size.height));
    setDepth(cm(size.depth));
    setGlbMeasured([size.width, size.height, size.depth].map(cm).join(" × "));
  };
  const [variants, setVariants] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [quota, setQuota] = useState<Record<ModelProvider, number> | null>(null);
  /** The generated model awaiting the vendor's check (saved as a draft): its id and 3D file. */
  const [review, setReview] = useState<{ id: string; glbUrl: string; sourceGlbUrl: string | null; components: PartDocument | null } | null>(null);
  const editor = useRef<PartEditorApi | null>(null);
  const refreshQuota = () =>
    void fetchGenerationQuota().then((q) => {
      setQuota(q?.remaining ?? null);
      if (q) setProvider(q.provider);
    });
  useEffect(() => {
    const offStarted = on("generation.started", ({ provider, remaining }) => setQuota((q) => q && { ...q, [provider]: remaining }));
    const offFinished = on("generation.finished", ({ ok }) => !ok && refreshQuota()); // a failed call is refunded
    return () => {
      offStarted();
      offFinished();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        setUserId(data.session.user.id);
        refreshQuota();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The name / description the vendor left empty, from the photo's reading (the vision model reads it before
   * Meshy or Astra convert it), in the interface language: the reading's name (asked for in that language),
   * else the furniture type the vendor typed, else the model type's name; the description as one plain paragraph.
   */
  const listingFrom = (reading: PhotoReading | null) => {
    const listing: { title?: string; description?: string } = {};
    if (!title.trim()) {
      const named = reading?.name.trim() || (category === "furniture" ? kind.trim() : "") || t(categoryLabel(category));
      if (named) listing.title = named;
    }
    if (!description.replace(/<[^>]*>|&nbsp;/g, "").trim() && reading?.description.trim()) listing.description = `<p>${escapeHtml(reading.description.trim())}</p>`;
    return listing;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ownerId) return setError(t("Still loading your account. Try again in a moment."));
    setBusy(true);
    setError(null);
    setProgressLabel(null);
    setProgressPercent(0);
    let createdId: string | null = null;
    try {
      const row = await supabase()
        .from(table)
        .insert(mine ? {
          title: title || t("Untitled model"),
          description,
          width_m: numberOrNull(width),
          height_m: numberOrNull(height),
          depth_m: numberOrNull(depth),
          category,
          status: "generating",
        } : {
          vendor_id: ownerId,
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
          // Only a chosen few are stored ("All woods" is the column's null default).
          ...(woods !== null && category === "furniture" ? { woods } : {}),
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
      let components: PartDocument | null = null;
      let sourceGlbUrl: string | null = null;
      let estimated: PhotoReading | null = null;
      if (photo) {
        setProgressLabel(t("Uploading photo…"));
        setProgressPercent(6);
        sourceImageUrl = await uploadPublicFile(ownerId, photo, `${id}/photo`);
      }
      if (source === "upload") {
        if (!glb) throw new Error(t("Choose a GLB file."));
        setProgressLabel(t("Uploading GLB…"));
        setProgressPercent(20);
        glbUrl = await uploadPublicFile(ownerId, glb, `${id}/model`);
        setProgressPercent(100);
        setProgressLabel(t("Upload complete"));
      } else {
        if (!photo) throw new Error(t("Choose a photo to generate from."));
        if (quota && quota[provider] <= 0) throw new Error(t("No 3D generations left on this account."));
        ({ glbUrl, reading: estimated, components, sourceGlbUrl } = await generateFromPhoto(
          photo,
          provider,
          id,
          ({ percent, status }) => {
            setProgressPercent(percent);
            setProgressLabel(status);
          },
          sourceImageUrl ?? undefined,
          { category, title, kind: category === "furniture" ? kind.trim() : undefined, lang: locale === "ar" ? "ar" : "en" },
        ));
      }

      const variantUrls: { model_id: string; image_url: string; sort_order: number }[] = [];
      for (const [index, file] of (mine ? [] : variants).entries()) {
        setProgressLabel(t("Uploading variant images…"));
        setProgressPercent(Math.min(99, 90 + Math.round(((index + 1) / variants.length) * 8)));
        const url = await uploadPublicFile(ownerId, file, `${id}/variants`);
        variantUrls.push({ model_id: id, image_url: url, sort_order: index });
      }
      if (variantUrls.length) {
        const inserted = await supabase().from("model_variants").insert(variantUrls);
        if (inserted.error) throw new Error(inserted.error.message);
      }

      // Kept as a draft (not in the catalogue) until the vendor confirms the details below: the 3D file and
      // photo are saved now, so leaving the page loses nothing.
      const draft = await supabase().from(table).update({ status: "draft", glb_url: glbUrl, source_image_url: sourceImageUrl, components, source_glb_url: sourceGlbUrl, error: null }).eq("id", id);
      if (draft.error) throw new Error(draft.error.message);
      // Fields left empty: what the vision model read from the photo. The vendor checks and corrects them.
      const listing = listingFrom(estimated);
      if (listing.title) setTitle(listing.title);
      if (listing.description) setDescription(listing.description);
      const m = (v: number | null | undefined) => (v == null ? "" : String(Math.round(v * 100) / 100));
      if (!numberOrNull(width)) setWidth(m(estimated?.width_m));
      if (!numberOrNull(height)) setHeight(m(estimated?.height_m));
      if (!numberOrNull(depth)) setDepth(m(estimated?.depth_m));
      setReview({ id, glbUrl: glbUrl!, sourceGlbUrl, components });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (createdId) {
        await supabase().from(table).update({ status: "failed", error: message }).eq("id", createdId);
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  /** Save after the review: the confirmed name, description and sizes; the 3D model is the one generated. */
  const saveReviewed = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const materials = editor.current && ownerId ? await customizedModelFields(ownerId, review.id, review.glbUrl, review.sourceGlbUrl, editor.current) : null;
      const fields = {
        status: "ready",
        title: title.trim() || t("Untitled model"),
        description,
        width_m: numberOrNull(width),
        height_m: numberOrNull(height),
        depth_m: numberOrNull(depth),
        ...(materials?.fields ?? {}),
      };
      const updated = mine ? await supabase().from("user_models").update(fields).eq("id", review.id) : await updateModel(review.id, fields);
      if (updated.error) throw new Error(updated.error.message);
      if (materials?.thumbnailError) {
        setError(t("Saved, but the model image could not be updated ({error}). The previous image is kept; save again to retry.", { error: materials.thumbnailError }));
        return;
      }
      router.push(mine ? "/plan" : "/vendor"); // a private model is placed from the planner's "My models"
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  if (review) {
    const [w, h, d] = [numberOrNull(width), numberOrNull(height), numberOrNull(depth)];
    return (
      <div className="min-h-full bg-slate-50 text-slate-900">
        <Header vendor={vendor} />
        <main className="mx-auto max-w-6xl px-4 py-8">
          <h1 className="font-serif text-3xl">{t("Review the model")}</h1>
          <p className="mt-2 text-sm text-slate-600">{t("Check the name, description and size written from the photo and correct anything, then save. The 3D model stays as generated.")}</p>
          <form onSubmit={saveReviewed} className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {/* The generated model at the size in the fields below: a correction shows here at once. */}
            <ValidationNotice validation={review.components?.validation} />
            <ModelViewer edit parts={review.components} onApi={(api) => { editor.current = api; }} url={review.glbUrl} dimensions={w && h ? { width: w, height: h, ...(d ? { depth: d } : {}) } : null} />
            <div className="space-y-1.5">
              <Label htmlFor="review-title">{t("Name")}</Label>
              <Input id="review-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Description")}</Label>
              <RichText value={description} onChange={setDescription} />
            </div>
            <Dimensions width={width} height={height} depth={depth} onWidth={setWidth} onHeight={setHeight} onDepth={setDepth} labels={shape === "straight" ? undefined : ["Length on wall A m", "Height m", "Arm depth m"]} />
            {error && <p className="text-sm text-red-700">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? t("Saving…") : t("Save model")}
            </Button>
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="font-serif text-3xl">{mine ? t("Add my model") : t("Add a model")}</h1>
        {mine && <p className="mt-1 text-sm text-slate-500">{t("A private 3D model of your own furniture, for your plans and the app's AR. Only you see it; it is not listed in the catalogue.")}</p>}
        <form onSubmit={submit} className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-1.5">
            <Label htmlFor="title">{t("Name")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required={source !== "photo"}
              placeholder={source === "photo" ? t("Optional: named from the photo") : undefined}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("Description")}</Label>
            <RichText value={description} onChange={setDescription} />
            {source === "photo" && <p className="text-xs text-slate-500">{t("Optional: written from the photo when left empty.")}</p>}
          </div>
          <ShapeField shape={shape} onShape={setShape} length2={length2} onLength2={setLength2} />
          <Dimensions width={width} height={height} depth={depth} onWidth={setWidth} onHeight={setHeight} onDepth={setDepth} labels={shape === "straight" ? undefined : ["Length on wall A m", "Height m", "Arm depth m"]} required={source !== "photo"} />
          {source === "photo" && <p className="-mt-2 text-xs text-slate-500">{t("Optional: sizes left empty are estimated from the photo.")}</p>}
          <CategoryPicker value={category} onChange={setCategory} />
          {/* Sha2ty's models (admins) come in every wood: the customer picks one when customising. */}
          {category === "furniture" && vendor && !vendor.platform && <WoodsField vendorId={vendor?.id} platform={vendor?.platform} value={woods} onChange={setWoods} />}
          {category === "furniture" && source === "photo" && (
            <div className="space-y-1.5">
              <Label htmlFor="kind">{t("Furniture type")}</Label>
              <Input id="kind" value={kind} onChange={(event) => setKind(event.target.value)} placeholder={t("e.g. corner sofa, bunk bed, armchair")} maxLength={60} required />
            </div>
          )}
          {!mine && <PriceField price={price} unit={priceUnit} onPrice={setPrice} onUnit={setPriceUnit} />}
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
              {quota && <p className="text-xs text-slate-500">{t("3D generations left")} <TriesLeft n={quota[provider]} /></p>}
              {/* Upload, drag and drop, or paste a copied image (button or Ctrl/⌘+V). */}
              <ImagePicker variant="dropzone" label={t("Photo")} value={photo} onChange={setPhoto} />
            </>
          )}
          {source === "upload" && (
            <div className="space-y-1.5">
              <Label htmlFor="glb">{t("GLB file")}</Label>
              <Input id="glb" type="file" accept=".glb,model/gltf-binary" onChange={(event) => void chooseGlb(event.target.files?.[0] ?? null)} required />
              {glbMeasured && <p className="text-xs text-slate-500">{t("Size measured from the file: {size} m. Change it below if the model was not made at real size.", { size: glbMeasured })}</p>}
            </div>
          )}
          {!mine && <VariantsEditor kind="model" pending={variants} onPending={setVariants} />}
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
          <Button type="submit" disabled={busy || !ownerId}>
            {busy ? (progressLabel ?? t("Saving…")) : t(source === "photo" ? "Generate 3D model" : "Continue")}
          </Button>
        </form>
      </main>
    </div>
  );
}


/** "12 tries left" next to a generator (red when none are left). */
function TriesLeft({ n }: { n: number | undefined }) {
  const t = useT();
  if (n == null) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${n > 0 ? "bg-slate-100 text-slate-600" : "bg-red-50 text-red-700"}`}>
      {n > 0 ? t("{n} tries left", { n }) : t("No tries left")}
    </span>
  );
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The generated model's check: problems are shown before saving, never hidden behind a success. */
function ValidationNotice({ validation }: { validation?: ModelValidation }) {
  const t = useT();
  if (!validation || (validation.ok && !validation.warnings.length)) return null;
  const bad = !validation.ok;
  return (
    <div role={bad ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${bad ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      <p className="font-semibold">{bad ? t("This model has problems. Check it closely, or generate it again from a clearer photo.") : t("Worth a check before saving:")}</p>
      <ul className="mt-1 list-disc ps-5">
        {[...validation.errors, ...validation.warnings].map((line) => (
          <li key={line}>
            <bdi>{line}</bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}
