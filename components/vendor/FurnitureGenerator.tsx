"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Armchair, ArrowLeft, BedDouble, Check, ImageOff, Loader2, RefreshCw, Sofa, Sparkles, Utensils, X } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { API } from "@/lib/plan/api";
import { catalogDimensions } from "@/lib/plan/modelNormalization";
import { supabase } from "@/lib/supabase/client";
import { buildFurniture, furnitureParts, partOf, partOptions, type FurnitureKind, type FurnitureSpec } from "@/lib/vendor/furnitureBuilder";
import { furnitureGlb, renderFurniture } from "@/lib/vendor/furnitureRender";
import { updateModel, type PartDocument, type PartEditorApi, type PartVariant } from "@/lib/vendor/parts";
import { uploadPublicFile } from "@/lib/vendor/storage";

const ModelViewer = dynamic(() => import("./ModelViewer").then((mod) => mod.ModelViewer), { ssr: false, loading: () => <div className="h-[420px] rounded-2xl bg-slate-100" /> });

const KINDS: { id: FurnitureKind; label: string; icon: typeof Sofa }[] = [
  { id: "bed", label: "Bed", icon: BedDouble },
  { id: "sofa", label: "Sofa", icon: Sofa },
  { id: "chair", label: "Chair", icon: Armchair },
  { id: "dining_table", label: "Dining table", icon: Utensils },
];

// The photo shots, in the backend's order (services/furniture_design.py SHOTS).
const SHOTS = ["Studio", "Front view", "In a room", "Detail"];

type Option = { id: string; name: string; spec: FurnitureSpec; glb: Blob; url: string };
/** The model, its render, and each part's variants as local files (uploaded only on confirm). */
type Built = { glb: Blob; url: string; render: Blob; renderUrl: string; options: Record<string, Option[]>; parts: PartDocument };

async function backend(path: string, init: RequestInit) {
  const res = await fetch(`${API}/api/vendor/furniture/${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${res.status}).`);
  return body;
}

