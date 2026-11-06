"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";

/** Download the request's one-page PDF report (the backend checks who may see it: customer, vendor or admin).
 * Fetched from the page, not opened as a link: the session cookies are only sent with the site's own requests
 * (a link opens the API as its own page, where the partitioned cookies are not sent). */
export function ReportButton({ taskId, className = "" }: { taskId: string; className?: string }) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/tasks/${taskId}/report?lang=${locale === "ar" ? "ar" : "en"}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : t("Could not download the report."));
      }
      const url = URL.createObjectURL(await res.blob());
      const link = Object.assign(document.createElement("a"), { href: url, download: `sha2ty-request-${taskId.slice(0, 8)}.pdf` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`inline-flex flex-col items-end gap-1 ${className}`}>
      <button
        type="button"
        disabled={busy}
        onClick={() => void download()}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-brand-navy shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />} {t("Download report (PDF)")}
      </button>
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
