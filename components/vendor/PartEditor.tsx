"use client";

import { useT, type T } from "@/lib/i18n";
import { useState, type ReactNode } from "react";
import { MaterialPicker } from "./MaterialPicker";
import { ChevronDown, MousePointerClick, Pencil, Redo2, RotateCcw, Search, Trash2, Undo2 } from "lucide-react";
import type { MaterialEdit, PartInfo } from "@/lib/vendor/parts";

/** "Seat Cushion 2" → "وسادة المقعد 2": the part word is translated, the number kept. Vendor names show as typed. */
export function partLabel(t: T, name: string): string {
  const match = /^(.*?)(?:\s+(\d+))?$/.exec(name);
  const base = match?.[1] || name;
  return match?.[2] ? `${t(base)} ${match[2]}` : t(base);
}

export function PartList({
  parts,
  selected,
  limits,
  onSelect,
  onRename,
  hidden,
  onToggle,
  onRemove,
  canRemove,
  removedCount = 0,
  onRestore,
}: {
  parts: PartInfo[];
  selected: string | null;
  limits?: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  /** With `onToggle`: a checkbox per part shows / hides it in the 3D view. */
  hidden?: Set<string>;
  onToggle?: (id: string, shown: boolean) => void;
  /** Removes a part from the model (not only from the view); `canRemove` says which can be cut out of the file. */
  onRemove?: (id: string) => void;
  canRemove?: (id: string) => boolean;
  removedCount?: number;
  onRestore?: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // the part being renamed in place
  const shown = parts.filter((p) => partLabel(t, p.name).toLowerCase().includes(query.trim().toLowerCase()));
  return (
    // Grows to the space it is given: in a full-height panel only the list scrolls (its header and notes stay put).
    <aside className="flex min-h-0 flex-col rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <p className="text-[13px] font-semibold tracking-tight text-brand-navy">{t("Parts")}</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-500">{parts.length}</span>
      </div>
      <div className="relative px-3">
        <Search className="pointer-events-none absolute start-5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search parts")}
          className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-2 pe-2 ps-8 text-sm outline-none transition focus:border-brand-amber focus:bg-white focus:ring-2 focus:ring-brand-amber/20"
        />
      </div>
      <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-2 [scrollbar-width:thin]">
        {shown.map((part) => {
          const active = selected === part.id;
          const off = hidden?.has(part.id);
          return (
            <li key={part.id} className={`group flex items-center gap-2 rounded-lg px-2 transition-colors ${active ? "bg-brand-amber-soft/70 ring-1 ring-brand-amber/40" : "hover:bg-slate-50"}`}>
              {onToggle && (
                <input
                  type="checkbox"
                  checked={!off}
                  onChange={(e) => onToggle(part.id, e.target.checked)}
                  aria-label={t("Show {name}", { name: partLabel(t, part.name) })}
                  className="size-4 shrink-0 cursor-pointer rounded accent-[#f2a33a]"
                />
              )}
              {editing === part.id ? (
                <input
                  autoFocus
                  defaultValue={partLabel(t, part.name)}
                  aria-label={t("Part name")}
                  onBlur={(e) => {
                    setEditing(null);
                    if (e.target.value.trim() && e.target.value.trim() !== partLabel(t, part.name)) onRename(part.id, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-brand-amber bg-white px-2 py-1 text-sm text-slate-900 outline-none ring-2 ring-brand-amber/20"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(part.id)}
                  onDoubleClick={() => setEditing(part.id)}
                  aria-current={active}
                  className={`min-w-0 flex-1 truncate py-2 text-start text-sm transition-colors ${active ? "font-semibold text-brand-navy" : "text-slate-700"} ${off ? "text-slate-400 line-through" : ""}`}
                >
                  {partLabel(t, part.name)}
                </button>
              )}
              {editing !== part.id && (
                <span className={`flex shrink-0 items-center gap-0.5 transition-opacity ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}>
                  <button type="button" onClick={() => setEditing(part.id)} title={t("Rename")} aria-label={t("Rename {name}", { name: partLabel(t, part.name) })} className="rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-brand-navy">
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                  {onRemove && (
                    <button
                      type="button"
                      disabled={canRemove ? !canRemove(part.id) : false}
                      onClick={() => window.confirm(t("Remove “{name}” from this model? It is left out of the saved model and requests. You can restore it.", { name: partLabel(t, part.name) })) && onRemove(part.id)}
                      title={canRemove && !canRemove(part.id) ? t("This part shares one mesh with others in the file, so it cannot be removed alone. Hide it instead.") : t("Remove part")}
                      aria-label={t("Remove {name}", { name: partLabel(t, part.name) })}
                      className="rounded-md p-1 text-slate-400 transition hover:bg-white hover:text-red-600 disabled:opacity-30 disabled:hover:text-slate-400"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  )}
                </span>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2 py-3 text-center text-xs text-slate-400">{t("No parts match.")}</li>}
      </ul>
      {removedCount > 0 && onRestore && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
          <span>{t("{n} removed", { n: removedCount })}</span>
          <button type="button" onClick={onRestore} className="font-medium text-brand-navy underline-offset-2 hover:underline">{t("Restore removed parts")}</button>
        </div>
      )}
      {onToggle && <p className="border-t border-slate-100 px-4 py-2.5 text-[11px] leading-snug text-slate-400">{t("Tick to show or hide a part. Double-click a name to rename it.")}</p>}
      {limits && <p className="border-t border-slate-100 px-4 py-3 text-xs leading-snug text-slate-500">{t(limits)}</p>}
    </aside>
  );
}

/** A collapsible panel section (native <details>, so keyboard and screen readers work without extra code). */
export function Section({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group border-t border-slate-100 pt-2 first:border-t-0 first:pt-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 hover:text-brand-navy [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-2 pt-1.5">{children}</div>
    </details>
  );
}

export function PartControls({
  name,
  edit,
  area,
  onLibrary,
  onPaint,
  onReset,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: {
  name: string | null;
  edit: MaterialEdit | null;
  mapping?: "uv" | "box";
  /** The selected part's surface area in m², for the material estimate. */
  area?: number | null;
  /** No longer shown (colour picking was removed); kept so callers compile. */
  onColor?: (hex: string) => void;
  /** No longer shown (finish presets were removed); kept so callers compile. */
  onPreset?: (roughness: number, metalness: number) => void;
  /** A fabric or wood picked for the part: its pattern, tile size, and the whole material edit (surface, choice). */
  onLibrary: (url: string, tile: number, patch?: MaterialEdit) => void;
  /** A paint picked for the part (a palette colour, no pattern); not offered without it. */
  onPaint?: (patch: MaterialEdit) => void;
  /** No longer shown (the pattern controls were removed: fabrics and woods lay themselves out at their real
   * size); kept so callers compile. */
  onRepeat?: (repeat: [number, number]) => void;
  onTile?: (metres: number) => void;
  onRotation?: (turns: number) => void;
  onOffset?: (offset: [number, number]) => void;
  /** No longer shown (the roughness and metal sliders were removed); kept so callers compile. */
  onRoughness?: (value: number) => void;
  onMetalness?: (value: number) => void;
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const t = useT();
  return (
    <aside className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-3 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t("Selected")}</p>
          <p className="truncate text-[15px] font-semibold tracking-tight text-brand-navy">{name ?? "—"}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" disabled={!canUndo} onClick={onUndo} title={t("Undo")} aria-label={t("Undo")} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-50 hover:text-brand-navy disabled:opacity-35">
            <Undo2 className="size-4" aria-hidden />
          </button>
          <button type="button" disabled={!canRedo} onClick={onRedo} title={t("Redo")} aria-label={t("Redo")} className="rounded-lg border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-50 hover:text-brand-navy disabled:opacity-35">
            <Redo2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>
      {!name && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-slate-500">
          <MousePointerClick className="size-6 text-slate-300" aria-hidden />
          <p className="text-sm">{t("Click a part in the 3D view or the parts list to change its texture.")}</p>
        </div>
      )}
      {name && (
        <>
          <MaterialPicker mode="fabric" edit={edit} area={area} onPick={(next) => onLibrary(next.mapUrl!, next.tile ?? 0.3, next)} />
          {onPaint && <MaterialPicker mode="paint" edit={edit} area={area} onPick={onPaint} />}
          <button type="button" onClick={onReset} className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-brand-navy">
            <RotateCcw className="size-3.5" aria-hidden /> {t("Reset material")}
          </button>
        </>
      )}
    </aside>
  );
}
