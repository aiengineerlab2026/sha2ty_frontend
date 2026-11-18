"use client";

import { useLocale, useT } from "@/lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Box, Camera, Hammer, Loader2, Save, Trash2 } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { appView, useInApp } from "@/lib/app";
import { authSession } from "@/lib/auth/client";
import { deleteDesign, guideWithOptions, priceGuide, type PriceGuide, designFromModel, designFromUserModel, getDesign, renameDesign, saveItemVersion, savePlanVersion } from "@/lib/designs/api";
import { requestImplementation, requestTarget, updateRequestViews, type RequestTarget, type RequestViews } from "@/lib/tasks";
import { makeRequestViews } from "@/lib/designs/requestViews";
import { resized, sizeCm, stretch } from "@/lib/designs/resize";
import { draftName, hasUnsavedChanges } from "@/lib/designs/unsaved";
import type { Design, DesignData, DesignVersion, Dimensions, ItemDesign, ItemEdits, SourceModel } from "@/lib/designs/schema";
import { fetchCatalogModel } from "@/lib/plan/api";
import { formatPrice } from "@/lib/plan/pricing";
import type { PartDocument } from "@/lib/vendor/parts";
import { uploadPublicFile } from "@/lib/vendor/storage";
import { Section } from "@/components/vendor/PartEditor";
import { MatchButton } from "@/components/match/MatchWizard";
import { ReplaceGlb } from "@/components/vendor/ReplaceGlb";
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

/** What a request sends, in words (the saved version): size, wood, fabrics and colours by part, styles, the parts
 * to make. The request dialog shows it before publishing; vendors get the same (DesignSpecView). */
