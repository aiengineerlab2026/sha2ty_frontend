"use client";

import { useT } from "@/lib/i18n";
import { useEffect, type ReactNode } from "react";
import { Bug, Check, CloudAlert, Download, Footprints, Grid3x3, LoaderCircle, Plus, Hand, Redo2, Ruler, RulerDimensionLine, Save, Undo2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CameraView } from "@/lib/plan/coordinateSystem";

const VIEWS: { view: CameraView; label: string; icon: ReactNode }[] = [
  { view: "iso", label: "3D", icon: <span className="text-xs font-semibold">3D</span> },
  { view: "2d", label: "2D", icon: <span className="text-xs font-semibold">2D</span> },
  { view: "walk", label: "Walk through", icon: <Footprints /> },
];

/** Page actions shown inside the app header: plan name, status, New / Save / Export. */
export function PlanActions({
  planName,
  onPlanName,
  busy,
  saveStatus,
  onNew,
  onSave,
  onExport,
}: {
  planName: string;
  onPlanName: (name: string) => void;
  busy?: string | null;
  /** Save state, shown next to the plan name. "dirty" = changes since the last save. */
  saveStatus?: "saving" | "saved" | "failed" | "dirty" | null;
  onNew: () => void;
  onSave: () => void;
  onExport: () => void;
}) {
  const t = useT();
  // ⌘S / Ctrl+S opens Save, like a document app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  return (
    <>
      <span className="hidden h-6 w-px shrink-0 bg-slate-200 sm:block" aria-hidden />
      {/* Document-style title: reads as text, edits in place (Enter / Esc to finish). */}
      {/* Takes the free space and shrinks (title truncates) before anything can overlap the actions. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <input
          aria-label={t("Plan name")}
          // The untouched default name shows as the (translated) placeholder.
          value={planName === "Untitled plan" ? "" : planName}
          placeholder={t("Untitled plan")}
          onChange={(event) => onPlanName(event.target.value)}
          onKeyDown={(event) => (event.key === "Enter" || event.key === "Escape") && event.currentTarget.blur()}
          size={Math.max(6, Math.min(28, (planName || t("Untitled plan")).length + 1))}
          className="h-8 min-w-[4.5rem] max-w-full shrink truncate rounded-md border border-transparent bg-transparent px-2 text-[15px] font-semibold text-brand-navy outline-none transition-colors placeholder:text-slate-400 hover:bg-slate-50 focus:border-slate-200 focus:bg-white focus:ring-4 focus:ring-brand-amber/15"
        />
        {busy ? <StatusBadge tone="slate" icon={<LoaderCircle className="size-3 animate-spin" />} text={busy} /> : <SaveBadge status={saveStatus} />}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm" role="group" aria-label={t("Plan")}>
          <button
            type="button"
            onClick={onNew}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-navy"
          >
            <Plus className="size-4" aria-hidden />
            <span className="hidden lg:inline">{t("New room")}</span>
          </button>
          <span className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
          <button
            type="button"
            onClick={onSave}
            title={t("Save (⌘S)")}
            className={`relative inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors ${
              saveStatus === "dirty" ? "bg-brand-navy text-white hover:bg-brand-navy-hover" : "text-brand-navy hover:bg-slate-50"
            }`}
          >
            <Save className="size-4" aria-hidden />
            <span className="hidden lg:inline">{t("Save")}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={onExport}
          // Desktop / tablet only: on phones the header has no room for it (export is a desktop task).
          className="hidden h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-brand-navy sm:inline-flex"
        >
          <Download className="size-4" aria-hidden />
          <span className="hidden xl:inline">{t("Export GLB")}</span>
        </button>
      </div>
    </>
  );
}

function SaveBadge({ status }: { status?: "saving" | "saved" | "failed" | "dirty" | null }) {
  if (status === "saving") return <StatusBadge tone="slate" icon={<LoaderCircle className="size-3 animate-spin" />} text="Saving…" />;
  if (status === "saved") return <StatusBadge tone="green" icon={<Check className="size-3" />} text="Saved" />;
  if (status === "failed") return <StatusBadge tone="red" icon={<CloudAlert className="size-3" />} text="Not saved" />;
  if (status === "dirty") return <StatusBadge tone="amber" icon={<span className="size-1.5 rounded-full bg-amber-500" />} text="Unsaved changes" />;
  return null;
}

function StatusBadge({ tone, icon, text }: { tone: "slate" | "green" | "amber" | "red"; icon: ReactNode; text: string }) {
  const t = useT();
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
    amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
    red: "bg-red-50 text-red-700 ring-red-600/15",
  };
  return (
    <span role="status" className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ring-transparent ${tones[tone]}`}>
      <span aria-hidden className="flex items-center">
        {icon}
      </span>
      {/* Icon-only when the header is crowded; the full label from xl. */}
      <span className="hidden xl:inline">{t(text)}</span>
    </span>
  );
}

