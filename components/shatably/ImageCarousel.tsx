"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Image carousel: swipe / scroll-snap on touch, arrows on hover, dots, and thumbnails when there are
 * several. Hovering an image zooms in under the pointer. Images are contained (never cropped), on a checkerboard when `checker` (transparent cut-outs).
 */
export function ImageCarousel({ images, alt, className = "", checker = false, thumbs = true }: { images: string[]; alt: string; className?: string; checker?: boolean; thumbs?: boolean }) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const next = (i + images.length) % images.length;
    // RTL: scrollLeft runs 0 → negative.
    const rtl = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    el.scrollTo({ left: rtl * next * el.clientWidth, behavior: "smooth" });
  };
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setIndex(Math.round(Math.abs(el.scrollLeft) / Math.max(1, el.clientWidth)));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  const bg = checker ? "bg-[length:16px_16px] [background-image:repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)]" : "bg-slate-100";
  if (!images.length) return <div className={`flex items-center justify-center rounded-xl text-xs text-slate-400 ${bg} ${className}`}>{t("No photo")}</div>;

  return (
    <div className="space-y-2">
      <div className={`group relative overflow-hidden rounded-xl ring-1 ring-slate-200/70 ${className}`}>
        <div ref={track} className="flex size-full snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {images.map((src, i) => (
            <div key={src + i} className={`size-full shrink-0 snap-center overflow-hidden ${bg}`}>
              {/* Hover zoom follows the pointer (Tailwind's hover: only applies on mouse devices, so touch keeps swiping). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={i === 0 ? alt : `${alt}, variant ${i + 1}`}
                className="size-full cursor-zoom-in object-contain transition-transform duration-200 ease-out hover:scale-[2.2]"
                draggable={false}
                onMouseMove={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.transformOrigin = `${((e.clientX - box.left) / box.width) * 100}% ${((e.clientY - box.top) / box.height) * 100}%`;
                }}
              />
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <>
            {([-1, 1] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                aria-label={dir < 0 ? t("Previous image") : t("Next image")}
                onClick={() => go(index + dir)}
                className={`absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-md transition-opacity hover:text-brand-navy sm:opacity-0 sm:group-hover:opacity-100 ${dir < 0 ? "start-2" : "end-2"}`}
              >
                {dir < 0 ? <ChevronLeft className="rtl:-scale-x-100 size-4" /> : <ChevronRight className="rtl:-scale-x-100 size-4" />}
              </button>
            ))}
            <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
              {images.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-brand-amber" : "w-1.5 bg-white/80 shadow"}`} />
              ))}
            </div>
            <span className="absolute end-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium tabular-nums text-white">
              {index + 1} / {images.length}
            </span>
          </>
        )}
      </div>
      {thumbs && images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label={t("Variants")}>
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              aria-label={t("Show image {n}", { n: i + 1 })}
              aria-pressed={i === index}
              onClick={() => go(i)}
              className={`size-12 shrink-0 overflow-hidden rounded-lg ring-2 transition ${i === index ? "ring-brand-amber" : "ring-transparent hover:ring-slate-200"} ${bg}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