function designSummary(item: ItemDesign, parts: PartDocument | null, visible: string[] | null, t: ReturnType<typeof useT>): { label: string; value: string }[] {
  const comps = parts?.components ?? item.components?.components ?? [];
  const partName = (id: string) => t(comps.find((c) => c.id === id)?.name ?? id);
  const removed = new Set(item.removed_parts ?? []);
  const edits = Object.entries(item.material_edits ?? {}).filter(([id]) => !removed.has(id));
  const wood = edits.map(([, e]) => e.material).find((m) => m?.kind === "wood");
  // "Green linen: Chair Base, Chair Back": each fabric / paint once, with the parts it is on.
  const byLook = new Map<string, string[]>();
  for (const [id, e] of edits) {
    const m = e.material;
    if (!m || m.kind === "wood") continue;
    const look = m.kind === "paint" ? `${t("Paint")}: ${m.color_name ? t(m.color_name) : m.name}` : `${m.name} (${t("Fabric")})`;
    byLook.set(look, [...(byLook.get(look) ?? []), partName(id)]);
  }
  const styles = Object.entries(item.part_variants ?? {}).map(([id, v]) => {
    const name = comps.find((c) => c.id === id)?.variants?.find((x) => x.id === v)?.name;
    return name ? `${partName(id)}: ${t(name)}` : null;
  }).filter(Boolean);
  const all = comps.filter((c) => !removed.has(c.id)).map((c) => c.id);
  // Parts the customer added: optional, each with the vendor's price difference (or priced in the bids).
  const added = (item.components?.added ?? []).map((a) => {
    const delta = parts?.addable?.find((x) => x.type === a.type)?.price_delta;
    return `${partName(a.id)}${delta ? ` (${delta > 0 ? "+" : "−"}${formatPrice(Math.abs(delta))})` : ""}`;
  });
  const made = visible && visible.length < all.length ? visible : null;
  const d = item.dimensions ?? sourceSize(item.source);
  return [
    { label: "Size", value: d ? `${sizeCm(d)} ${t("cm")} (${t("W × H × D")})${item.resize_mode === "independent" ? ` · ${t("sides changed separately")}` : ""}` : t("Catalogue size") },
    { label: "Wood", value: wood ? `${wood.name}${wood.finish ? ` · ${wood.finish.name}` : ""}` : t("As in the catalogue model") },
    { label: "Fabrics and colours", value: byLook.size ? [...byLook].map(([look, on]) => `${look}: ${on.join("، ")}`).join(" · ") : t("As in the catalogue model") },
    { label: "Styles", value: styles.length ? styles.join(" · ") : t("Original") },
    { label: "Parts to make", value: made ? made.map(partName).join("، ") : t("The whole model ({n} parts)", { n: all.length }) },
    ...(added.length ? [{ label: "Optional parts you added", value: added.join("، ") }] : []),
  ];
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
  const inApp = useInApp(); // the app's browser view: it opens a saved design in AR when asked
  const router = useRouter();
  const [designId, setDesignId] = useState<string | null>(id === "new" ? null : id);
  const [userId, setUserId] = useState<string | null>(null);
  const locale = useLocale();
  const [design, setDesign] = useState<Design | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [viewKey, setViewKey] = useState(0); // the editor reloads only when another version is opened
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // What a long save or request is doing now (big 3D files on a slow connection take a while): shown beside it.
  const [stage, setStage] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [shownParts, setShownParts] = useState<string[] | null>(null); // the parts shown when the request was opened
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
  // The listing's part list as it is now: its part variants (added by the vendor after this design was made too).
  // undefined while loading; the editor waits for it, so variants are there from the first frame.
  const [liveParts, setLiveParts] = useState<PartDocument | null | undefined>(undefined);
  const [proportional, setProportional] = useState(true);
  // The customer's own new 3D file, not saved yet: Save builds the design on it (the listing is never changed).
  const [base, setBase] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>("cm");
  const editor = useRef<PartEditorApi | null>(null);
  const saving = useRef(false); // double clicks: one save at a time, whatever the render
  // One token per intended save: a retry after a lost connection returns what it already made.
  const token = useRef<string>(crypto.randomUUID());

  const show = useCallback((version: Shown) => {
    setShown(version);
    setDims(version.data.item?.dimensions ?? (version.data.item ? sourceSize(version.data.item.source) : null));
    setProportional(version.data.item?.resize_mode !== "independent");
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
      setStage(null);
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
      components: doc.components.length ? doc : base ? undefined : item.components,
      material_edits: api.edits(),
      ...(base ?? item.base_glb_url ? { base_glb_url: base ?? item.base_glb_url } : {}),
      ...(item.part_poses && !base ? { part_poses: item.part_poses } : {}),
      ...(api.removedParts?.().length ? { removed_parts: api.removedParts() } : {}),
      ...(api.partVariants && Object.keys(api.partVariants()).length ? { part_variants: api.partVariants() } : {}),
      ...(resizedFromSource ? { resize_mode: proportional && dims && original && stretch(dims, original) < 1.001 ? "proportional" : "independent" } : {}),
    };
  };

  /** The request report's two pictures of the saved model (closed with its size, opened with its parts numbered) and
   * its parts table, rendered from the saved file and uploaded. Throws when they cannot be made: no incomplete report. */
  const requestViews = async (designId: string, glbUrl: string | null, item: ItemDesign | undefined): Promise<RequestViews> => {
    if (!glbUrl || !item) throw new Error(t("Save the design first: the request is made from the saved model."));
    try {
      setStage(t("Making the pictures for vendors…"));
      return await makeRequestViews(glbUrl, item, locale === "ar" ? "ar" : "en", `designs/${designId}/request`);
    } catch (caught) {
      throw new Error(t("Could not make the pictures of the model for the request: {error}", { error: caught instanceof Error ? caught.message : String(caught) }));
    }
  };

  /** The customised GLB (when the look changed) and a fresh thumbnail, uploaded under `folder`. */
  const files = async (folder: string) => {
    const api = editor.current!;
    let glbUrl = shown?.glb_url ?? null;
    if (base || api.dirty() || !glbUrl) {
      setStage(t("Preparing the 3D model…"));
      const blob = await api.exportGlb();
      if (blob) setStage(t("Uploading the 3D model ({size} MB)…", { size: (blob.size / 1e6).toFixed(1) }));
      if (blob) glbUrl = await uploadPublicFile(userId!, new File([blob], "design.glb", { type: "model/gltf-binary" }), `${folder}/model`);
    }
    let thumbnailUrl: string | null = null;
    try {
      setStage(t("Uploading the picture…"));
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
      // The first save needs no name: a draft with a temporary one (named later, e.g. when publishing a request).
      void createNamed(draftName(shown?.data.item?.source.title ?? "", t), true);
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
      // Its open requests now show this version: their report pictures are made again from it.
      let viewsError: string | null = null;
      if ((v as { requests?: number }).requests) {
        try {
          await updateRequestViews(design.id, await requestViews(design.id, v.glb_url ?? glbUrl, v.data?.item ?? { ...prev!, ...item }));
        } catch (caught) {
          viewsError = caught instanceof Error ? caught.message : String(caught);
        }
      }
      if (base) setViewKey((k) => k + 1); // the saved part list of the new file from now on
      setBase(null);
      setShown({ ...(v as Shown), data: v.data ?? { ...shown!.data, item: { ...prev!, ...item } } });
      await refresh(design.id);
      if (viewsError) throw new Error(t("Saved, but the pictures in your open request could not be updated: {error}", { error: viewsError }));
      return t("Saved.");
    });
  };

  const createNamed = (name: string, draft = false) =>
    run(async () => {
      const source = shown?.data.item?.source;
      if (!source) return;
      const item = itemEdits();
      const { glbUrl, thumbnailUrl } = await files(`designs/new-${token.current}`);
      // The customer's own model: a new design of it, then this save as its first version.
      const made = source.source_type === "user"
        ? await designFromUserModel(source.model_id, name).then(async (d) => (await saveItemVersion(d.id, { item, glb_url: glbUrl, thumbnail_url: thumbnailUrl, note: "", clientToken: token.current }), d))
        : await designFromModel(source.model_id, name, { item, glb_url: glbUrl, thumbnail_url: thumbnailUrl, note: "", clientToken: token.current, draft });
      token.current = crypto.randomUUID();
      editor.current?.markClean?.();
      if (base) setViewKey((k) => k + 1);
      setBase(null);
      setDesignId(made.id);
      // The page now is this design (a refresh reopens it), without reloading the editor or its undo history.
      window.history.replaceState(null, "", `/designs/${made.id}`);
      if (made.current) setShown(made.current);
      await refresh(made.id);
      return draft ? t("Saved as a draft. Give it a name above, or when you request bids.") : t("“{title}” saved.", { title: made.title });
    });

  /** Changes on screen that are not in the saved version (a request uses the saved version). */
  const unsaved = () =>
    hasUnsavedChanges({
      editorDirty: Boolean(editor.current?.dirty()),
      newFile: Boolean(base),
      dims,
      savedDims: shown?.data.item?.dimensions,
      sourceDims: shown?.data.item ? sourceSize(shown.data.item.source) : null,
    });

  // Leaving with unsaved changes asks first (a customisation is easily an hour's work): closing or reloading the tab
  // (the browser's own prompt), a link to another page or design, and the browser's Back button. A saved design
  // (nothing changed since) leaves without a word.
  const pendingRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    pendingRef.current = () => Boolean(shown?.data.item) && !saving.current && unsaved();
  });
  useEffect(() => {
    const pending = () => pendingRef.current();
    const leave = t("You have unsaved changes to this design. Leave without saving?");
    const warn = (event: BeforeUnloadEvent) => {
      if (pending()) event.preventDefault();
    };
    const onLink = (event: MouseEvent) => {
      const a = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin || (to.pathname === location.pathname && to.search === location.search)) return;
      if (pending() && !window.confirm(leave)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // One extra entry for this page: Back first lands on it (same address) and is asked about, then really goes back.
    history.pushState({ sha2tyGuard: true }, "", location.href);
    const onBack = () => {
      if (pending() && !window.confirm(leave)) {
        history.pushState({ sha2tyGuard: true }, "", location.href); // stay
        return;
      }
      window.removeEventListener("popstate", onBack);
      history.back();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onLink, true);
    window.addEventListener("popstate", onBack);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onLink, true);
      window.removeEventListener("popstate", onBack);
    };
  }, [t]);

  const rename = () =>
    run(async () => {
      if (!design || !title.trim() || title.trim() === design.title) return;
      setDesign(await renameDesign(design.id, title.trim()));
    });

  const item = shown?.data.item;
  const listingId = item && item.source.source_type !== "user" ? item.source.model_id : null;
  useEffect(() => {
    if (!shown || !listingId) return; // the customer's own model: its variants are its own
    let live = true;
    // From the backend's catalogue (customers may not read the models table itself).
    fetchCatalogModel(listingId).then(
      (listing) => live && setLiveParts(listing?.components ?? null),
      () => live && setLiveParts(null),
    );
    return () => {
      live = false;
    };
  }, [shown, listingId]);
  // The design's own part list (its names), with each part's variants as the listing offers them now.
  const parts: PartDocument | null = (() => {
    if (base) return null; // a new file: its parts are read from it
    const own = item?.components ?? null;
    if (!listingId || item?.base_glb_url || !liveParts?.components.length) return own && listingId && liveParts ? { ...own, addable: liveParts.addable } : own;
    if (!own?.components.length) return liveParts;
    const variants = new Map(liveParts.components.map((c) => [c.id, c.variants]));
    // What the vendor lets customers add or pick is the listing's now (never an older copy saved in the design).
    return { ...own, addable: liveParts.addable, components: own.components.map((c) => ({ ...c, variants: variants.get(c.id) ?? c.variants })) };
  })();
  // The price guide for this listing at the size on screen (re-asked half a second after the size settles).
  const [guide, setGuide] = useState<PriceGuide | null | undefined>(undefined);
  const guideKey = listingId && dims ? `${listingId}|${dims.width.toFixed(2)}|${dims.height.toFixed(2)}|${dims.depth.toFixed(2)}` : null;
  useEffect(() => {
    if (!guideKey || !listingId) return;
    let live = true;
    const timer = setTimeout(() => {
      priceGuide(listingId, dims).then((g) => live && setGuide(g), () => live && setGuide(null));
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key holds listing and size
  }, [guideKey]);
  const plan = shown?.data.plan;
  const kind = design?.kind ?? "item";
  const roomCount = Array.isArray(plan?.geometry.rooms) ? plan.geometry.rooms.length : 0;
  const original = item ? sourceSize(item.source) : null;

  const askBids = () =>
    unsaved()
      ? setNotice(t("Save your changes first, so vendors see the model as it is now."))
      : editor.current?.visibleParts?.().length === 0
        ? setNotice(t("Show at least one part: the parts shown are the ones requested."))
        : (setShownParts(editor.current?.visibleParts?.() ?? null), setRequesting(true));
  // Where the customer is in the made-to-order flow (shown above the editor until a request exists).
  const step = design ? 3 : 1; // saved: requesting bids is next
  const steps = (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 max-lg:hidden" aria-label={t("How it works")}>
      {["Customise", "Save", "Request bids", "Choose a vendor"].map((label, i) => (
        <li key={label} className="inline-flex items-center gap-2">
          {i > 0 && <span className="text-slate-300" aria-hidden>→</span>}
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${i + 1 === step ? "bg-brand-navy text-white" : i + 1 < step ? "bg-emerald-50 text-emerald-700" : "bg-white ring-1 ring-slate-200"}`}>
            <span className="tabular-nums">{i + 1}</span> {t(label)}
          </span>
        </li>
      ))}
    </ol>
  );

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
        onClick={askBids}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-brand-navy transition hover:bg-brand-amber disabled:opacity-60"
      >
        <Hammer className="size-4" aria-hidden /> {requestLabel}
      </button>
    </div>
  );

  // "See how it looks with other items": a picture of the model as it is now, at its current size, so it works
  // before the first save and with unsaved edits.
  const match = kind === "item" && shown?.data.item ? (
    <MatchButton
      model={{ id: design?.id ?? "unsaved", title: design?.title ?? title, thumbnail: null, width_m: dims?.width ?? null, height_m: dims?.height ?? null, depth_m: dims?.depth ?? null, snapshot: async () => (await editor.current?.thumbnail()) ?? null }}
    />
  ) : null;

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
    // Editing a model: a fixed workspace the height of the window. The page never scrolls; on desktop each side
    // panel scrolls on its own, on phones the panels are a bottom sheet over the 3D view (ModelViewer `fill`).
    // In the app the native screen has its own header, so the site's is left out.
    <div className={`min-h-full overflow-x-hidden bg-slate-50 ${item ? "flex h-dvh flex-col overflow-hidden" : ""}`}>
      {!inApp && <Header />}
      <main className={`mx-auto w-full max-w-[1600px] space-y-4 px-3 py-4 sm:px-6 ${item ? "flex min-h-0 flex-1 flex-col space-y-0 max-lg:px-0 max-lg:py-0 lg:gap-3" : ""}`}>
        {/* Workspace header: back, the name (edit in place), its version, and Save (always in reach). Phones: one
            compact bar, icons for the secondary actions. */}
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${item ? "max-lg:flex-nowrap max-lg:gap-2 max-lg:border-b max-lg:border-slate-200 max-lg:bg-white max-lg:px-3 max-lg:py-2" : ""}`}>
          <Link href="/designs" aria-label={t("My designs")} className="inline-flex shrink-0 items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-navy max-lg:size-10 max-lg:justify-center max-lg:rounded-full max-lg:hover:bg-slate-100">
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> <span className="max-lg:hidden">{t("My designs")}</span>
          </Link>
          <span className="text-slate-300 max-lg:hidden" aria-hidden>/</span>
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
                  className="min-w-0 max-w-full flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold max-lg:text-base tracking-tight text-brand-navy outline-none transition hover:border-slate-200 hover:bg-white focus:border-brand-amber focus:bg-white focus:ring-2 focus:ring-brand-amber/20 sm:flex-none sm:basis-80"
                />
              ) : (
                <p className="min-w-0 flex-1 truncate px-2 text-xl font-semibold tracking-tight text-brand-navy max-lg:text-base">{t("Customising “{title}”", { title })}</p>
              )}
              {/* Save status beside the Save button it reports on, right-aligned with it. */}
              {design?.draft && <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200" title={t("Saved without a name. Rename it here, or name it when you request bids.")}>{t("Draft")}</span>}
              <span className={`ms-auto rounded-full px-2.5 py-1 text-xs font-medium max-lg:hidden ${!design ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"}`}>
                {busy && stage ? stage : !design ? t("Not saved yet") : t("Saved {date}", { date: new Date(design.updated_at).toLocaleString() })}
              </span>
              {/* Mobile app: the image matching shortcut beside View in camera. */}
              {inApp && match && <MatchButton {...match.props} compact />}
              {inApp && shown?.data.item && (
                // Mobile app only: AR shows the model as it is now. Saved: the design itself. Unsaved edits (or a new model):
                // the editor's model is exported and uploaded as a preview, opened at its current size.
                // ponytail: previews stay in storage (designs/previews); clean them up if storage use matters.
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    design && !unsaved()
                      ? appView()?.postMessage(JSON.stringify({ type: "ar", model: shown.data.item!.source.model_id, design: design.id }))
                      : void run(async () => {
                          const blob = await editor.current?.exportGlb();
                          if (!blob || !userId) return t("Could not prepare the model for the camera. Try again.");
                          const glb = await uploadPublicFile(userId, new File([blob], "preview.glb", { type: "model/gltf-binary" }), "designs/previews");
                          appView()?.postMessage(JSON.stringify({ type: "ar", glb, title: design?.title ?? title, w: dims?.width, h: dims?.height, d: dims?.depth }));
                        })
                  }
                  aria-label={t("View in camera")}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand-navy shadow-sm transition hover:bg-slate-50 disabled:opacity-60 max-lg:h-10 max-lg:px-3"
                >
                  <Camera className="size-4" aria-hidden /> <span className="max-sm:hidden">{t("View in camera")}</span>
                </button>
              )}
              {design?.kind === "item" && !inApp && ( // the planner is web-only
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (unsaved() ? setNotice(t("Save your changes first, so the planner shows the model as it is now.")) : router.push(`/plan?design=${design.id}`))}
                  title={t("Place this model in your room in the 3D planner.")}
                  aria-label={t("View in 3D planner")}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand-navy shadow-sm transition hover:bg-slate-50 disabled:opacity-60 max-lg:size-10 max-lg:justify-center max-lg:px-0"
                >
                  <Box className="size-4" aria-hidden /> <span className="max-lg:hidden">{t("View in 3D planner")}</span>
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={save}
                title={design ? t("Saves your changes to this design.") : t("Saves a draft in My designs. You can name it later.")}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold max-lg:h-10 max-lg:px-4 ${item ? "max-lg:hidden" : ""} transition disabled:opacity-60 ${design?.kind === "item" ? "border border-slate-200 bg-white text-brand-navy shadow-sm hover:bg-slate-50" : "bg-brand-amber text-brand-navy shadow-sm shadow-brand-amber/30 hover:-translate-y-px hover:bg-[#e8952a] hover:shadow-md active:translate-y-0"}`}
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} {design || kind !== "item" ? t("Save") : t("Save draft")}
              </button>
              {design?.kind === "item" && (
                // After saving, the next step: publish the saved design as a request for bids.
                <button
                  type="button"
                  disabled={busy || (exclusive && target?.available === false)}
                  onClick={askBids}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold max-lg:hidden transition disabled:opacity-60 ${!design ? "border border-slate-200 bg-white text-brand-navy" : "bg-brand-amber text-brand-navy shadow-sm shadow-brand-amber/30 hover:-translate-y-px hover:bg-[#e8952a] hover:shadow-md"}`}
                >
                  <Hammer className="size-4" aria-hidden /> <span className="max-sm:sr-only">{exclusive ? requestLabel : t("Request vendor bids")}</span>
                </button>
              )}
            </>
          )}
        </div>
        {item && steps}
        {error && <p className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 max-lg:mx-3 max-lg:mt-2">{error}</p>}
        {notice && <p role="status" onClick={() => setNotice(null)} className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 max-lg:mx-3 max-lg:mt-2">{notice}</p>}
        {!shown && !error && <p className="text-sm text-slate-500">{t("Loading…")}</p>}
        {shown && item && (!listingId || liveParts !== undefined) && (
          // The catalogue original plus every saved edit: reset and undo always go back to the vendor's model.
          <ModelViewer
            key={viewKey}
            edit
            fill
            shopper
            url={base ?? item.base_glb_url ?? item.source.glb_url}
            parts={parts}
            partVariants={base ? null : item.part_variants ?? null}
            edits={base ? {} : item.material_edits}
            replay
            dimensions={original}
            designSize={dims}
            onDesignSize={setDims}
            proportional={proportional}
            onProportional={setProportional}
            priceGuide={listingId ? guide : null}
            // Phones: Save, then Request bids, at the bottom of the screen (one hand).
            phoneAction={
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={save} className={`inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition disabled:opacity-60 ${design && kind === "item" ? "border border-slate-200 bg-white text-brand-navy" : "bg-brand-amber text-brand-navy shadow-sm"}`}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} {busy && stage ? <span className="truncate text-xs">{stage}</span> : design ? t("Save") : t("Save draft")}
                </button>
                {design && (
                  <button type="button" disabled={busy || (exclusive && target?.available === false)} onClick={askBids} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-amber text-sm font-semibold text-brand-navy shadow-sm disabled:opacity-60">
                    <Hammer className="size-4" aria-hidden /> {t("Request bids")}
                  </button>
                )}
              </div>
            }
            removedParts={base ? [] : item.removed_parts ?? []}
            onApi={(api) => { editor.current = api; }}
            partsFooter={requestCard}
            woodVendor={target?.audience === "vendor_exclusive" ? target.vendor?.id ?? null : null}
            woodModel={item.source.source_type === "user" ? null : item.source.model_id}
            actionsLabel="Size & more"
            actions={
              <div className="space-y-3">
                <DimensionFields dims={dims} original={original} unit={unit} proportional={proportional} onProportional={setProportional} onUnit={setUnit} onChange={setDims} />
                {match}
                {userId && (
                  <ReplaceGlb
                    upload={(file) => uploadPublicFile(userId, file, `designs/${designId ?? `new-${token.current}`}/base`)}
                    onReplaced={(url) => { setBase(url); setViewKey((k) => k + 1); editor.current = null; setError(null); setNotice(t("New 3D file loaded. Save to keep it.")); }}
                    onError={setError}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-brand-navy transition hover:bg-slate-50"
                  />
                )}
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
          stage={stage}
          title={requestLabel}
          intro={exclusive ? t("Sent only to {vendor}, who made the original model. Later edits to the design do not change this request.", { vendor: target?.vendor?.name || t("the vendor") }) : undefined}
          // The guide with the saved options' prices on top (variants, added parts), as in the editor.
          estimate={(() => {
            const it = shown?.data.item;
            const comps = parts?.components ?? [];
            const extras = [
              ...Object.entries(it?.part_variants ?? {}).map(([id, v]) => comps.find((c) => c.id === id)?.variants?.find((x) => x.id === v)?.price_delta),
              ...(it?.components?.added ?? []).map((a) => parts?.addable?.find((x) => x.type === a.type)?.price_delta),
            ];
            const range = guideWithOptions(guide, extras);
            return range && guide ? { ...guide, low: range.low, high: range.high } : guide;
          })()}
          draftTitle={design.draft ? shown?.data.item?.source.title ?? "" : null}
          summary={shown?.data.item ? designSummary(shown.data.item, parts, shownParts, t) : []}
          onClose={() => setRequesting(false)}
          onSubmit={(body) =>
            void run(async () => {
              // The parts shown in the editor are the ones to make (all shown: the whole model).
              const total = shown?.data.item?.components?.components.length ?? 0;
              const visible = editor.current?.visibleParts?.() ?? null;
              // The request is made from the saved model: its report pictures too.
              if (editor.current?.dirty?.()) throw new Error(t("Save your changes first: the request is made from the saved design."));
              if (!shown || shown.id !== design.current_version_id) throw new Error(t("Open the latest saved version to request it."));
              // A draft is named now: the request (and the vendors) see this name.
              if (design.draft && body.name) {
                const named = await renameDesign(design.id, body.name);
                setDesign(named);
                setTitle(named.title);
              }
              const views = await requestViews(design.id, shown.glb_url, shown.data.item);
              setStage(t("Publishing the request…"));
              const { name: _name, ...request } = body; // eslint-disable-line @typescript-eslint/no-unused-vars
              const task = await requestImplementation(design.id, { ...request, part_ids: visible && total && visible.length < total ? visible : null, views });
              setRequesting(false);
              router.push(`/tasks/${task.id}`);
            })
          }
        />
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
          {t("Width, height and depth were changed separately: the model is stretched to this size, and vendors are asked to check the proportions of cushions, legs and frame.")}
        </p>
      )}
      </Section>
    </div>
  );
}

