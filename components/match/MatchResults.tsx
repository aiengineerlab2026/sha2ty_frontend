"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Download, LoaderCircle, X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n";
import { stepIndex, type MatchVariation } from "@/lib/match/match";

const ZOOMS = [1, 1.5, 2, 3];

/** Backend descriptions are English, as "placement — room"; furniture placements carry a distance
 * ("30 cm to the left of the model"). Each part is translated on its own. */
function describe(text: string, t: ReturnType<typeof useT>) {
  return text
    .split(" — ")
    .map((part) => {
      const m = /^(\d+) cm (.+)$/.exec(part);
      return m ? t(`{n} cm ${m[2]}`, { n: m[1] }) : t(part);
    })
    .join(" — ");
}

/**
 * Full-screen result viewer: one variation at a time, fitted to the viewport (contain, never
 * cropped or stretched). Arrows, thumbnails, ← / → keys and swipes navigate; Esc or × closes.
 */
export function MatchResults({
  variations,
  warnings,
  index,
  onIndex,
  selectedId,
  onSelect,
  onClose,
  title,
}: {
  variations: MatchVariation[];
  warnings: string[];
  index: number;
  onIndex: (i: number) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  title: string;
}) {
  const t = useT();
  const rtl = useLocale() === "ar";
  const [zoom, setZoom] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  const swipe = useRef<number | null>(null);
  const current = variations[index];
  const go = (dir: 1 | -1) => {
    setZoom(1);
    onIndex(stepIndex(index, variations.length, dir));
  };

  // Lock the page behind, focus the close button, and restore both on close.
  useEffect(() => {
    const previous = document.body.style.overflow;
    const focused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      focused?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      // Arrow keys follow reading direction: in Arabic "next" is to the left.
      else if (event.key === "ArrowRight") go(rtl ? -1 : 1);
      else if (event.key === "ArrowLeft") go(rtl ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    thumbs.current?.children[index]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [index]);

  const download = async () => {
    if (!current) return;
    setDownloading(true);
    try {
      const blob = await (await fetch(current.imageUrl)).blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `match-${index + 1}.jpg` });
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  if (!current) return null;
  const selected = selectedId === current.id;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex h-dvh w-dvw flex-col overflow-hidden bg-slate-950 text-white"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
    >
      <header className="flex shrink-0 items-center gap-3 px-3 py-2.5 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold sm:text-base">{title}</h2>
          <p className="text-xs tabular-nums text-slate-400">{t("Variation {i} of {n}", { i: index + 1, n: variations.length })}</p>
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          <IconButton label={t("Zoom out")} disabled={zoom === ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}>
            <ZoomOut className="size-4" />
          </IconButton>
          <span className="w-10 text-center text-xs tabular-nums text-slate-400">{Math.round(zoom * 100)}%</span>
          <IconButton label={t("Zoom in")} disabled={zoom === ZOOMS.at(-1)} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}>
            <ZoomIn className="size-4" />
          </IconButton>
          <IconButton label={t("Reset zoom")} disabled={zoom === 1} onClick={() => setZoom(1)}>
            <RotateCcw className="size-4" />
          </IconButton>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label={t("Close")} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-amber">
          <X className="size-5" />
        </button>
      </header>

      {/* Image stage: takes all space left by the header and the strip below; zoom > 1 scrolls / pans. */}
      <div
        className="relative min-h-0 flex-1"
        onPointerDown={(e) => {
          if (zoom === 1) swipe.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (swipe.current == null) return;
          const dx = e.clientX - swipe.current;
          swipe.current = null;
          if (Math.abs(dx) > 50) go((dx < 0) !== rtl ? 1 : -1);
        }}
      >
        <div className={`size-full ${zoom > 1 ? "overflow-auto" : "flex items-center justify-center overflow-hidden px-2 sm:px-16"}`} style={{ touchAction: zoom > 1 ? "auto" : "pan-y" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={current.id}
            src={current.imageUrl}
            alt={current.description}
            draggable={false}
            className={zoom > 1 ? "max-w-none" : "size-full select-none object-contain"}
            style={zoom > 1 ? { width: `${zoom * 100}%` } : undefined}
          />
        </div>
        {variations.length > 1 && (
          <>
            <NavArrow side="start" label={t("Previous image")} disabled={index === 0} onClick={() => go(-1)} />
            <NavArrow side="end" label={t("Next image")} disabled={index === variations.length - 1} onClick={() => go(1)} />
          </>
        )}
        {selected && (
          <span className="pointer-events-none absolute start-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white shadow">
            <Check className="size-3.5" aria-hidden /> {t("Selected")}
          </span>
        )}
      </div>

      <footer className="shrink-0 space-y-2.5 px-3 pb-3 pt-2 sm:px-5">
        {variations.length > 1 && (
          <div ref={thumbs} className="mx-auto flex max-w-full justify-start gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:justify-center">
            {variations.map((v, i) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setZoom(1);
                  onIndex(i);
                }}
                aria-label={t("Show image {n}", { n: i + 1 })}
                aria-current={i === index}
                className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-lg ring-2 transition sm:h-16 sm:w-24 ${i === index ? "ring-brand-amber" : "opacity-60 ring-transparent hover:opacity-100"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.imageUrl} alt="" className="size-full object-cover" />
                {selectedId === v.id && <Check className="absolute end-1 top-1 size-4 rounded-full bg-emerald-500 p-0.5" aria-hidden />}
              </button>
            ))}
          </div>
        )}
        <p className="text-center text-sm text-slate-200">{describe(current.description, t)}</p>
        {warnings.length > 0 && <p className="mx-auto max-w-2xl text-center text-xs text-amber-300">{warnings.map((w) => t(w)).join(" ")}</p>}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => onSelect(current.id)}
            aria-pressed={selected}
            className={`inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition ${selected ? "bg-emerald-500 text-white" : "bg-white/10 text-white hover:bg-white/20"}`}
          >
            <Check className="size-4" aria-hidden /> {selected ? t("Selected") : t("Select this variation")}
          </button>
          <button type="button" onClick={() => void download()} disabled={downloading} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-amber px-4 text-sm font-semibold text-brand-navy transition hover:bg-[#e8952a] disabled:opacity-60">
            {downloading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />} {t("Download")}
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  );
}

function NavArrow({ side, label, disabled, onClick }: { side: "start" | "end"; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/25 disabled:pointer-events-none disabled:opacity-25 ${side === "start" ? "start-2 sm:start-4" : "end-2 sm:end-4"}`}
    >
      {side === "start" ? <ChevronLeft className="rtl:-scale-x-100 size-6" /> : <ChevronRight className="rtl:-scale-x-100 size-6" />}
    </button>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex size-9 items-center justify-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-30">
      {children}
    </button>
  );
}
