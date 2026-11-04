"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Loader2, Send, Upload } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { DimensionFields, type Unit } from "@/components/designs/DesignEditor";
import { authSession } from "@/lib/auth/client";
import { proposalBase, sendProposal } from "@/lib/tasks";
import { uploadPublicFile } from "@/lib/vendor/storage";
import { stretch } from "@/lib/designs/resize";
import type { Dimensions, ItemDesign } from "@/lib/designs/schema";
import type { PartEditorApi } from "@/lib/vendor/parts";

const ModelViewer = dynamic(() => import("@/components/vendor/ModelViewer").then((mod) => mod.ModelViewer), {
  ssr: false,
  loading: () => <div className="h-[min(70vh,640px)] rounded-2xl border border-slate-200 bg-[#e4eaee]" />,
});

const sizeOf = (item: ItemDesign): Dimensions | null =>
  item.source.width_m && item.source.height_m && item.source.depth_m ? { width: item.source.width_m, height: item.source.height_m, depth: item.source.depth_m } : null;

/** A vendor changes a requested model (size, parts, materials) and sends it to the customer with a note, before
 * bidding (backend/app/api/proposals.py). The customer accepts or rejects it on the request page. */
export function ProposalEditor({ taskId }: { taskId: string }) {
  const t = useT();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [item, setItem] = useState<ItemDesign | null>(null);
  const [title, setTitle] = useState("");
  // The customer's model as they saved it (the customised file), to download and rework in a 3D tool.
  const [current, setCurrent] = useState<string | null>(null);
  // A new version the vendor uploaded: the proposal is built on it (its parts and look), and the viewer reloads.
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [viewKey, setViewKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [dims, setDims] = useState<Dimensions | null>(null);
  const [proportional, setProportional] = useState(true);
  const [unit, setUnit] = useState<Unit>("cm");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = useRef<PartEditorApi | null>(null);

  useEffect(() => {
    void authSession().then(async ({ data }) => {
      if (!data.session) {
        router.push(`/vendor/login?next=${encodeURIComponent(location.pathname)}`);
        return;
      }
      setUserId(data.session.user.id);
      try {
        const base = await proposalBase(taskId);
        setItem(base.item);
        setTitle(base.title);
        setCurrent(base.glb_url ?? base.item.source.glb_url);
        setDims(base.item.dimensions ?? sizeOf(base.item));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    });
  }, [taskId, router]);

  const send = async () => {
    const api = editor.current;
    if (!api || !item || !userId) return;
    if (!note.trim()) {
      setError(t("Tell the customer what you changed and why."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const folder = `proposals/${taskId}`;
      const blob = await api.exportGlb();
      const glbUrl = blob ? await uploadPublicFile(userId, new File([blob], "proposal.glb", { type: "model/gltf-binary" }), `${folder}/model`) : null;
      let thumbnailUrl: string | null = null;
      try {
        const image = await api.thumbnail();
        if (image) thumbnailUrl = await uploadPublicFile(userId, new File([image], `thumbnail.${image.type === "image/webp" ? "webp" : "png"}`, { type: image.type }), `${folder}/thumbnail`);
      } catch {
        // sent without a picture; the customer still sees it in 3D
      }
      const doc = api.document();
      const original = sizeOf(item);
      const resizedFromSource = Boolean(dims && original && JSON.stringify(dims) !== JSON.stringify(original));
      await sendProposal(taskId, {
        item: {
          dimensions: dims ?? undefined,
          components: doc.components.length ? doc : item.components,
          material_edits: api.edits(),
          ...(item.part_poses ? { part_poses: item.part_poses } : {}),
          ...(api.removedParts?.().length ? { removed_parts: api.removedParts() } : {}),
          ...(resizedFromSource ? { resize_mode: proportional && dims && original && stretch(dims, original) < 1.001 ? "proportional" : "independent" } : {}),
        },
        glb_url: glbUrl,
        thumbnail_url: thumbnailUrl,
        note: note.trim(),
        model_url: modelUrl,
      });
      router.push(`/tasks/${taskId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  const uploadVersion = async (file: File | undefined) => {
    if (!file || !userId || !item) return;
    if (!/\.glb$/i.test(file.name)) return setError(t("Upload a .glb file."));
    setUploading(true);
    setError(null);
    try {
      const url = await uploadPublicFile(userId, file, `proposals/${taskId}/version`);
      setModelUrl(url);
      // The new file has its own parts and look: start editing it from scratch (size kept).
      setItem({ ...item, source: { ...item.source, glb_url: url, source_glb_url: null }, material_edits: {}, components: undefined, removed_parts: undefined, part_poses: undefined });
      setViewKey((k) => k + 1);
      editor.current = null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUploading(false);
    }
  };

  const original = item ? sizeOf(item) : null;
  return (
    <div className={`min-h-full bg-slate-50 ${item ? "lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden" : ""}`}>
      <Header />
      <main className={`mx-auto w-full max-w-[1600px] space-y-4 px-3 py-4 sm:px-6 ${item ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:gap-3 lg:space-y-0" : ""}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href={`/tasks/${taskId}`} className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-brand-navy">
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden /> {t("Back to the request")}
          </Link>
          <span className="text-slate-300" aria-hidden>/</span>
          <p className="px-2 text-xl font-semibold tracking-tight text-brand-navy">{t("Propose changes to “{title}”", { title })}</p>
          <button
            type="button"
            disabled={busy || !item}
            onClick={() => void send()}
            className="ms-auto inline-flex items-center gap-2 rounded-xl bg-brand-amber px-5 py-2.5 text-sm font-semibold text-brand-navy shadow-sm shadow-brand-amber/30 transition hover:bg-[#e8952a] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4 rtl:-scale-x-100" aria-hidden />} {t("Send to the customer")}
          </button>
        </div>
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}
        {!item && !error && <p className="text-sm text-slate-500">{t("Loading…")}</p>}
        {item && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
            <span className="me-auto text-slate-600">
              {modelUrl ? t("Your new version is loaded. Edit it here if needed, then send it.") : t("Rework the model in your 3D tool: download it, then upload the new version.")}
            </span>
            {current && (
              <a href={current} download className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-brand-navy hover:bg-slate-50">
                <Download className="size-4" aria-hidden /> {t("Download current model")}
              </a>
            )}
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 font-semibold text-white hover:bg-brand-navy/90 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-amber ${uploading || busy ? "pointer-events-none opacity-60" : ""}`}>
              {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
              {modelUrl ? t("Upload another version") : t("Upload new version (.glb)")}
              <input type="file" accept=".glb,model/gltf-binary" className="sr-only" onChange={(e) => { void uploadVersion(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>
        )}
        {item && (
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
            woodVendor={userId}
            woodModel={item.source.model_id}
            actions={
              <div className="space-y-3">
                <DimensionFields dims={dims} original={original} unit={unit} proportional={proportional} onProportional={setProportional} onUnit={setUnit} onChange={setDims} />
                <label className="block rounded-2xl border border-slate-200/80 bg-white p-3 text-sm shadow-sm">
                  <span className="font-medium text-brand-navy">{t("Note to the customer")}</span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder={t("What you changed and why: a size that fits better, a sturdier wood…")}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                  <span className="mt-1 block text-[11px] text-slate-500">{t("The customer sees your version beside theirs and accepts or rejects it. Sending again replaces your open proposal.")}</span>
                </label>
              </div>
            }
          />
        )}
      </main>
    </div>
  );
}
