"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { ClipboardPaste, CloudUpload, ImageUp, RefreshCw, X } from "lucide-react";

/**
 * Image input with two sources: a file upload, or the clipboard ("Paste" button, or Ctrl/⌘+V
 * anywhere on the page while no text field is focused).
 */
export function ImagePicker({
  value,
  onChange,
  label = "Image",
  variant = "compact",
  current,
}: {
  value: File | null;
  onChange: (file: File | null) => void;
  label?: string;
  /** "dropzone": large drag-and-drop area with a preview; "compact": a row of buttons. */
  variant?: "compact" | "dropzone";
  /** Already-saved image URL shown when no new file is chosen (editing). */
  current?: string | null;
}) {
  const t = useT();
  const [preview, setPreview] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!value) return;
    const url = URL.createObjectURL(value);
    // Object URL for the chosen image; revoked when it changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return; // let text fields paste text
      const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault();
      setHint(null);
      onChange(new File([file], file.name || `pasted.${file.type.split("/")[1] ?? "png"}`, { type: file.type }));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onChange]);

  const pasteFromClipboard = async () => {
    setHint(null);
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        onChange(new File([blob], `pasted.${type.split("/")[1] ?? "png"}`, { type }));
        return;
      }
      setHint("No image on the clipboard. Copy an image first.");
    } catch {
      // Firefox and denied permissions: the keyboard shortcut still works.
      setHint("Browser blocked clipboard access. Press Ctrl+V (⌘V on Mac) instead.");
    }
  };

  if (variant === "dropzone") {
    const shown = (value && preview) || current;
    const choose = (
      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && onChange(e.target.files[0])} />
    );
    return (
      <div className="space-y-1.5 text-sm">
        <span className="block text-[13px] font-semibold text-slate-700">{label}</span>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
            if (file) onChange(file);
          }}
          className={`relative overflow-hidden rounded-xl border-2 border-dashed transition-colors ${over ? "border-brand-amber bg-brand-amber-soft" : "border-slate-200 bg-slate-50"}`}
        >
          {shown ? (
            <div className="flex items-center gap-4 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shown} alt="" className="size-20 shrink-0 rounded-lg object-cover ring-1 ring-slate-200" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="truncate text-sm font-medium text-slate-700">{value?.name ?? t("Current image")}</p>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:text-brand-navy">
                    <RefreshCw className="size-3.5" aria-hidden /> Replace
                    {choose}
                  </label>
                  {value && (
                    <button type="button" onClick={() => onChange(null)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:text-red-600">
                      <X className="size-3.5" aria-hidden /> {t("Remove")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center gap-2 px-4 py-7 text-center">
              <span className={`flex size-11 items-center justify-center rounded-full bg-white shadow-sm ring-1 ${over ? "text-brand-amber ring-brand-amber/40" : "text-slate-400 ring-slate-200"}`}>
                <CloudUpload className="size-5" aria-hidden />
              </span>
              <span className="text-sm text-slate-600">
                <span className="font-semibold text-brand-navy">{t("Click to upload")}</span> {t("or drag and drop")}
              </span>
              <span className="text-xs text-slate-400">{t("PNG, JPG or WebP · or paste with Ctrl/⌘+V")}</span>
              {choose}
            </label>
          )}
        </div>
        <button type="button" onClick={() => void pasteFromClipboard()} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand-navy">
          <ClipboardPaste className="size-3.5" aria-hidden /> {t("Paste from clipboard")}
        </button>
        {hint && <p className="text-[11px] text-amber-700">{hint}</p>}
      </div>
    );
  }

  const button = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-brand-navy";
  return (
    <div className="space-y-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        {value && preview ? (
          <span className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="" className="size-9 rounded-lg object-cover ring-1 ring-slate-200" />
            <button
              type="button"
              aria-label={t("Remove image")}
              onClick={() => onChange(null)}
              className="absolute -end-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-slate-700 text-white"
            >
              <X className="size-2.5" />
            </button>
          </span>
        ) : null}
        <label className={`${button} cursor-pointer`}>
          <ImageUp className="size-3.5" aria-hidden /> {t("Upload")}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
        </label>
        <button type="button" className={button} onClick={() => void pasteFromClipboard()} title={t("Paste an image you copied (or press Ctrl/⌘+V)")}>
          <ClipboardPaste className="size-3.5" aria-hidden /> {t("Paste")}
        </button>
      </div>
      {hint && <p className="text-[11px] text-amber-700">{hint}</p>}
    </div>
  );
}
