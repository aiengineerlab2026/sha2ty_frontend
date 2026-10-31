"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Box, Footprints, FileImage, Sofa, ImagePlus, LoaderCircle, RefreshCw, Trash2, Upload } from "lucide-react";
import { useT } from "@/lib/i18n";

// Three.js only runs in the browser; the preview loads after the form.
const RoomPreview = dynamic(() => import("./RoomPreview").then((m) => m.RoomPreview), { ssr: false, loading: () => <div className="size-full animate-pulse bg-slate-100" /> });

type Mode = "room" | "plan";
const ACCEPT = ["image/png", "image/jpeg"];

// Allowed ranges (metres): what the room builder accepts, with a message when outside.
const LIMITS = {
  width: [1, 30],
  depth: [1, 30],
  height: [2, 6],
  thickness: [0.05, 0.6],
} as const;

/**
 * New floor plan: configuration on the left (upload a 2D plan, or type one rectangular room), a
 * live preview on the right (the room in 3D, or the uploaded drawing). Values are kept when
 * switching modes. `onDimensions` / `onImage` are unchanged from the previous dialog.
 */
export function RoomCreationDialog({
  onDimensions,
  onImage,
  busy,
}: {
  onDimensions: (width: number, depth: number, height: number, thickness: number) => void;
  onImage: (file: File, height: number) => void;
  busy?: string | null;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("room");
  const [values, setValues] = useState({ width: "4.0", depth: "5.0", height: "2.7", thickness: "0.15" });
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const num = (v: string) => Number(v.replace(",", "."));
  const errors = Object.fromEntries(
    (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).map((k) => {
      const v = num(values[k]);
      const [lo, hi] = LIMITS[k];
      return [k, !values[k].trim() || !Number.isFinite(v) ? t("Enter a number.") : v < lo || v > hi ? t("Between {lo} and {hi} m.", { lo, hi }) : null];
    }),
  ) as Record<keyof typeof LIMITS, string | null>;
  const roomValid = !errors.width && !errors.depth && !errors.height && !errors.thickness;
  const planValid = Boolean(file) && !errors.height;
  const set = (k: keyof typeof values) => (v: string) => setValues((cur) => ({ ...cur, [k]: v }));

  const take = (next: File | undefined) => {
    if (!next) return;
    if (!ACCEPT.includes(next.type)) return setFileError(t("Upload a PNG or JPG floor plan."));
    setFileError(null);
    setFile(next);
  };

  const submit = () => {
    if (busy) return;
    if (mode === "room" && roomValid) onDimensions(num(values.width), num(values.depth), num(values.height), num(values.thickness));
    if (mode === "plan" && planValid && file) onImage(file, num(values.height));
  };

  return (
    <section className="mx-auto grid w-full max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:min-h-[calc(100dvh-65px)] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8 lg:py-8">
      {/* Configuration */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
        className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-amber">{t("Step 1 — Set up your space")}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-brand-navy sm:text-[28px]">{t("Design your space")}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{t("Start with your floor plan or create a room from scratch.")}</p>

        <div role="radiogroup" aria-label={t("How do you want to start?")} className="mt-6 grid gap-3 sm:grid-cols-2">
          <ModeCard on={mode === "plan"} onClick={() => setMode("plan")} icon={<FileImage className="size-5" aria-hidden />} title={t("Upload 2D Floor Plan")} hint={t("Every room is built in 3D from your drawing.")} />
          <ModeCard on={mode === "room"} onClick={() => setMode("room")} icon={<Box className="size-5" aria-hidden />} title={t("Create a Room")} hint={t("Type the size of one rectangular room.")} />
        </div>

        <div key={mode} className="mt-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          {mode === "room" ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <MetreField label={t("Width")} value={values.width} onChange={set("width")} error={errors.width} />
              <MetreField label={t("Length")} value={values.depth} onChange={set("depth")} error={errors.depth} />
              <MetreField label={t("Height")} value={values.height} onChange={set("height")} error={errors.height} hint={t("Floor to ceiling.")} />
              <MetreField label={t("Wall thickness")} value={values.thickness} onChange={set("thickness")} error={errors.thickness} hint={t("Typical walls are 0.10–0.25 m.")} />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="max-w-[calc(50%-0.5rem)]">
                <MetreField label={t("Wall height")} value={values.height} onChange={set("height")} error={errors.height} hint={t("All rooms are built to this height.")} />
              </div>
              {file ? (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white text-brand-navy ring-1 ring-slate-200">
                    <FileImage className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-brand-navy">{file.name}</span>
                    <span className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  </span>
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-white hover:text-brand-navy">
                    <RefreshCw className="size-3.5" aria-hidden /> {t("Replace")}
                    <input type="file" accept={ACCEPT.join(",")} className="sr-only" onChange={(e) => take(e.target.files?.[0])} />
                  </label>
                  <button type="button" onClick={() => setFile(null)} aria-label={t("Remove")} className="flex size-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-red-600">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">{t("Drop your plan on the preview, or choose a file there.")}</p>
              )}
              {fileError && <p className="text-xs text-red-600">{fileError}</p>}
              <p className="text-xs leading-relaxed text-slate-500">{t("PNG or JPG. Scale is read from printed sizes on the drawing when possible; you can check everything before the 3D is built.")}</p>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={Boolean(busy) || (mode === "room" ? !roomValid : !planValid)}
          className="group mt-7 inline-flex h-[52px] shrink-0 lg:mb-8 w-full items-center justify-center gap-2 rounded-xl bg-brand-amber text-[15px] font-semibold text-brand-navy shadow-sm shadow-brand-amber/30 transition hover:-translate-y-px hover:bg-[#e8952a] hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-amber/30 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {busy ?? (mode === "room" ? t("Create My Room") : t("Generate 3D Floor Plan"))}
          {!busy && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" aria-hidden />}
        </button>

        {/* What happens next: fills the card's lower space with something useful. */}
        <ol className="mt-8 grid gap-3 border-t border-slate-100 pt-6 text-xs text-slate-500 sm:grid-cols-3 lg:mt-auto">
          {[
            [<Box key="b" className="size-4" aria-hidden />, t("Build it in 3D")],
            [<Sofa key="s" className="size-4" aria-hidden />, t("Furnish with real products")],
            [<Footprints key="f" className="size-4" aria-hidden />, t("Walk through and save")],
          ].map(([icon, text], i) => (
            <li key={i} className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-brand-navy">{icon}</span>
              <span className="leading-snug">
                <span className="block font-semibold text-slate-700">{t("Step {n}", { n: i + 2 })}</span>
                {text}
              </span>
            </li>
          ))}
        </ol>
      </form>

      {/* Preview */}
      <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm sm:min-h-[420px] lg:min-h-[560px]">
        {mode === "room" ? (
          <>
            {roomValid ? (
              <RoomPreview width={num(values.width)} length={num(values.depth)} height={num(values.height)} thickness={num(values.thickness)} />
            ) : (
              <div className="flex size-full items-center justify-center p-8 text-center text-sm text-slate-500">{t("Fix the highlighted sizes to see your room.")}</div>
            )}
            <span className="pointer-events-none absolute start-4 top-4 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 backdrop-blur">
              {t("Live preview · drag to rotate, scroll to zoom")}
            </span>
            {roomValid && (
              <dl className="pointer-events-none absolute bottom-4 start-4 flex gap-4 rounded-xl bg-white/90 px-4 py-2.5 text-xs shadow-sm ring-1 ring-slate-200 backdrop-blur">
                {[
                  [t("Width"), values.width],
                  [t("Length"), values.depth],
                  [t("Height"), values.height],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="font-semibold tabular-nums text-brand-navy">{num(v).toFixed(2)} {t("m")}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        ) : (
          <PlanDrop file={file} onFile={take} busy={busy} />
        )}
      </div>
    </section>
  );
}

function ModeCard({ on, onClick, icon, title, hint }: { on: boolean; onClick: () => void; icon: ReactNode; title: string; hint: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl border p-4 text-start transition duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-amber/25 ${
        on ? "border-brand-amber bg-brand-amber-soft/50 shadow-sm" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors ${on ? "bg-brand-amber text-white" : "bg-slate-100 text-slate-500"}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-brand-navy">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{hint}</span>
      </span>
    </button>
  );
}

/** Metre input: 48 px, "m" suffix inside, no spinner arrows, amber focus, error under it. */
function MetreField({ label, value, onChange, error, hint }: { label: string; value: string; onChange: (v: string) => void; error: string | null; hint?: string }) {
  const t = useT();
  const id = `metre-${label}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-semibold text-slate-700">
        {label}
      </label>
      <span className="relative block">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-note` : undefined}
          className={`h-12 w-full rounded-xl border bg-slate-50/80 pe-10 ps-4 text-[15px] tabular-nums text-brand-navy outline-none transition [appearance:textfield] focus:bg-white focus:ring-4 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
            error ? "border-red-300 focus:border-red-400 focus:ring-red-500/10" : "border-slate-200 hover:border-slate-300 focus:border-brand-amber focus:ring-brand-amber/20"
          }`}
        />
        <span className="pointer-events-none absolute end-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">{t("m")}</span>
      </span>
      {(error || hint) && (
        <p id={`${id}-note`} className={`text-xs ${error ? "text-red-600" : "text-slate-400"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** Upload side of the preview: a big drop zone with a blueprint illustration, then the plan itself. */
function PlanDrop({ file, onFile, busy }: { file: File | null; onFile: (f: File | undefined) => void; busy?: string | null }) {
  const t = useT();
  const [over, setOver] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFile(e.dataTransfer.files[0]);
      }}
      className={`absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-4 p-6 text-center transition-colors ${over ? "bg-brand-amber-soft/60" : preview ? "bg-slate-50" : "bg-[linear-gradient(#e9edf2_1px,transparent_1px),linear-gradient(90deg,#e9edf2_1px,transparent_1px)] bg-size-[24px_24px] hover:bg-slate-50"}`}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={t("Your floor plan")} className="max-h-full max-w-full rounded-lg object-contain shadow-md ring-1 ring-slate-200" />
      ) : (
        <>
          <svg viewBox="0 0 240 160" aria-hidden className="w-56 max-w-[70%] text-slate-300 sm:w-72">
            <rect x="10" y="10" width="220" height="140" rx="4" fill="#fff" stroke="currentColor" strokeWidth="5" />
            <path d="M10 85h90M100 10v60M100 100v50M150 85h80M150 85v65M170 10v45" stroke="currentColor" strokeWidth="4" fill="none" />
            <path d="M100 70a30 30 0 0 1 30 30" stroke="#F2A33A" strokeWidth="3" fill="none" strokeDasharray="5 4" />
            <rect x="30" y="30" width="45" height="28" rx="3" fill="#F2A33A" opacity="0.85" />
            <rect x="185" y="105" width="30" height="30" rx="3" fill="#94a3b8" opacity="0.7" />
          </svg>
          <span className="flex size-12 items-center justify-center rounded-full bg-white text-brand-navy shadow-sm ring-1 ring-slate-200">
            {over ? <Upload className="size-5 text-brand-amber" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />}
          </span>
          <span>
            <span className="block text-base font-semibold text-brand-navy">{t("Drop your floor plan here")}</span>
            <span className="mt-1 block text-sm text-slate-500">{t("or click to choose a PNG or JPG")}</span>
          </span>
        </>
      )}
      {busy && (
        <span className="absolute inset-x-6 bottom-6 flex items-center justify-center gap-2 rounded-xl bg-brand-navy/90 px-4 py-3 text-sm font-medium text-white shadow-lg backdrop-blur" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> {busy}
        </span>
      )}
      <input type="file" accept={ACCEPT.join(",")} className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} disabled={Boolean(busy)} />
    </label>
  );
}
