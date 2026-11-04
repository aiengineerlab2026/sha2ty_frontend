"use client";

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Box, Hammer, Loader2, Save, Trash2 } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authSession } from "@/lib/auth/client";
import { deleteDesign, designFromModel, designFromUserModel, getDesign, renameDesign, saveItemVersion, savePlanVersion } from "@/lib/designs/api";
import { requestImplementation, requestTarget, type RequestTarget } from "@/lib/tasks";
import { resized, stretch } from "@/lib/designs/resize";
import type { Design, DesignData, DesignVersion, Dimensions, ItemEdits, SourceModel } from "@/lib/designs/schema";
import { fetchCatalogModel } from "@/lib/plan/api";
import { uploadPublicFile } from "@/lib/vendor/storage";
import { Section } from "@/components/vendor/PartEditor";
import type { PartEditorApi } from "@/lib/vendor/parts";

const ModelViewer = dynamic(() => import("@/components/vendor/ModelViewer").then((mod) => mod.ModelViewer), {
  ssr: false,
  loading: () => <div className="h-[min(70vh,640px)] rounded-2xl border border-slate-200 bg-[#e4eaee]" />,
});

type Shown = DesignVersion & { data: DesignData };
export type Unit = "cm" | "m" | "mm";
const FACTOR: Record<Unit, number> = { m: 1, cm: 100, mm: 1000 };

function sourceSize(source: SourceModel): Dimensions | null {
  return source.width_m && source.height_m && source.depth_m ? { width: source.width_m, height: source.height_m, depth: source.depth_m } : null;
}

/** Same content, whatever the key order (to tell a real change from a save of the same state). */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** One design: a customised item (its editor) or a room / apartment (its plan), with its version history.
 * `id` "new" with `model`: customising a catalogue model that is not saved yet — the first Save asks for a name and
 * creates the design; every later Save adds a version to it (nothing is created before that first Save). */
