"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Eraser, Ruler } from "lucide-react";
import { Chip, PriceTag, SidebarStatus, rowClass } from "./SidebarStatus";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import type { WallPaint } from "@/lib/plan/types";
import type { Carpet, Paint, WindowItem } from "@/lib/vendor/types";
import { PaintSwatch } from "@/components/vendor/PaintLibrary";
import { tileLabel, tileSize } from "@/lib/plan/roomMaterials";

/** Active paint brush. paint null = back to the room's own finish, on whatever surface is clicked. */
export type Brush = { surface: "wall" | "floor" | "any"; paint: WallPaint | null };


/** Brush that applies this library paint (a snapshot, so plans keep rendering if the vendor edits it). */
export function brushFor(paint: Paint): Brush {
  const surface = paint.surface === "floor" ? "floor" : "wall";
  const [tile_w, tile_h] = tileSize(paint);
  return {
    surface,
    paint: {
      paint_id: paint.id,
      price: paint.price == null ? null : Number(paint.price),
      price_unit: paint.price_unit ?? "m2",
      name: paint.name,
      color: paint.color,
      texture_url: paint.texture_url,
      tile_m: Number(paint.tile_m),
      tile_w,
      tile_h,
    },
  };
}

/** Clicking a paint opens its details (onDetails); "Room default" is applied straight away (onPick). */
export function PaintPicker({
  active,
  detailId,
  onPick,
  onDetails,
}: {
  active: Brush | null;
  detailId?: string | null;
  onPick: (brush: Brush) => void;
  onDetails: (paint: Paint) => void;
}) {
  const t = useT();
  const [paints, setPaints] = useState<Paint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void supabase()
      .from("paints")
      .select("*")
      .order("name")
      .then(({ data, error: next }) => {
        if (next) setError(next.message);
        else setPaints((data ?? []) as Paint[]);
      });
  }, []);

  const section = (surface: "wall" | "floor", title: string) => {
    const list = paints.filter((p) => (p.surface ?? "wall") === surface);
    return (
      <>
        <h3 className="flex items-center justify-between px-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {title}
          <span className="font-medium normal-case tracking-normal">{list.length}</span>
        </h3>
        {list.map((paint) => {
          const selected = detailId === paint.id || (active?.surface === surface && active.paint?.paint_id === paint.id);
          return (
            <button key={paint.id} type="button" className={rowClass(selected)} onClick={() => onDetails(paint)}>
              <PaintSwatch paint={paint} className="size-12 shrink-0 rounded-lg ring-1 ring-slate-900/5 transition-transform duration-300 group-hover:scale-105" />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold leading-tight text-brand-navy">{paint.name}</span>
                  <PriceTag price={paint.price} unit={paint.price_unit ?? "m2"} />
                </span>
                <Chip icon={paint.kind === "color" ? <span className="size-2 rounded-full ring-1 ring-black/10" style={{ background: paint.color }} /> : <Ruler className="size-2.5 text-slate-400" />}>
                  {paint.kind === "color" ? paint.color.toUpperCase() : tileLabel(paint)}
                </Chip>
              </span>
            </button>
          );
        })}
        {list.length === 0 && <p className="px-1 text-xs text-slate-400">{t("None yet.")}</p>}
      </>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        <p className="px-1 pb-1 text-xs text-slate-500">{t("Click a paint or floor finish to see its details, then apply it to your apartment.")}</p>
        <button type="button" className={rowClass(active?.paint === null)} onClick={() => onPick({ surface: "any", paint: null })}>
          <span className="flex size-12 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
            <Eraser className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-brand-navy">{t("Room default")}</span>
            <span className="block text-[11px] text-slate-500">{t("Click a wall or floor to remove its finish")}</span>
          </span>
        </button>
        {section("wall", t("Walls"))}
        {section("floor", t("Floors"))}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      </div>
      <SidebarStatus count={paints.length} noun={["finish", "finishes"]} error={Boolean(error)} />
    </div>
  );
}

export function CarpetPicker({ activeId, onPick }: { activeId: string | null; onPick: (carpet: Carpet) => void }) {
  const t = useT();
  const [carpets, setCarpets] = useState<Carpet[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void supabase()
      .from("carpets")
      .select("*")
      .order("name")
      .then(({ data, error: next }) => {
        if (next) setError(next.message);
        else setCarpets((data ?? []) as Carpet[]);
      });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        <p className="px-1 pb-1 text-xs text-slate-500">{t("Click a carpet to see its details, then apply it to your apartment.")}</p>
        {carpets.map((carpet) => (
          <button key={carpet.id} type="button" className={rowClass(activeId === carpet.id)} onClick={() => onPick(carpet)}>
            <span className="size-12 shrink-0 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-900/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={carpet.image_url} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-semibold leading-tight text-brand-navy">{carpet.name}</span>
                <PriceTag price={carpet.price} unit={carpet.price_unit ?? "item"} />
              </span>
              <Chip icon={<Ruler className="size-2.5 text-slate-400" />}>
                {Number(carpet.width_m).toFixed(2)} × {Number(carpet.length_m).toFixed(2)} m
              </Chip>
            </span>
          </button>
        ))}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        {!error && carpets.length === 0 && <p className="px-1 py-6 text-center text-sm text-slate-400">{t("No carpets yet. Vendors add them under Carpets.")}</p>}
      </div>
      <SidebarStatus count={carpets.length} noun={["carpet", "carpets"]} error={Boolean(error)} />
    </div>
  );
}

/** Windows tab: vendor windows (transparent cut-outs); click one for details, then click a wall to place it. */
export function WindowPicker({ activeId, onPick }: { activeId: string | null; onPick: (win: WindowItem) => void }) {
  const t = useT();
  const [windows, setWindows] = useState<WindowItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void supabase()
      .from("windows")
      .select("*")
      .order("name")
      .then(({ data, error: next }) => {
        if (next) setError(next.message);
        else setWindows((data ?? []) as WindowItem[]);
      });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        <p className="px-1 pb-1 text-xs text-slate-500">{t("Click a window to see its details, then click a wall to place it.")}</p>
        {windows.map((win) => (
          <button key={win.id} type="button" className={rowClass(activeId === win.id)} onClick={() => onPick(win)}>
            <span className="size-12 shrink-0 overflow-hidden rounded-lg bg-[length:10px_10px] ring-1 ring-slate-900/5 [background-image:repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={win.image_url} alt="" className="size-full object-contain transition-transform duration-300 group-hover:scale-105" />
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-semibold leading-tight text-brand-navy">{win.name}</span>
                <PriceTag price={win.price} unit={win.price_unit ?? "item"} />
              </span>
              <Chip icon={<Ruler className="size-2.5 text-slate-400" />}>
                {Number(win.width_m).toFixed(2)} × {Number(win.height_m).toFixed(2)} m
              </Chip>
            </span>
          </button>
        ))}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        {!error && windows.length === 0 && <p className="px-1 py-6 text-center text-sm text-slate-400">{t("No windows yet. Vendors add them under Windows.")}</p>}
      </div>
      <SidebarStatus count={windows.length} noun={["window", "windows"]} error={Boolean(error)} />
    </div>
  );
}
