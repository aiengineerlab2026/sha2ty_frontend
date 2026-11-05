"use client";

import { FileDown } from "lucide-react";
import { API } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

/** Download the request's one-page PDF report (the backend checks who may see it: customer, vendor or admin). */
export function ReportButton({ taskId, className = "" }: { taskId: string; className?: string }) {
  const t = useT();
  const locale = useLocale();
  return (
    <a
      href={`${API}/api/tasks/${taskId}/report?lang=${locale === "ar" ? "ar" : "en"}`}
      download
      className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy shadow-sm transition hover:bg-slate-50 ${className}`}
    >
      <FileDown className="size-4" aria-hidden /> {t("Download report (PDF)")}
    </a>
  );
}
