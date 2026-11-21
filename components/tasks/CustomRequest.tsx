"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Box, ImagePlus, LoaderCircle, PencilRuler, Send, X } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { authSession } from "@/lib/auth/client";
import { customisedModels } from "@/lib/designs/api";
import { useLocale, useT } from "@/lib/i18n";
import { ModelViewer } from "@/components/vendor/ModelViewer";
import { generateFromPhoto } from "@/lib/vendor/generate";
import { FURNITURE_TYPES } from "@/lib/plan/categories";
import { createCustomRequest, type CustomBrief } from "@/lib/tasks";
import { uploadPublicFile } from "@/lib/vendor/storage";

const KINDS = [...FURNITURE_TYPES.map(({ id, label }) => ({ id, label })), { id: "other", label: "Other" }];
const MAX_IMAGES = 8;
const MAX_BYTES = 10 * 1024 * 1024;

type Field = "title" | "furniture_type" | "width" | "height" | "depth" | "quantity" | "material" | "location" | "budget" | "deadline" | "images";

/** "Request a custom piece": what to make, its size, materials, budget, where it goes and pictures, sent to every
 * approved vendor (POST /api/requests). A piece already designed in 3D is requested from its editor instead. */
export function CustomRequestForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<string | null>(null);
  const [designs, setDesigns] = useState<{ id: string; title: string; image: string | null }[]>([]);
  const [form, setForm] = useState(() => ({
    title: params.get("title") ?? "",
    furniture_type: KINDS.some((k) => k.id === params.get("type")) ? params.get("type")! : "",
    width: params.get("w") ?? "",
    height: params.get("h") ?? "",
    depth: params.get("d") ?? "",
    quantity: "1",
    material: "",
    finish: "",
    description: "",
    location: "",
    budget: "",
    deadline: "",
  }));
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const lang = useLocale();
  // The 3D model made from the first picture with the generator the admin chose (the backend picks it).
  const fileOf = useRef(new Map<string, File>());
  const [model, setModel] = useState<{ source: string; percent: number; glb?: string; failed?: string } | null>(null);
  const modelJob = useRef<{ source: string; done: Promise<string | null> } | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((now) => ({ ...now, ...patch }));

  useEffect(() => {
    void authSession().then(({ data }) => {
      if (!data.session) {
        router.replace(`/vendor/login?next=${encodeURIComponent(`/tasks/new${window.location.search}`)}`);
        return;
      }
      setMe(data.session.user.id);
      customisedModels().then(
        (list) => setDesigns(list.filter((d) => !d.draft).slice(0, 6).map((d) => ({ id: d.id, title: d.title || t("Untitled design"), image: d.current?.thumbnail_url || d.thumbnail_url || null }))),
        () => undefined,
      );
    });
  }, [router, t]);

  const addImages = async (files: FileList | File[] | null) => {
    if (!files || !me) return;
    const picked = [...files].slice(0, MAX_IMAGES - images.length);
    const bad = picked.find((f) => !f.type.startsWith("image/") || f.size > MAX_BYTES);
    if (bad) {
      setErrors((e) => ({ ...e, images: t("Pictures only (JPG, PNG or WebP), up to 10 MB each.") }));
      return;
    }
    setErrors((e) => ({ ...e, images: undefined }));
    setUploading((n) => n + picked.length);
    for (const file of picked) {
      try {
        const url = await uploadPublicFile(me, file, "requests");
        fileOf.current.set(url, file);
        setImages((now) => [...now, url]);
      } catch {
        setErrors((e) => ({ ...e, images: t("A picture could not be uploaded. Try again.") }));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  // A new first picture → a new 3D model from it; no pictures → none. The latest first picture wins.
  const first = images[0];
  useEffect(() => {
    const file = first ? fileOf.current.get(first) : undefined;
    if (!first || !file) {
      modelJob.current = null;
      setModel(null);
      return;
    }
    if (modelJob.current?.source === first) return;
    setModel({ source: first, percent: 2 });
    const kind = KINDS.find((k) => k.id === form.furniture_type);
    const done = generateFromPhoto(file, "meshy", crypto.randomUUID(), (p) => setModel((m) => (m?.source === first ? { ...m, percent: p.percent } : m)), first, {
      category: "furniture", title: form.title.trim(), kind: kind && kind.id !== "other" ? kind.label : undefined, lang,
    }).then(
      (r) => { setModel((m) => (m?.source === first ? { source: first, percent: 100, glb: r.glbUrl } : m)); return r.glbUrl; },
      (e: unknown) => { setModel((m) => (m?.source === first ? { source: first, percent: 0, failed: e instanceof Error ? e.message : String(e) } : m)); return null; },
    );
    modelJob.current = { source: first, done };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new first picture starts a model
  }, [first]);

  // Paste a screenshot or copied picture anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void addImages(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const check = (): Partial<Record<Field, string>> => {
    const found: Partial<Record<Field, string>> = {};
    if (form.title.trim().length < 2) found.title = t("Give the piece a short name, e.g. “Oak dining table”.");
    if (!form.furniture_type) found.furniture_type = t("Choose what kind of furniture it is.");
    for (const key of ["width", "height", "depth"] as const) {
      const n = Number(form[key]);
      if (!form[key] || !(n > 0) || n > 2000) found[key] = t("Enter a size in centimetres (1–2000).");
    }
    const q = Number(form.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 1000) found.quantity = t("Enter how many pieces (1–1000).");
    if (form.material.trim().length < 2) found.material = t("Say the main material, e.g. beech wood or MDF with veneer.");
    if (form.location.trim().length < 2) found.location = t("Enter the delivery area, e.g. Nasr City, Cairo.");
    if (form.budget && !(Number(form.budget) >= 0)) found.budget = t("Enter the budget as a number, or leave it empty.");
    if (form.deadline && form.deadline < new Date().toISOString().slice(0, 10)) found.deadline = t("Pick a date from today on.");
    return found;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = check();
    setErrors(found);
    setFailure(null);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`f-${first}`)?.focus();
      return;
    }
    setSending(true);
    try {
      // A model still being made is waited for; if it fails the request goes without one.
      const job = modelJob.current;
      const glb = job && job.source === images[0] ? await job.done : null;
      const brief: CustomBrief = {
        title: form.title.trim(),
        furniture_type: form.furniture_type,
        dimensions: { width: Number(form.width), height: Number(form.height), depth: Number(form.depth) },
        quantity: Number(form.quantity),
        material: form.material.trim(),
        finish: form.finish.trim(),
        description: form.description.trim(),
        location: form.location.trim(),
        budget_max: form.budget ? Number(form.budget) : null,
        deadline: form.deadline || null,
        images,
        glb_url: glb,
      };
      const task = await createCustomRequest(brief);
      router.push(`/tasks/${task.id}?sent=1`);
    } catch (caught) {
      setFailure(caught instanceof Error ? caught.message : String(caught));
      setSending(false);
    }
  };

  const input = (key: Field) =>
    `h-11 w-full rounded-xl border bg-white px-3 text-base outline-none transition focus:ring-2 sm:text-sm ${errors[key] ? "border-red-400 focus:ring-red-200" : "border-slate-200 focus:border-brand-amber focus:ring-brand-amber/20"}`;

  return (
    <div className="min-h-full bg-slate-50">
      <Header vendor={null} />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight text-brand-navy">{t("Request a custom piece")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {t("Describe the piece you want made. We send your request to the furniture makers on Sha2ty; they reply with a price, a timeline and any questions. You compare the offers and choose who makes it. Sending a request is free and commits you to nothing.")}
        </p>

        {designs.length > 0 && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-navy"><PencilRuler className="size-4 text-[#b8731d]" aria-hidden /> {t("Already designed it in 3D?")}</h2>
            <p className="mt-1 text-xs text-slate-500">{t("Open a saved design and press “Request implementation”: vendors then get its exact 3D model, sizes and materials.")}</p>
            <ul className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {designs.map((d) => (
                <li key={d.id} className="shrink-0">
                  <Link href={`/designs/${d.id}`} className="flex w-32 flex-col overflow-hidden rounded-xl border border-slate-200 text-xs hover:border-brand-amber">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {d.image ? <img src={d.image} alt="" className="aspect-square object-contain bg-slate-50" /> : <span className="aspect-square bg-slate-100" />}
                    <span className="truncate p-2 font-medium text-slate-700">{d.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <form onSubmit={submit} noValidate className="mt-6 space-y-6">
          <Group title={t("What should be made?")}>
            <Labelled id="f-title" label={t("Name of the piece")} error={errors.title}>
              <input id="f-title" value={form.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} placeholder={t("e.g. Oak dining table for 6")} className={input("title")} aria-invalid={Boolean(errors.title)} aria-describedby="e-title" />
            </Labelled>
            <Labelled id="f-furniture_type" label={t("Type")} error={errors.furniture_type}>
              <div id="f-furniture_type" tabIndex={-1} role="radiogroup" aria-describedby="e-furniture_type" className="flex flex-wrap gap-2">
                {KINDS.map((k) => (
                  <button key={k.id} type="button" role="radio" aria-checked={form.furniture_type === k.id} onClick={() => set({ furniture_type: k.id })} className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${form.furniture_type === k.id ? "bg-brand-navy text-white" : "border border-slate-200 bg-white text-slate-600 hover:text-brand-navy"}`}>
                    {t(k.label)}
                  </button>
                ))}
              </div>
            </Labelled>
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">{t("Size (cm)")}</p>
              <div className="grid grid-cols-3 gap-2">
                {(["width", "height", "depth"] as const).map((key) => (
                  <Labelled key={key} id={`f-${key}`} label={t(key === "width" ? "Width" : key === "height" ? "Height" : "Depth")} error={errors[key]} small>
                    <input id={`f-${key}`} inputMode="decimal" type="number" min={1} max={2000} value={form[key]} onChange={(e) => set({ [key]: e.target.value })} className={input(key)} aria-invalid={Boolean(errors[key])} aria-describedby={`e-${key}`} />
                  </Labelled>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">{t("Not sure? Give your best measurement; the vendor will confirm it with you.")}</p>
            </div>
            <Labelled id="f-quantity" label={t("How many pieces")} error={errors.quantity}>
              <input id="f-quantity" inputMode="numeric" type="number" min={1} max={1000} value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} className={`${input("quantity")} max-w-32`} aria-invalid={Boolean(errors.quantity)} aria-describedby="e-quantity" />
            </Labelled>
          </Group>

          <Group title={t("Materials")}>
            <Labelled id="f-material" label={t("Main material")} error={errors.material}>
              <input id="f-material" value={form.material} onChange={(e) => set({ material: e.target.value })} maxLength={200} placeholder={t("e.g. Beech wood, MDF with oak veneer")} className={input("material")} aria-invalid={Boolean(errors.material)} aria-describedby="e-material" />
            </Labelled>
            <Labelled id="f-finish" label={t("Finish or upholstery (optional)")}>
              <input id="f-finish" value={form.finish} onChange={(e) => set({ finish: e.target.value })} maxLength={200} placeholder={t("e.g. Walnut stain, matte · Grey linen fabric")} className={input("material").replace("border-red-400", "border-slate-200")} />
            </Labelled>
            <Labelled id="f-description" label={t("Anything else vendors should know (optional)")}>
              <textarea id="f-description" value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={4000} rows={4} placeholder={t("Style, colours, drawers or shelves, how it will be used…")} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-brand-amber focus:ring-2 focus:ring-brand-amber/20 sm:text-sm" />
            </Labelled>
          </Group>

          <Group title={t("Reference pictures (optional)")}>
            <p className="text-xs text-slate-500">{t("Photos of a piece you like, a sketch, or the place it will go. Up to 8. You can also paste a picture (Ctrl+V).")}</p>
            <div className="flex flex-wrap gap-3" id="f-images" tabIndex={-1}>
              {images.map((url) => (
                <span key={url} className="relative size-24 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="size-full object-cover" />
                  <button type="button" onClick={() => setImages((now) => now.filter((u) => u !== url))} aria-label={t("Remove picture")} className="absolute end-1 top-1 flex size-6 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow">
                    <X className="size-3.5" aria-hidden />
                  </button>
                </span>
              ))}
              {Array.from({ length: uploading }, (_, i) => (
                <span key={`u${i}`} className="flex size-24 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-slate-400"><LoaderCircle className="size-5 animate-spin" aria-label={t("Uploading…")} /></span>
              ))}
              {images.length + uploading < MAX_IMAGES && (
                <label className="flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white text-xs text-slate-500 hover:border-brand-amber hover:text-brand-navy">
                  <ImagePlus className="size-5" aria-hidden /> {t("Add pictures")}
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { void addImages(e.target.files); e.target.value = ""; }} />
                </label>
              )}
            </div>
            {errors.images && <p id="e-images" className="text-sm text-red-700">{errors.images}</p>}
            {model && (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" aria-live="polite">
                <p className="flex items-center gap-2 font-medium text-brand-navy">
                  {model.glb ? <Box className="size-4" aria-hidden /> : !model.failed && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                  {model.glb
                    ? t("3D model made from your first picture. Vendors will see it with your request.")
                    : model.failed
                      ? t("A 3D model could not be made from this picture. Your request is sent with the pictures only.")
                      : t("Making a 3D model from your first picture… {n}%", { n: Math.round(model.percent) })}
                </p>
                {model.glb && <ModelViewer url={model.glb} dimensions={Number(form.width) > 0 && Number(form.height) > 0 ? { width: Number(form.width) / 100, height: Number(form.height) / 100, ...(Number(form.depth) > 0 ? { depth: Number(form.depth) / 100 } : {}) } : null} />}
              </div>
            )}
          </Group>

          <Group title={t("Delivery and budget")}>
            <Labelled id="f-location" label={t("Delivery area")} error={errors.location}>
              <input id="f-location" value={form.location} onChange={(e) => set({ location: e.target.value })} maxLength={200} placeholder={t("e.g. Nasr City, Cairo")} autoComplete="address-level2" className={input("location")} aria-invalid={Boolean(errors.location)} aria-describedby="e-location" />
            </Labelled>
            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled id="f-budget" label={t("Budget up to (EGP, optional)")} error={errors.budget}>
                <input id="f-budget" inputMode="numeric" type="number" min={0} value={form.budget} onChange={(e) => set({ budget: e.target.value })} placeholder={t("Leave empty if open")} className={input("budget")} aria-invalid={Boolean(errors.budget)} aria-describedby="e-budget" />
              </Labelled>
              <Labelled id="f-deadline" label={t("Wanted by (optional)")} error={errors.deadline}>
                <input id="f-deadline" type="date" min={new Date().toISOString().slice(0, 10)} value={form.deadline} onChange={(e) => set({ deadline: e.target.value })} className={input("deadline")} aria-invalid={Boolean(errors.deadline)} aria-describedby="e-deadline" />
              </Labelled>
            </div>
          </Group>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <p className="font-semibold text-brand-navy">{t("What happens next")}</p>
            <ol className="mt-2 list-decimal space-y-1 ps-5">
              <li>{t("Your request goes to the furniture makers on Sha2ty.")}</li>
              <li>{t("They send offers with a price and a timeline, or ask you questions in the chat.")}</li>
              <li>{t("You compare the offers side by side and choose one vendor. Payment is agreed directly with them.")}</li>
            </ol>
          </div>

          {failure && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{failure}</p>}
          {Object.values(errors).some(Boolean) && <p role="alert" className="text-sm text-red-700">{t("Some details need fixing: see the notes in red above.")}</p>}
          <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            <button type="submit" disabled={sending || uploading > 0 || !me} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-amber px-6 text-base font-semibold text-brand-navy shadow-sm transition hover:bg-[#e8952a] disabled:opacity-60 sm:w-auto">
              {sending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Send className="size-4 rtl:-scale-x-100" aria-hidden />}
              {sending && model && !model.glb && !model.failed ? t("Finishing the 3D model… {n}%", { n: Math.round(model.percent) }) : sending ? t("Sending…") : uploading ? t("Uploading…") : t("Send request to vendors")}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <legend className="px-1 text-base font-semibold text-brand-navy">{title}</legend>
      {children}
    </fieldset>
  );
}

function Labelled({ id, label, error, small, children }: { id: string; label: string; error?: string; small?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`block font-medium text-slate-700 ${small ? "text-xs" : "text-sm"}`}>{label}</label>
      {children}
      {error && <p id={`e-${id.slice(2)}`} className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** A made-to-order request as vendors and the customer see it: type, size, materials and the reference pictures. */
export function BriefView({ brief, quantity }: { brief: NonNullable<import("@/lib/tasks").TaskRow["spec"]["brief"]>; quantity: number }) {
  const t = useT();
  const kind = KINDS.find((k) => k.id === brief.furniture_type)?.label ?? "Other";
  const d = brief.dimensions;
  const rows: [string, string][] = [
    [t("Type"), t(kind)],
    [t("Size (W × H × D)"), `${d.width} × ${d.height} × ${d.depth} ${t("cm")}`],
    [t("Pieces"), String(quantity)],
    [t("Main material"), brief.material],
    ...(brief.finish ? ([[t("Finish or upholstery"), brief.finish]] as [string, string][]) : []),
  ];
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-brand-navy">{t("What the customer wants made")}</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-sm font-semibold text-brand-navy"><bdi>{value}</bdi></dd>
          </div>
        ))}
      </dl>
      {brief.glb_url && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-slate-700">{t("3D model from the customer's picture")}</h3>
          <p className="text-xs text-slate-500">{t("Made automatically from the first reference picture; the sizes above are what counts.")}</p>
          <div className="mt-2"><ModelViewer url={brief.glb_url} dimensions={{ width: d.width / 100, height: d.height / 100, depth: d.depth / 100 }} /></div>
        </>
      )}
      {brief.images.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-slate-700">{t("Reference pictures")}</h3>
          <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {brief.images.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="size-full object-cover" />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** A link to the custom request form, with a piece's type and size filled in when known. */
export function RequestCustomLink({ type, size, className, children }: { type?: string | null; size?: { width_m: number | null; height_m: number | null; depth_m: number | null }; className?: string; children?: ReactNode }) {
  const t = useT();
  const q = new URLSearchParams();
  if (type && type !== "other") q.set("type", type);
  if (size?.width_m && size.height_m && size.depth_m) {
    q.set("w", String(Math.round(size.width_m * 100)));
    q.set("h", String(Math.round(size.height_m * 100)));
    q.set("d", String(Math.round(size.depth_m * 100)));
  }
  return (
    <Link href={`/tasks/new${q.size ? `?${q}` : ""}`} className={className ?? "inline-flex items-center gap-1.5 text-sm font-semibold text-brand-navy underline-offset-4 hover:underline"}>
      {children ?? t("Request a custom piece")} <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}
