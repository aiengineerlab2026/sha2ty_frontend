"use client";

import { useT } from "@/lib/i18n";
import { useRef, useState } from "react";
import Link from "next/link";
import { BookmarkPlus, Check, Loader2 } from "lucide-react";
import { designForPlan, designFromPlan, savePlanVersion } from "@/lib/designs/api";

/** Planner: keep the plan as it is now in My designs (the plan's first save makes the design, later ones add a
 * version). `ensureSaved` saves the plan first and returns its id. */
export function SaveToDesigns({ ensureSaved, signedIn }: { ensureSaved: () => Promise<string | null>; signedIn: boolean }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "saving" | { id: string } | { error: string }>("idle");
  const token = useRef(crypto.randomUUID());
  if (!signedIn) return null;
  const run = async () => {
    setState("saving");
    try {
      const planId = await ensureSaved();
      if (!planId) throw new Error(t("Save the plan first."));
      const existing = await designForPlan(planId);
      const id = existing ? (await savePlanVersion(existing.id, "", token.current), existing.id) : (await designFromPlan(planId)).id;
      token.current = crypto.randomUUID();
      setState({ id });
    } catch (caught) {
      setState({ error: caught instanceof Error ? caught.message : String(caught) });
    }
  };
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <button
        type="button"
        disabled={state === "saving"}
        onClick={() => void run()}
        title={t("Keep this version of the plan in My designs")}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-brand-navy hover:bg-slate-50 disabled:opacity-60"
      >
        {state === "saving" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : typeof state === "object" && "id" in state ? <Check className="size-4 text-emerald-600" aria-hidden /> : <BookmarkPlus className="size-4" aria-hidden />}
        <span className="hidden xl:inline">{t("Save to My designs")}</span>
      </button>
      {typeof state === "object" && "id" in state && <Link href={`/designs/${state.id}`} className="text-brand-navy underline">{t("Open")}</Link>}
      {typeof state === "object" && "error" in state && <span className="max-w-48 truncate text-red-700" title={state.error}>{state.error}</span>}
    </span>
  );
}