/** What the customer adds to the model for vendors: what they want, where, budget and date. */
function RequestDialog({ busy, stage, title, intro, summary, draftTitle, estimate, onClose, onSubmit }: { busy: boolean; stage: string | null; title: string; intro?: string; summary: { label: string; value: string }[];
  /** The price guide per piece (lib/designs/api priceGuide): shown × the pieces asked, as an estimate. */
  estimate?: PriceGuide | null;
  /** A draft: its name is asked here (prefilled with the listing's), null when it has one. */
  draftTitle: string | null;
  onClose: () => void; onSubmit: (body: { name?: string; description: string; location: string; budget_max: number | null; deadline: string | null; quantity: number }) => void }) {
  const t = useT();
  const [name, setName] = useState(draftTitle ?? "");
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
            if (draftTitle !== null && !name.trim()) return;
            onSubmit({ ...(draftTitle !== null ? { name: name.trim() } : {}), description: description.trim(), location: location.trim(), budget_max: budget ? Number(budget) : null, deadline: deadline || null, quantity: Math.max(1, Math.round(Number(quantity) || 1)) });
          }}
          className="space-y-3"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{intro ?? t("Vendors receive the saved model with its exact size, parts and materials. Later edits to the design do not change this request.")}</DialogDescription>
          </DialogHeader>
          {draftTitle !== null && (
            <label className="block text-sm">
              {t("Name your design")}
              <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder={t("e.g. Dining chairs, green linen")} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5" />
              <span className="mt-0.5 block text-xs text-slate-500">{t("It is still a draft: vendors see this name.")}</span>
            </label>
          )}
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
          {/* Everything vendors will see, checked before it goes out. */}
          <div className="max-h-56 overflow-y-auto rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs font-semibold text-brand-navy">{t("Vendors will see")}</p>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              {[
                ...summary,
                { label: "Quantity", value: t("{n} pieces", { n: Math.max(1, Math.round(Number(quantity) || 1)) }) },
                {
                  label: "Estimated price",
                  value: estimate?.low != null && estimate.high != null
                    ? t("{low} – {high} for {n} pieces (estimate; vendors set the price)", { low: formatPrice(estimate.low * Math.max(1, Math.round(Number(quantity) || 1))), high: formatPrice(estimate.high * Math.max(1, Math.round(Number(quantity) || 1))), n: Math.max(1, Math.round(Number(quantity) || 1)) })
                    : t("Price determined by vendor bids"),
                },
                { label: "Budget", value: budget ? t("up to {price}", { price: formatPrice(Number(budget)) }) : t("Open") },
                { label: "Location", value: location.trim() || "—" },
                { label: "Wanted by", value: deadline ? new Date(deadline).toLocaleDateString() : t("Flexible") },
              ].map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-slate-500">{t(row.label)}</dt>
                  <dd className="font-medium text-slate-800">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          {busy && stage && <p role="status" className="flex items-center gap-2 text-xs text-slate-600"><Loader2 className="size-3.5 animate-spin" aria-hidden />{stage}</p>}
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
