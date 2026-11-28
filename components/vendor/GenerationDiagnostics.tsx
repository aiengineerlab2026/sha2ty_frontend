"use client";

import { useT } from "@/lib/i18n";
import { visualModularity } from "@/lib/designs/structural";
import type { PartDocument } from "@/lib/vendor/parts";
import { Button } from "@/components/ui/button";

const STATUS_STYLE: Record<string, string> = {
  passed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  failed: "bg-red-50 text-red-800 border-red-200",
  inconclusive: "bg-amber-50 text-amber-900 border-amber-200",
};

/** How a Meshy model was made, stage by stage: the cleaned image and its check, which image was meshed, the files,
 * Auto Split's real outcome and the independent component count. "Modular" only when the final file has separate
 * meshes (visualModularity), never from what was asked for. */
export function GenerationDiagnostics({ doc, glbUrl, sourceGlbUrl, originalUrl, onRetrySplit, retrying }: {
  doc: PartDocument | null | undefined;
  glbUrl: string;
  sourceGlbUrl?: string | null;
  /** The original photo (an object URL while generating, or the saved source image). */
  originalUrl?: string | null;
  /** Shown while the conversion task is kept (right after generating) and the split was not accepted. */
  onRetrySplit?: () => void;
  retrying?: boolean;
}) {
  const t = useT();
  if (!doc?.cleaning && !doc?.split && !doc?.raw_glb_url) return null;
  const cleaning = doc.cleaning;
  const check = cleaning?.check;
  const split = doc.split;
  const modularity = visualModularity(doc);
  const used = cleaning?.used ?? (cleaning?.cleaned ? "cleaned" : cleaning ? "original" : null);
  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-slate-800">
        {t("How this model was made")}
        <span className={`ms-2 rounded-full border px-2 py-0.5 text-xs ${modularity.modular ? STATUS_STYLE.passed : STATUS_STYLE.inconclusive}`}>
          {modularity.modular ? t("Modular: {n} independent components", { n: modularity.meshes }) : t("Not modular: one fused mesh")}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        {cleaning && (
          <section className="space-y-2">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t("Image cleaning")}</span>
              {check?.status && <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[check.status] ?? ""}`}>{t(check.status)}</span>}
              {used && <span className="text-xs text-slate-600">{used === "cleaned" ? t("The cleaned image was used for 3D.") : t("The original photo was used for 3D.")}</span>}
              {check?.decision && <span className="text-xs text-slate-600">{t("Your choice:")} {t(check.decision)}</span>}
            </p>
            {cleaning.fallback && <p className="text-xs text-amber-900"><bdi>{cleaning.fallback.reason}</bdi></p>}
            {!!check?.issues?.length && <ul className="ms-5 list-disc text-xs text-red-800">{check.issues.slice(0, 4).map((i) => <li key={i} dir="ltr" className="text-start">{i}</li>)}</ul>}
            {!!check?.notes?.length && <ul className="ms-5 list-disc text-xs text-slate-600">{check.notes.slice(0, 2).map((i) => <li key={i} dir="ltr" className="text-start">{i}</li>)}</ul>}
            {(originalUrl || cleaning.image_url) && (
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                {originalUrl && (
                  <figure className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the vendor's own photo */}
                    <img src={originalUrl} alt={t("Original photo")} className="aspect-square w-full rounded-lg border border-slate-200 bg-white object-contain" />
                    <figcaption>{t("Original photo")}</figcaption>
                  </figure>
                )}
                {cleaning.image_url && (
                  <figure className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the CDN copy of Meshy's cleaned image */}
                    <img src={cleaning.image_url} alt={t("Cleaned by Meshy")} className="aspect-square w-full rounded-lg border border-slate-200 bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:16px_16px] object-contain" />
                    <figcaption>{used === "cleaned" ? t("Cleaned by Meshy (used for 3D)") : t("Cleaned by Meshy (not used)")}</figcaption>
                  </figure>
                )}
              </div>
            )}
          </section>
        )}
        <section className="space-y-1">
          <p className="font-medium">{t("Auto Split")}</p>
          {split ? (
            <>
              <p className="text-xs text-slate-700">
                {split.accepted ? t("Accepted") : t("Not used")} · {t("status")} {split.status ?? "—"} · {t("meshes")} {split.meshesBefore ?? "?"} → {split.meshesAfter ?? "?"}
                {split.taskId && <span className="text-slate-500"> · <bdi>{split.taskId}</bdi></span>}
              </p>
              {!split.accepted && !!split.issues?.length && <p className="text-xs text-red-800" dir="ltr">{split.issues[0]}</p>}
            </>
          ) : (
            <p className="text-xs text-slate-600">{t("Auto Split did not run for this model.")}</p>
          )}
          <p className="text-xs text-slate-700">{t("Independent components in the final file:")} {modularity.meshes}</p>
          {onRetrySplit && !split?.accepted && (
            <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={onRetrySplit}>
              {retrying ? t("Splitting…") : t("Retry Auto Split")}
            </Button>
          )}
        </section>
        <section className="flex flex-wrap gap-3 text-xs">
          {doc.raw_glb_url && <a className="text-brand-teal underline" href={doc.raw_glb_url} target="_blank" rel="noreferrer">{t("Raw Meshy GLB")}</a>}
          {sourceGlbUrl && split?.accepted && <a className="text-brand-teal underline" href={sourceGlbUrl} target="_blank" rel="noreferrer">{t("Before splitting")}</a>}
          <a className="text-brand-teal underline" href={glbUrl} target="_blank" rel="noreferrer">{modularity.modular ? t("Final GLB (split)") : t("Final GLB")}</a>
        </section>
      </div>
    </details>
  );
}