/** Floating frosted-glass toolbar over the viewport: camera views, display toggles, history. */
export function ViewportToolbar({
  view,
  showGrid,
  showDebug,
  dimensions,
  onToggleDimensions,
  measuring = false,
  onToggleMeasure,
  panning = false,
  onTogglePan,
  canUndo,
  canRedo,
  onView,
  onToggleGrid,
  onToggleDebug,
  onUndo,
  onRedo,
}: {
  view: CameraView;
  showGrid: boolean;
  showDebug?: boolean;
  dimensions: boolean;
  onToggleDimensions: () => void;
  measuring?: boolean;
  panning?: boolean;
  /** Pan tool (undefined while walking). */
  onTogglePan?: () => void;
  /** Measure the distance between two models (undefined while walking: nothing can be picked). */
  onToggleMeasure?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onView: (view: CameraView) => void;
  onToggleGrid: () => void;
  onToggleDebug?: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const t = useT();
  return (
    <div
      role="toolbar"
      aria-label={t("Viewport")}
      className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-white/60 bg-white/70 p-1 shadow-lg shadow-slate-900/10 backdrop-blur-md [scrollbar-width:none] [&>*]:shrink-0"
    >
      {VIEWS.map((v) => (
        <ToolButton key={v.view} label={v.label} active={view === v.view} onClick={() => onView(v.view)}>
          {v.icon}
        </ToolButton>
      ))}
      <Divider />
      <ToolButton label={showGrid ? t("Hide grid") : t("Show grid")} active={showGrid} onClick={onToggleGrid}>
        <Grid3x3 />
      </ToolButton>
      {view === "2d" && (
        <ToolButton label={dimensions ? t("Hide dimensions") : t("Show dimensions")} active={dimensions} onClick={onToggleDimensions}>
          <Ruler />
        </ToolButton>
      )}
      {onTogglePan && (
        <ToolButton label={panning ? t("Stop panning (H)") : t("Pan the view (H) — cancels the current action")} active={panning} onClick={onTogglePan}>
          <Hand />
        </ToolButton>
      )}
      {onToggleMeasure && (
        <ToolButton label={measuring ? t("Stop measuring") : t("Measure distance between two models")} active={measuring} onClick={onToggleMeasure}>
          <RulerDimensionLine />
        </ToolButton>
      )}
      {onToggleDebug && (
        <ToolButton label={showDebug ? t("Hide detection images") : t("Show detection images")} active={showDebug} onClick={onToggleDebug}>
          <Bug />
        </ToolButton>
      )}
      <Divider />
      <ToolButton label={t("Undo")} onClick={onUndo} disabled={!canUndo}>
        <Undo2 />
      </ToolButton>
      <ToolButton label={t("Redo")} onClick={onRedo} disabled={!canRedo}>
        <Redo2 />
      </ToolButton>
    </div>
  );
}

function ToolButton({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t(label)}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={`flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 transition-colors disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-[18px] ${
            active ? "bg-brand-navy text-white shadow-sm" : "text-slate-600 hover:bg-white hover:text-brand-navy"
          }`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {t(label)}
      </TooltipContent>
    </Tooltip>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-slate-300/70" aria-hidden />;
}
