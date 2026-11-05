"use client";

import { Monitor } from "lucide-react";
import { useInApp } from "@/lib/app";
import { useT } from "@/lib/i18n";
import { PlanLayout } from "./PlanLayout";

/** The 3D planner, except inside the mobile app: it is not supported there, so the user is told to use the web. */
export function PlanGate() {
  const t = useT();
  if (!useInApp()) return <PlanLayout />;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-amber-soft text-brand-amber">
        <Monitor className="size-7" aria-hidden />
      </span>
      <h1 className="text-lg font-semibold text-brand-navy">{t("The 3D planner is on the web")}</h1>
      <p className="max-w-sm text-sm leading-relaxed text-slate-600">{t("The 3D planner is not supported in the mobile app yet. Open sha2ty on a computer or a web browser to plan your rooms.")}</p>
      <button type="button" onClick={() => history.back()} className="mt-2 h-11 rounded-xl bg-brand-navy px-5 text-sm font-semibold text-white">
        {t("Back")}
      </button>
    </div>
  );
}