async function build(spec: FurnitureSpec): Promise<Built> {
  const group = buildFurniture(spec);
  const [glb, render] = await Promise.all([furnitureGlb(group), renderFurniture(group)]);
  const options: Record<string, Option[]> = {};
  for (const [part, list] of Object.entries(partOptions(spec))) {
    options[part] = await Promise.all(list.map(async (option) => {
      const file = await furnitureGlb(partOf(option.spec, part));
      return { ...option, id: crypto.randomUUID(), glb: file, url: URL.createObjectURL(file) };
    }));
  }
  // The viewer offers these in place of each part, as customers will see them.
  const parts = furnitureParts(spec.kind);
  for (const part of parts.components) part.variants = (options[part.name] ?? []).map(({ id, name, url }) => ({ id, name, glb_url: url }));
  return { glb, url: URL.createObjectURL(glb), render, renderUrl: URL.createObjectURL(render), options, parts };
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const metres = (v: number) => String(Math.round(v * 100) / 100);

/** Admin "Generate furniture" (signed in as the Sha2ty vendor): pick a type, GPT Sol designs a random piece, it is built
 * here as a modular model (one named mesh per part) with product photos made from its render. Nothing is saved until
 * the admin confirms; then it is a Sha2ty listing, opened in the model editor (materials, part variants). */
export function FurnitureGenerator() {
  const t = useT();
  const router = useRouter();
  const [kind, setKind] = useState<FurnitureKind>("bed");
  const [spec, setSpec] = useState<FurnitureSpec | null>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [photos, setPhotos] = useState<(string | null)[]>([]); // data: URLs, one slot per shot (hero, front, room, detail)
  const [shooting, setShooting] = useState<number[]>([]); // the shots being made now (the rest of the page stays usable)
  const [stale, setStale] = useState(false); // the photos show an earlier size
  const [zoom, setZoom] = useState<string | null>(null);
  const [busy, setBusy] = useState<"design" | "size" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [size, setSize] = useState({ width: "", height: "", depth: "" });
  const [dropped, setDropped] = useState<Set<string>>(new Set()); // part variants the admin removed ("part/name")
  const [chosen, setChosen] = useState<Record<string, string>>({}); // part id → the variant shown in the preview
  const editor = useRef<PartEditorApi | null>(null);

  // A generated design is lost on leaving the page (it is saved only on confirm): the browser asks first.
  useEffect(() => {
    if (!spec || busy === "save") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [spec, busy]);

  useEffect(() => () => {
    if (!built) return;
    for (const url of [built.url, built.renderUrl, ...Object.values(built.options).flat().map((o) => o.url)]) URL.revokeObjectURL(url);
  }, [built]);

  const run = async (what: NonNullable<typeof busy>, work: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  /** Product photos from the render: every shot, or only `which` (its slot is replaced). */
  const makePhotos = async (render: Blob, of: FurnitureSpec, name: string, which?: number) => {
    const slots = which === undefined ? [0, 1, 2, 3] : [which];
    setShooting((was) => [...was, ...slots]);
    setError(null);
    try {
      const form = new FormData();
      form.append("render", new File([render], "render.png", { type: "image/png" }));
      form.append("kind", of.kind);
      form.append("title", name);
      form.append("style", of.style);
      form.append("looks", JSON.stringify(of.looks));
      if (which !== undefined) form.append("which", String(which));
      const body = await backend("photos", { method: "POST", body: form });
      const made = body.images as Record<string, string>;
      setPhotos((was) => {
        const next = which === undefined ? Array<string | null>(body.shots as number).fill(null) : [...was];
        for (const [i, b64] of Object.entries(made)) next[Number(i)] = `data:image/png;base64,${b64}`;
        return next;
      });
      if (which === undefined) setStale(false);
      if ((body.errors as string[]).length) setError(t("Some photos could not be made: {error}", { error: (body.errors as string[])[0] }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setShooting((was) => was.filter((i) => !slots.includes(i)));
    }
  };

  /** The look photos are made from: the preview as shown (variants picked there), or the generated model. */
  const reference = async () => (Object.keys(chosen).length && editor.current ? await editor.current.thumbnail().catch(() => null) : null) ?? built!.render;

  const edited = spec !== null && (title !== spec.title || description !== spec.description);
  const generate = async (type: FurnitureKind = kind) => {
    if (edited && !window.confirm(t("Generate a new design? Your changes to the name and description are lost."))) return;
    let next: { spec: FurnitureSpec; built: Built } | null = null;
    await run("design", async () => {
      const designed = (await backend("design", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: type }) })) as FurnitureSpec;
      next = { spec: designed, built: await build(designed) };
      setSpec(designed);
      setBuilt(next.built);
      setPhotos([]);
      setDropped(new Set());
      setChosen({});
      editor.current = null;
      setTitle(designed.title);
      setDescription(designed.description);
      setSize({ width: metres(designed.width_m), height: metres(designed.height_m), depth: metres(designed.depth_m) });
    });
    const made = next as { spec: FurnitureSpec; built: Built } | null;
    if (made) await makePhotos(made.built.render, made.spec, made.spec.title);
  };

  /** A new size rebuilds the model at it (its parts keep their own sizes: legs, rails, cushions). */
  const resize = () => {
    if (!spec) return;
    const [w, h, d] = [size.width, size.height, size.depth].map(Number);
    if (![w, h, d].every((v) => v > 0 && v < 5)) return setError(t("Sizes must be between 0 and 5 m."));
    if (w === spec.width_m && h === spec.height_m && d === spec.depth_m) return;
    void run("size", async () => {
      const next = { ...spec, width_m: w, height_m: h, depth_m: d };
      setBuilt(await build(next));
      setSpec(next);
      setChosen({}); // the preview reloads with the original parts
      editor.current = null;
      if (photos.some(Boolean)) setStale(true);
    });
  };

  const save = () =>
    run("save", async () => {
      if (!spec || !built) return;
      const { data } = await authSession();
      const owner = data.session?.user.id;
      if (!owner) throw new Error(t("Sign in again."));
      const row = await supabase()
        .from("models")
        .insert({
          vendor_id: owner, title: title.trim() || spec.title, description: `<p>${escapeHtml(description.trim())}</p>`,
          width_m: spec.width_m, height_m: spec.height_m, depth_m: spec.depth_m,
          category: spec.kind === "dining_table" ? "table" : "furniture", source: "upload", provider: "sol", status: "generating",
        })
        .select("id")
        .single();
      if (row.error || !row.data) throw new Error(row.error?.message ?? t("Could not save the model."));
      const id = row.data.id as string;
      try {
        // As shown in the preview: the variants picked there (and any material changed) are in the model's file.
        const api = editor.current;
        const shown = api && (Object.keys(chosen).length || api.dirty()) ? await api.exportGlb() : null;
        const glbUrl = await uploadPublicFile(owner, new File([shown ?? built.glb], `${spec.kind}.glb`, { type: "model/gltf-binary" }), `${id}/model`);
        const urls: string[] = [];
        for (const photo of photos.filter((p): p is string => Boolean(p))) urls.push(await uploadPublicFile(owner, new File([await (await fetch(photo)).blob()], "photo.png", { type: "image/png" }), `${id}/variants`));
        if (urls.length) {
          const inserted = await supabase().from("model_variants").insert(urls.map((image_url, sort_order) => ({ model_id: id, image_url, sort_order })));
          if (inserted.error) throw new Error(inserted.error.message);
        }
        // Each part's variants: that part rebuilt with another shape (or finish), at this size, as its own file. A part
        // shown as one of its variants keeps that as its own shape, and its original shape becomes a variant.
        const components = furnitureParts(spec.kind);
        for (const part of components.components) {
          const variants: PartVariant[] = [];
          const upload = async (glb: Blob, name: string, variantId: string) =>
            variants.push({ id: variantId, name, glb_url: await uploadPublicFile(owner, new File([glb], `${part.id}.glb`, { type: "model/gltf-binary" }), `${id}/part-variants`) });
          if (chosen[part.id]) await upload(await furnitureGlb(partOf(spec, part.name)), "Original design", crypto.randomUUID());
          for (const option of built.options[part.name] ?? []) {
            if (option.id !== chosen[part.id] && !dropped.has(`${part.name}/${option.name}`)) await upload(option.glb, option.name, option.id);
          }
          if (variants.length) part.variants = variants;
        }
        // The listing's picture: the hero photo, or the model's render without photos.
        const thumbnail = urls[0] ?? (await uploadPublicFile(owner, new File([built.render], "thumbnail.png", { type: "image/png" }), `${id}/thumbnail`));
        const done = await updateModel(id, { status: "ready", glb_url: glbUrl, components, source_image_url: urls[0] ?? thumbnail, thumbnail_url: thumbnail, error: null });
        if (done.error) throw new Error(done.error.message);
      } catch (caught) {
        await supabase().from("models").update({ status: "failed", error: caught instanceof Error ? caught.message : String(caught) }).eq("id", id);
        throw caught;
      }
      router.push(`/vendor/models/${id}`); // materials, part names and part variants are edited there
    });

  const dims = spec ? catalogDimensions({ width_m: spec.width_m, height_m: spec.height_m, depth_m: spec.depth_m }) : null;
  return (
    <div className="min-h-dvh bg-slate-50">
      <Header />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/vendor" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-navy">
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t("Models")}
          </Link>
          <h1 className="text-xl font-semibold text-brand-navy">{t("Generate furniture")}</h1>
        </div>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-600">{t("Choose a type. GPT Sol designs a new piece with its parts, sizes, Arabic name and product photos. Nothing is saved until you confirm.")}</p>
          <div role="radiogroup" aria-label={t("Furniture type")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KINDS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="radio" aria-checked={kind === id} disabled={busy !== null} onClick={() => setKind(id)}
                className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-sm font-semibold transition disabled:opacity-60 ${kind === id ? "border-brand-amber bg-amber-50/60 text-brand-navy ring-2 ring-brand-amber/30" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                <Icon className="size-7" aria-hidden /> {t(label)}
              </button>
            ))}
          </div>
          <button type="button" disabled={busy !== null} onClick={() => void generate()} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-amber px-5 text-sm font-semibold text-brand-navy shadow-sm disabled:opacity-60">
            {busy === "design" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {busy === "design" ? t("Designing with GPT Sol…") : spec ? t("Generate another") : t("Generate furniture")}
          </button>
          {error && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}
        </section>

        {spec && built && (
          // Select a part to see its variants and switch between them (as customers will); the one shown on confirm
          // becomes the part's own shape. Materials can be changed here too.
          <section className="space-y-2">
            <p className="text-sm text-slate-600">{t("Select a part to see its variants and switch between them. The variant shown when you confirm becomes that part's default.")}</p>
            <ModelViewer
              key={built.url}
              edit
              url={built.url}
              parts={built.parts}
              edits={{}}
              replay
              dimensions={dims}
              removedParts={[]}
              onApi={(api) => { editor.current = api; }}
              onVariantChange={(next) => { setChosen(next); if (photos.some(Boolean)) setStale(true); }}
            />
          </section>
        )}
        {spec && built && (
          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <section className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-brand-navy">{t("Parts and their variants")}</p>
                <p className="mt-0.5 text-xs text-slate-500">{t("Customers can swap each part for one of its variants in the 3D builder. Remove the ones you don't want.")} <span dir="ltr">({spec.style})</span></p>
                <ul className="mt-3 space-y-2">
                  {Object.entries(partOptions(spec)).map(([part, list]) => (
                    <li key={part} className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="me-1 font-semibold text-slate-700" dir="ltr">{part}</span>
                      {list.map(({ name }) => {
                        const key = `${part}/${name}`;
                        const off = dropped.has(key);
                        return (
                          <button key={key} type="button" aria-pressed={!off} disabled={busy === "save"}
                            onClick={() => setDropped((was) => { const next = new Set(was); if (off) next.delete(key); else next.add(key); return next; })}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${off ? "border-dashed border-slate-300 text-slate-400 line-through" : "border-brand-amber/50 bg-amber-50 text-brand-navy"}`}>
                            <span dir="ltr">{name}</span> {off ? null : <X className="size-3" aria-hidden />}
                          </button>
                        );
                      })}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-brand-navy">{t("Product photos")}</p>
                  <button type="button" disabled={busy !== null || shooting.length > 0} onClick={async () => void makePhotos(await reference(), spec, title)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-brand-navy disabled:opacity-60">
                    {shooting.length ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />} {shooting.length ? t("Making photos…") : t("Regenerate all photos")}
                  </button>
                </div>
                {stale && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{t("The photos show an earlier version of the model. Regenerate them to match.")}</p>}
                {shooting.length > 0 && <p className="mb-2 text-xs text-slate-500">{t("GPT Sol is photographing the model in high quality (1–3 minutes)…")}</p>}
                {photos.length || shooting.length ? (
                  <div className="grid grid-cols-2 gap-2">
                    {SHOTS.map((label, i) => {
                      const src = photos[i];
                      const making = shooting.includes(i);
                      return (
                        <figure key={label} className="relative overflow-hidden rounded-lg border bg-slate-50">
                          {making ? (
                            <div className="flex aspect-square w-full animate-pulse items-center justify-center text-slate-300"><Loader2 className="size-6 animate-spin" aria-hidden /></div>
                          ) : src ? (
                            <button type="button" onClick={() => setZoom(src)} aria-label={t("View larger")} className="block w-full">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt={t(label)} className="aspect-square w-full object-cover" />
                            </button>
                          ) : (
                            <div className="flex aspect-square w-full items-center justify-center text-slate-300"><ImageOff className="size-6" aria-hidden /></div>
                          )}
                          <figcaption className="flex items-center gap-1 border-t bg-white px-2 py-1 text-[11px] text-slate-600">
                            <span className="me-auto truncate">{t(label)}{i === 0 && src ? ` · ${t("Main photo")}` : ""}</span>
                            <button type="button" disabled={making || busy === "save"} onClick={async () => void makePhotos(await reference(), spec, title, i)} aria-label={t("Regenerate this photo")} title={t("Regenerate this photo")} className="flex size-7 items-center justify-center rounded-md hover:bg-slate-100 disabled:opacity-40">
                              <RefreshCw className="size-3.5" aria-hidden />
                            </button>
                            {src && (
                              <button type="button" disabled={busy === "save"} onClick={() => setPhotos(photos.map((p, j) => (j === i ? null : p)))} aria-label={t("Remove")} title={t("Remove")} className="flex size-7 items-center justify-center rounded-md hover:bg-red-50 hover:text-red-600">
                                <X className="size-3.5" aria-hidden />
                              </button>
                            )}
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-slate-500"><ImageOff className="size-4" aria-hidden /> {t("No photos: the listing uses the model's render.")}</p>
                )}
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="space-y-1.5">
                <Label htmlFor="gen-title">{t("Model name")}</Label>
                <Input id="gen-title" dir="rtl" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gen-description">{t("Description")}</Label>
                <textarea id="gen-description" dir="rtl" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-amber" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">{t("Dimensions (m)")}</p>
                <div className="grid grid-cols-3 gap-2">
                  {(["width", "height", "depth"] as const).map((axis) => (
                    <label key={axis} className="space-y-1 text-xs text-slate-500">
                      {t(axis === "width" ? "Width" : axis === "height" ? "Height" : "Depth")}
                      <Input type="number" step="0.01" min="0.1" inputMode="decimal" value={size[axis]} onChange={(e) => setSize({ ...size, [axis]: e.target.value })} onBlur={resize} disabled={busy === "save"} />
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-500">{busy === "size" ? t("Rebuilding the model…") : t("The model is rebuilt at a new size (legs, rails and cushions keep theirs).")}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busy !== null || shooting.length > 0} onClick={() => void generate(spec.kind)} title={t("A new design of the same type")} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-brand-navy disabled:opacity-60">
                  {busy === "design" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />} {t("Regenerate")}
                </button>
                <button type="button" disabled={busy !== null || shooting.length > 0 || !title.trim()} onClick={() => void save()} className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-navy px-3 text-sm font-semibold text-white disabled:opacity-60">
                  {busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />} <span className="truncate">{busy === "save" ? t("Saving…") : t("Confirm and add to the catalogue")}</span>
                </button>
              </div>
              {shooting.length > 0 && <p className="text-xs text-slate-500">{t("Confirm is available once the photos are ready.")}</p>}
              <p className="text-xs leading-relaxed text-slate-500">{t("After saving, the model opens in the editor: change materials and add or remove variants for each part.")}</p>
            </section>
          </div>
        )}
      </main>
      <Dialog open={zoom !== null} onOpenChange={(open) => !open && setZoom(null)}>
        <DialogContent className="max-w-4xl p-2">
          <DialogTitle className="sr-only">{t("Product photos")}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {zoom && <img src={zoom} alt="" className="max-h-[80vh] w-full rounded-lg object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