export function DesignEditor({ id, model }: { id: string; model?: string }) {
  const t = useT();
  const router = useRouter();
  const [designId, setDesignId] = useState<string | null>(id === "new" ? null : id);
  const [userId, setUserId] = useState<string | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [viewKey, setViewKey] = useState(0); // the editor reloads only when another version is opened
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [naming, setNaming] = useState<string | null>(null); // the first-save name dialog (its input)
  const [requesting, setRequesting] = useState(false);
  // Who a request goes to (the model's original vendor only, or every vendor for Sha2ty's own models).
  const [target, setTarget] = useState<RequestTarget | null>(null);
  useEffect(() => {
    if (!designId || design?.kind !== "item") return;
    let live = true;
    requestTarget(designId).then(
      (next) => live && setTarget(next),
      () => live && setTarget(null),
    );
    return () => {
      live = false;
    };
  }, [designId, design?.kind]);
  const exclusive = target?.audience === "vendor_exclusive";
  const requestLabel = exclusive ? t("Request from {vendor}", { vendor: target?.vendor?.name || t("the vendor") }) : t("Get bids from vendors");
  const [dims, setDims] = useState<Dimensions | null>(null);
  const [proportional, setProportional] = useState(true);
  const [unit, setUnit] = useState<Unit>("cm");
  const editor = useRef<PartEditorApi | null>(null);
  const saving = useRef(false); // double clicks: one save at a time, whatever the render
  // One token per intended save: a retry after a lost connection returns what it already made.
  const token = useRef<string>(crypto.randomUUID());

  const show = useCallback((version: Shown) => {
    setShown(version);
    setDims(version.data.item?.dimensions ?? (version.data.item ? sourceSize(version.data.item.source) : null));
    setViewKey((k) => k + 1);
    editor.current = null;
  }, []);

  const refresh = useCallback(async (which: string) => {
    const d = await getDesign(which);
    setDesign(d);
    setTitle(d.title);
    return d;
  }, []);

  useEffect(() => {
    void authSession().then(async ({ data }) => {
      if (!data.session) {
        router.push(`/vendor/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      setUserId(data.session.user.id);
      try {
        if (id !== "new") {
          const d = await refresh(id);
          if (d.current) show(d.current);
          return;
        }
        // Not saved yet: the catalogue listing as the starting point.
        const listing = model ? await fetchCatalogModel(model) : null;
        if (!listing?.glb_url) throw new Error(t("This listing has no 3D model to customise."));
        const source: SourceModel = {
          model_id: listing.id, title: listing.title, vendor_id: listing.company_id, glb_url: listing.glb_url,
          width_m: listing.width_m, height_m: listing.height_m, depth_m: listing.depth_m,
        };
        setTitle(listing.title);
        show({
          id: "unsaved", design_id: "", number: 0, schema: "sha2ty.design/1", glb_url: null, thumbnail_url: null, note: "", restored_from: null, created_at: "",
          data: { schema: "sha2ty.design/1", kind: "item", units: "m", item: { source, material_edits: {} } },
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    });
  }, [id, model, refresh, router, show, t]);

  const run = async (work: () => Promise<string | void>) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await work();
      if (message) setNotice(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  /** What the item looks like now, as a save sends it (sizes in metres, the edits keyed by part). */
  const itemEdits = (): ItemEdits => {
    const api = editor.current;
    const item = shown?.data.item;
    if (!api || !item) throw new Error(t("The model is still loading."));
    const doc = api.document();
    const original = sourceSize(item.source);
    const resizedFromSource = Boolean(dims && original && stable(dims) !== stable(original));
    return {
      dimensions: dims ?? undefined,
      components: doc.components.length ? doc : item.components,
      material_edits: api.edits(),
      ...(item.part_poses ? { part_poses: item.part_poses } : {}),
      ...(api.removedParts?.().length ? { removed_parts: api.removedParts() } : {}),
      ...(resizedFromSource ? { resize_mode: proportional && dims && original && stretch(dims, original) < 1.001 ? "proportional" : "independent" } : {}),
    };
  };

  /** The customised GLB (when the look changed) and a fresh thumbnail, uploaded under `folder`. */
  const files = async (folder: string) => {
    const api = editor.current!;
    let glbUrl = shown?.glb_url ?? null;
    if (api.dirty() || !glbUrl) {
      const blob = await api.exportGlb();
      if (blob) glbUrl = await uploadPublicFile(userId!, new File([blob], "design.glb", { type: "model/gltf-binary" }), `${folder}/model`);
    }
    let thumbnailUrl: string | null = null;
    try {
      const image = await api.thumbnail();
      if (image) thumbnailUrl = await uploadPublicFile(userId!, new File([image], `thumbnail.${image.type === "image/webp" ? "webp" : "png"}`, { type: image.type }), `${folder}/thumbnail`);
    } catch {
      // the version is still saved; the design keeps its previous picture
    }
    return { glbUrl, thumbnailUrl };
  };

  /** The single Save: names and creates the design the first time, then adds versions. */
  const save = () => {
    if (saving.current) return;
    if (!designId) {
      const source = shown?.data.item?.source;
      setNaming(t("My {title}", { title: source?.title ?? "" }).trim());
      return;
    }
    void run(async () => {
      if (!design) return;
      if (design.kind !== "item") {
        const v = await savePlanVersion(design.id, "", token.current);
        token.current = crypto.randomUUID();
        if ((v as { unchanged?: boolean }).unchanged) return t("No changes to save.");
        await refresh(design.id);
        return t("Saved.");
      }
      const item = itemEdits();
      const prev = shown?.data.item;
      const same = prev && stable({ ...item, components: undefined }) === stable({ ...prev, source: undefined, scale: undefined, components: undefined });
      if (same && !editor.current?.dirty()) return t("No changes to save.");
      const { glbUrl, thumbnailUrl } = await files(`designs/${design.id}`);
      const v = await saveItemVersion(design.id, { item, glb_url: glbUrl, thumbnail_url: thumbnailUrl, note: "", clientToken: token.current });
      token.current = crypto.randomUUID();
      if ((v as { unchanged?: boolean }).unchanged) return t("No changes to save.");
      editor.current?.markClean?.();
      setShown({ ...(v as Shown), data: v.data ?? { ...shown!.data, item: { ...prev!, ...item } } });
      await refresh(design.id);
      return t("Saved.");
    });
  };

  const createNamed = (name: string) =>
    run(async () => {
      const source = shown?.data.item?.source;
      if (!source) return;
      const item = itemEdits();
      const { glbUrl, thumbnailUrl } = await files(`designs/new-${token.current}`);
      // The customer's own model: a new design of it, then this save as its first version.
      const made = source.source_type === "user"
        ? await designFromUserModel(source.model_id, name).then(async (d) => (await saveItemVersion(d.id, { item, glb_url: glbUrl, thumbnail_url: thumbnailUrl, note: "", clientToken: token.current }), d))
        : await designFromModel(source.model_id, name, { item, glb_url: glbUrl, thumbnail_url: thumbnailUrl, note: "", clientToken: token.current });
      token.current = crypto.randomUUID();
      editor.current?.markClean?.();
      setNaming(null);
      setDesignId(made.id);
      // The page now is this design (a refresh reopens it), without reloading the editor or its undo history.
      window.history.replaceState(null, "", `/designs/${made.id}`);
      if (made.current) setShown(made.current);
      await refresh(made.id);
      return t("“{title}” saved.", { title: made.title });
    });

  /** Changes on screen that are not in the saved version (a request uses the saved version). */
  const unsaved = () => {
    if (editor.current?.dirty()) return true;
    const saved = shown?.data.item?.dimensions;
    return Boolean(dims && saved && stable(dims) !== stable(saved));
  };

  const rename = () =>
    run(async () => {
      if (!design || !title.trim() || title.trim() === design.title) return;
      setDesign(await renameDesign(design.id, title.trim()));
    });

  const item = shown?.data.item;
  const plan = shown?.data.plan;
  const kind = design?.kind ?? "item";
  const roomCount = Array.isArray(plan?.geometry.rooms) ? plan.geometry.rooms.length : 0;
  const original = item ? sourceSize(item.source) : null;

  const requestCard = design?.kind === "item" && (
    <div className="space-y-3 rounded-2xl bg-brand-navy p-4 text-white shadow-sm">
      <div>
        <p className="text-sm font-semibold">{t("Have it made")}</p>
        <p className="mt-1 text-xs leading-relaxed text-white/70">
          {exclusive
            ? t("This model is {vendor}'s design, so only {vendor} can make it: they see the saved model with its size and materials, send an offer and can chat with you.", { vendor: target?.vendor?.name || t("the vendor") })
            : t("Vendors see the saved model with its size and materials, send bids and can chat with you. Only the parts ticked in the parts list are requested.")}
        </p>
        {exclusive && target && !target.available && (
          <p className="mt-2 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-amber-200">{t("{vendor} is not taking requests right now. Try again later.", { vendor: target.vendor?.name || t("the vendor") })}</p>
        )}
      </div>
      <button
        type="button"
        disabled={busy || (exclusive && target?.available === false)}
        onClick={() =>
          unsaved()
            ? setNotice(t("Save your changes first, so vendors see the model as it is now."))
            : editor.current?.visibleParts?.().length === 0
              ? setNotice(t("Show at least one part: the parts shown are the ones requested."))
              : setRequesting(true)
        }
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-brand-navy transition hover:bg-brand-amber disabled:opacity-60"
      >
        <Hammer className="size-4" aria-hidden /> {requestLabel}
      </button>
    </div>
  );

  const deleteButton = design && (
    <button
      type="button"
      disabled={busy}
      onClick={() => window.confirm(t("Delete “{title}”? It leaves My designs. Requests already sent keep their copy.", { title: design.title })) && void run(async () => {
        await deleteDesign(design.id);
        router.push("/designs");
      })}
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-600"
    >
      <Trash2 className="size-3.5" aria-hidden /> {t("Delete this design")}
    </button>
  );

  return (
    // Editing a model on desktop: a fixed workspace the height of the window. The page never scrolls; each side
    // panel scrolls on its own.
    <div className={`min-h-full bg-slate-50 ${item ? "lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden" : ""}`}>
      <Header />
      <main className={`mx-auto w-full max-w-[1600px] space-y-4 px-3 py-4 sm:px-6 ${item ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-3 lg:space-y-0" : ""}`}>
        {/* Workspace header: back, the name (edit in place), its version, and Save (always in reach). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href="/designs" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-navy">
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t("My designs")}
          </Link>
          <span className="text-slate-300" aria-hidden>/</span>
          {shown && (
            <>
              {design ? (
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => void rename()}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  maxLength={200}
                  aria-label={t("Design name")}
                  className="min-w-0 max-w-full flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold tracking-tight text-brand-navy outline-none transition hover:border-slate-200 hover:bg-white focus:border-brand-amber focus:bg-white focus:ring-2 focus:ring-brand-amber/20 sm:flex-none sm:basis-80"
                />
              ) : (
                <p className="px-2 text-xl font-semibold tracking-tight text-brand-navy">{t("Customising “{title}”", { title })}</p>
              )}
              {/* Save status beside the Save button it reports on, right-aligned with it. */}
              <span className={`ms-auto rounded-full px-2.5 py-1 text-xs font-medium ${!design ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"}`}>
                {!design ? t("Not saved yet") : t("Saved {date}", { date: new Date(design.updated_at).toLocaleString() })}
              </span>
              {design?.kind === "item" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (unsaved() ? setNotice(t("Save your changes first, so the planner shows the model as it is now.")) : router.push(`/plan?design=${design.id}`))}
                  title={t("Place this model in your room in the 3D planner.")}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand-navy shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
                >
                  <Box className="size-4" aria-hidden /> {t("View in 3D planner")}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={save}
                title={design ? t("Saves your changes to this design.") : t("The first save asks for a name and adds the model to My designs.")}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-amber px-5 py-2.5 text-sm font-semibold text-brand-navy shadow-sm shadow-brand-amber/30 transition hover:-translate-y-px hover:bg-[#e8952a] hover:shadow-md active:translate-y-0 disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} {t("Save")}
              </button>
            </>
          )}
        </div>
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{notice}</p>}
        {!shown && !error && <p className="text-sm text-slate-500">{t("Loading…")}</p>}
        {shown && item && (
          // The catalogue original plus every saved edit: reset and undo always go back to the vendor's model.
          <ModelViewer
            key={viewKey}
            edit
            fill
            url={item.source.glb_url}
            parts={item.components ?? null}
            edits={item.material_edits}
            replay
            dimensions={original}
            designSize={dims}
            onDesignSize={setDims}
            proportional={proportional}
            removedParts={item.removed_parts ?? []}
            onApi={(api) => { editor.current = api; }}
            partsFooter={requestCard}
            woodVendor={target?.audience === "vendor_exclusive" ? target.vendor?.id ?? null : null}
            woodModel={item.source.source_type === "user" ? null : item.source.model_id}
            actions={
              <div className="space-y-3">
                <DimensionFields dims={dims} original={original} unit={unit} proportional={proportional} onProportional={setProportional} onUnit={setUnit} onChange={setDims} />
                {deleteButton}
                {item.source.source_type === "user" ? (
                  <p className="px-1 text-[11px] leading-relaxed text-slate-500">{t("Based on your own model “{title}”. Your model is never changed by this design.", { title: item.source.title })}</p>
                ) : (
                  <p className="px-1 text-[11px] leading-relaxed text-slate-500">
                    {t("Based on “{title}” from the catalogue. The vendor's listing is never changed by your design.", { title: item.source.title })}{" "}
                    <Link href={`/catalog/models/${item.source.model_id}`} className="underline">{t("View listing")}</Link>
                  </p>
                )}
              </div>
            }
          />
        )}
        {shown && plan && design && (
          <div className="max-w-3xl space-y-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <p className="font-semibold text-brand-navy">{plan.name || t("Plan")}</p>
            <p className="text-sm text-slate-500">{t("{rooms} rooms · {items} placed items", { rooms: roomCount, items: plan.items.length })}</p>
            {shown.thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown.thumbnail_url} alt="" className="max-h-80 rounded-xl border object-contain" />
            )}
            <p className="text-sm text-slate-600">{t("Edit the layout in the plan builder, then come back and save a version. Restoring a version puts it back into the plan builder.")}</p>
            {design.plan_id && (
              <Link href={`/plan?plan=${design.plan_id}`} className="inline-flex rounded-lg bg-brand-amber px-4 py-2 text-sm font-semibold text-brand-navy">
                {t("Open in the plan builder")}
              </Link>
            )}
            {deleteButton}
          </div>
        )}
      </main>
      {requesting && design && (
        <RequestDialog
          busy={busy}
          title={requestLabel}
          intro={exclusive ? t("Sent only to {vendor}, who made the original model. Later edits to the design do not change this request.", { vendor: target?.vendor?.name || t("the vendor") }) : undefined}
          onClose={() => setRequesting(false)}
          onSubmit={(body) =>
            void run(async () => {
              // The parts shown in the editor are the ones to make (all shown: the whole model).
              const total = shown?.data.item?.components?.components.length ?? 0;
              const visible = editor.current?.visibleParts?.() ?? null;
              const task = await requestImplementation(design.id, { ...body, part_ids: visible && total && visible.length < total ? visible : null });
              setRequesting(false);
              router.push(`/tasks/${task.id}`);
            })
          }
        />
      )}
      {naming !== null && (
        <Dialog open onOpenChange={(open) => !open && !busy && setNaming(null)}>
          <DialogContent className="sm:max-w-md">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (naming.trim()) void createNamed(naming.trim());
              }}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>{t("Name your customised model")}</DialogTitle>
                <DialogDescription>{t("It is saved in My designs under this name. You can rename it later.")}</DialogDescription>
              </DialogHeader>
              <input
                autoFocus
                value={naming}
                onChange={(e) => setNaming(e.target.value)}
                maxLength={200}
                aria-invalid={!naming.trim()}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              {!naming.trim() && <p className="text-xs text-red-700">{t("Enter a name.")}</p>}
              <DialogFooter>
                <button type="button" disabled={busy} onClick={() => setNaming(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">{t("Cancel")}</button>
                <button type="submit" disabled={busy || !naming.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand-amber px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60">
                  {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {t("Save")}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Overall size, typed in the unit chosen (stored in metres); the viewer's handles change the same numbers. */
export function DimensionFields({
  dims, original, unit, proportional, onProportional, onUnit, onChange,
}: {
  dims: Dimensions | null; original: Dimensions | null; unit: Unit; proportional: boolean;
  onProportional: (on: boolean) => void; onUnit: (u: Unit) => void; onChange: (d: Dimensions) => void;
}) {
  const t = useT();
  if (!dims) return <p className="text-xs text-slate-500">{t("This listing has no catalogue size, so the model is shown at its file size.")}</p>;
  const stretched = original ? stretch(dims, original) > 1.02 : false;
  const field = (key: keyof Dimensions, label: string) => (
    <label className="text-xs text-slate-500">
      {t(label)}
      <input
        type="number"
        min={0.05 * FACTOR[unit]}
        step={unit === "m" ? 0.01 : 1}
        value={Number((dims[key] * FACTOR[unit]).toFixed(unit === "m" ? 3 : 1))}
        onChange={(e) => {
          const value = Number(e.target.value) / FACTOR[unit];
          if (value > 0 && value <= 50) onChange(resized(dims, key, value, proportional));
        }}
        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900"
      />
    </label>
  );
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm">
      <Section title={t("Dimensions")}>
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] items-end gap-2">
        {field("width", "Width")}
        {field("height", "Height")}
        {field("depth", "Depth")}
        <select value={unit} onChange={(e) => onUnit(e.target.value as Unit)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
          <option value="mm">mm</option>
          <option value="cm">cm</option>
          <option value="m">m</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" checked={proportional} onChange={() => onProportional(true)} /> {t("Keep proportions")}
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" checked={!proportional} onChange={() => onProportional(false)} /> {t("Width, height and depth separately")}
        </label>
        {original && (
          <button type="button" onClick={() => onChange(original)} className="ms-auto underline">{t("Catalogue size")}</button>
        )}
      </div>
      {stretched && (
        <p className="text-xs text-amber-800">
          {t("These proportions differ from the catalogue model: the whole model is stretched, so cushions, legs and textures stretch too. This is scaling, not a redesign of the furniture.")}
        </p>
      )}
      </Section>
    </div>
  );
}

/** What the customer adds to the model for vendors: what they want, where, budget and date. */
function RequestDialog({ busy, title, intro, onClose, onSubmit }: { busy: boolean; title: string; intro?: string; onClose: () => void; onSubmit: (body: { description: string; location: string; budget_max: number | null; deadline: string | null; quantity: number }) => void }) {
  const t = useT();
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [location, setLocation] = useState("");
  const [budget, setBudget] = useState("");
  const [deadline, setDeadline] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ description: description.trim(), location: location.trim(), budget_max: budget ? Number(budget) : null, deadline: deadline || null, quantity: Math.max(1, Math.round(Number(quantity) || 1)) });
          }}
          className="space-y-3"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{intro ?? t("Vendors receive the saved model with its exact size, parts and materials. Later edits to the design do not change this request.")}</DialogDescription>
          </DialogHeader>
          <label className="block text-sm">
            {t("What should the vendor know?")}
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000} placeholder={t("Materials you prefer, delivery, installation…")} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              {t("City / area")}
              <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5" />
            </label>
            <label className="block text-sm">
              {t("Budget up to (EGP)")}
              <input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              {t("Number of pieces")}
              <input type="number" min="1" max="1000" step="1" required value={quantity} onChange={(e) => setQuantity(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5" />
            </label>
            <label className="block text-sm">
              {t("Wanted by (optional)")}
              <input type="date" min={today} value={deadline} onChange={(e) => setDeadline(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5" />
            </label>
          </div>
          <DialogFooter>
            <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">{t("Cancel")}</button>
            <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-brand-amber px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {t("Publish request")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
