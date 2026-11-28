"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import type { NoteKind } from "@/lib/vendor/verdict";
import { Button } from "@/components/ui/button";
import { modelNotes, rebuildAtSizes, regeneratePart, repairPart, type HybridDocument, type HybridPart } from "@/lib/vendor/hybrid";

const NOTE_LABEL: Record<NoteKind, string> = { movement: "how doors and drawers open", material: "materials", dimension: "sizes", estimate: "parts not seen in the photo" };

/** The parts of a model rebuilt from its photo, for the vendor to review: what each one is, how it was made, whether
 * it is estimated, its material (change it in the editor's material panel), the model's notes, and per-part actions:
 * repair one part, regenerate one complex part. Confirmed sizes rebuild the model without a new photo reading. */
export function ComponentReview({ modelId, glbUrl, sourceImageUrl, doc, subject, size, onChange }: {
  modelId: string;
  glbUrl: string;
  sourceImageUrl: string | null;
  doc: HybridDocument;
  subject: { category: string; kind?: string };
  /** The sizes in the form (metres); null while not filled. */
  size: { width: number | null; height: number | null; depth: number | null };
  onChange: (next: { glbUrl: string; components: HybridDocument }) => Promise<void> | void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parts = doc.components as HybridPart[];
  const generated = doc.pendingComponents ?? [];
  const failed = generated.filter((p) => p.status === "failed");
  const notes = modelNotes(doc);

  const run = async (key: string, action: () => Promise<{ glbUrl: string; components: HybridDocument; repairs?: string[] }>) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const next = await action();
      await onChange(next);
      if (next.repairs) setNote(next.repairs.length ? t("Repaired.") : t("Nothing to repair on this part."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };
  const canRebuild = Boolean(sourceImageUrl && size.width && size.height);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 text-sm" aria-label={t("Review the detected components")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{t("Review the detected components")}</h2>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${doc.sizeSource === "vendor" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {doc.sizeSource === "vendor" ? t("Sizes confirmed by you") : t("Sizes estimated from the photo")}
        </span>
      </div>
      {doc.sizeSource !== "vendor" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>{t("Enter the real width, height and depth above, then:")}</span>
          <Button type="button" size="sm" variant="outline" disabled={!canRebuild || Boolean(busy)}
            onClick={() => void run("rebuild", () => rebuildAtSizes(modelId, sourceImageUrl!, doc, subject, { width: size.width!, height: size.height!, depth: size.depth }))}>
            {busy === "rebuild" ? t("Rebuilding…") : t("Rebuild at these sizes")}
          </Button>
        </div>
      )}
      {notes.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
          <summary className="cursor-pointer font-medium">{t("Model notes")}</summary>
          <p className="mt-1">{t("Some materials, dimensions and movements were estimated from the reference image. You can adjust them if needed.")}</p>
          <p className="mt-1 text-slate-600">{t("Estimated:")} {notes.map((kind) => t(NOTE_LABEL[kind])).join(t(", "))}</p>
          <p className="mt-1 text-slate-500">{t("These notes do not prevent saving or publishing.")}</p>
        </details>
      )}
      {failed.length > 0 && (
        // Optional: a decorative part not generated yet can be tried again; nothing waits on it.
        <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
          {failed.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
              <span><bdi>{p.name}</bdi>: {t("not generated yet (optional)")}</span>
              <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void run(`regen:${p.id}`, () => regeneratePart(modelId, glbUrl, doc, p.id))}>
                {busy === `regen:${p.id}` ? t("Generating…") : t("Regenerate this part")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ul className="divide-y divide-slate-100">
        {parts.map((part) => {
          const complex = generated.find((g) => g.id === part.id);
          return (
            <li key={part.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="size-4 shrink-0 rounded border border-slate-300" style={{ background: part.material?.color ?? "#ddd" }} aria-hidden />
              <span className="min-w-0 flex-1">
                <bdi className="font-medium">{part.name}</bdi>
                <span className="ms-2 text-xs text-slate-500">
                  {part.generation === "meshy" ? t("Generated shape") : t("Built panel")}
                  {part.estimated ? ` · ${t("estimated, not seen in the photo")}` : ""}
                  {part.material?.class ? ` · ${part.material.class.replace(/_/g, " ")}` : ""}
                </span>
              </span>
              <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void run(`repair:${part.id}`, () => repairPart(modelId, glbUrl, doc, part.id))}>
                {busy === `repair:${part.id}` ? t("Checking…") : t("Repair")}
              </Button>
              {complex && (
                <Button type="button" size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void run(`regen:${part.id}`, () => regeneratePart(modelId, glbUrl, doc, part.id))}>
                  {busy === `regen:${part.id}` ? t("Generating…") : t("Regenerate")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">{t("To change a material, select the part in the 3D view and pick a new finish; it is saved with the model.")}</p>
      {note && <p className="text-xs text-emerald-800" role="status">{note}</p>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
    </section>
  );
}
