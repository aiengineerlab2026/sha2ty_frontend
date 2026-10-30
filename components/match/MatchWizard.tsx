"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Armchair, ArrowLeft, ArrowRight, Images, ImagePlus, LoaderCircle, Minus, PaintRoller, Plus, RectangleHorizontal, Wand2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { requestMatch } from "@/lib/match/api";
import { stepsFor, type MatchPosition, type MatchType, type MatchVariation, type Unit } from "@/lib/match/match";
import type { CatalogModel } from "@/lib/plan/types";
import { MatchResults } from "./MatchResults";

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

const TYPES: { id: MatchType; label: string; hint: string; icon: typeof Armchair }[] = [
  { id: "furniture", label: "Furniture", hint: "Place another piece next to this one", icon: Armchair },
  { id: "wall_paint", label: "Wall paint", hint: "Paint or texture a wall behind it", icon: PaintRoller },
  { id: "carpet", label: "Carpet", hint: "Lay a carpet underneath it", icon: RectangleHorizontal },
];

const POSITIONS: { id: MatchPosition; label: string }[] = [
  { id: "front", label: "Front" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "behind", label: "Behind" },
];


/** "Match" on a model's page: wizard → backend compositing → full-screen results (kept for reopening). */
export function MatchButton({ model }: { model: CatalogModel }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Bumped on every Match press: the wizard remounts, so it starts empty at step 1.
  const [session, setSession] = useState(0);
  const [results, setResults] = useState<{ variations: MatchVariation[]; warnings: string[]; type: MatchType } | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();

  if (!model.thumbnail) return null; // nothing to match against
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setSession((n) => n + 1);
            setOpen(true);
          }}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-navy-hover">
          <Wand2 className="size-4 text-brand-amber" aria-hidden /> {t("Match")}
        </button>
        {results && (
          <button type="button" onClick={() => setResultsOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-brand-navy">
            <Images className="size-4" aria-hidden /> {t("View results ({n})", { n: results.variations.length })}
          </button>
        )}
      </div>
      <MatchWizard
        key={session}
        open={open}
        onOpenChange={setOpen}
        model={model}
        onDone={(next) => {
          setResults(next);
          setIndex(0);
          setSelectedId(undefined);
          setOpen(false);
          setResultsOpen(true);
        }}
      />
      {results && resultsOpen && (
        <MatchResults
          title={t("Match results")}
          variations={results.variations}
          warnings={results.warnings}
          index={index}
          onIndex={setIndex}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId((cur) => (cur === id ? undefined : id))}
          onClose={() => setResultsOpen(false)}
        />
      )}
    </>
  );
}

function MatchWizard({ open, onOpenChange, model, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; model: CatalogModel; onDone: (r: { variations: MatchVariation[]; warnings: string[]; type: MatchType }) => void }) {
  const t = useT();
  const [type, setType] = useState<MatchType | null>(null);
  const [step, setStep] = useState(0);
  const [unit, setUnit] = useState<Unit>("cm");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [depth, setDepth] = useState("");
  const [modelDims, setModelDims] = useState({ w: "", d: "", h: "" });
  const [file, setFile] = useState<File | null>(null);
  const [useColor, setUseColor] = useState(false);
  const [color, setColor] = useState("#D8C9B0");
  const [tile, setTile] = useState("60");
  const [position, setPosition] = useState<MatchPosition | null>(null);
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const steps = stepsFor(type);
  const current = steps[step];
  const missing = { w: !model.width_m, d: !model.depth_m, h: !model.height_m };
  const num = (v: string) => Number(v.replace(",", "."));
  const positive = (v: string) => Number.isFinite(num(v)) && num(v) > 0;

  const valid: Record<string, boolean> = {
    type: Boolean(type),
    dimensions: positive(width) && positive(height) && (!depth || positive(depth)) && (!missing.w || positive(modelDims.w)) && (!missing.d || positive(modelDims.d)) && (!missing.h || positive(modelDims.h)),
    image: type === "wall_paint" && useColor ? /^#[0-9a-f]{6}$/i.test(color) : Boolean(file) && (type !== "wall_paint" || positive(tile)),
    position: Boolean(position),
    variations: count >= 1 && count <= 5,
  };

  const reset = () => {
    abort.current?.abort();
    setStep(0);
    setError(null);
    setBusy(false);
  };

  const generate = async () => {
    if (!type) return;
    setBusy(true);
    setPercent(0);
    setError(null);
    abort.current = new AbortController();
    try {
      const result = await requestMatch(
        {
          modelId: model.id,
          matchType: type,
          width: num(width),
          height: num(height),
          depth: depth ? num(depth) : undefined,
          unit,
          position: type === "carpet" ? undefined : (position ?? undefined),
          variationsCount: count,
          uploadedImage: type === "wall_paint" && useColor ? null : file,
          color: type === "wall_paint" && useColor ? color : undefined,
          tileSize: type === "wall_paint" && !useColor ? num(tile) : undefined,
          modelWidth: missing.w ? num(modelDims.w) : undefined,
          modelDepth: missing.d ? num(modelDims.d) : undefined,
          modelHeight: missing.h ? num(modelDims.h) : undefined,
        },
        abort.current.signal,
        (p) => setPercent((cur) => Math.max(cur, p)), // never step backwards
      );
      onDone({ ...result, type });
      setBusy(false);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? t(caught.message) : String(caught));
      setBusy(false);
    }
  };

  const dimLabels =
    type === "carpet" ? ["Carpet width", "Carpet length"] : type === "wall_paint" ? ["Wall area width", "Wall area height"] : ["Width", "Height"];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="flex max-h-[min(92dvh,52rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <div className="border-b border-slate-100 px-5 pb-3 pt-5">
          <DialogTitle className="text-lg font-semibold text-brand-navy">{t("Match with {name}", { name: model.title })}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs text-slate-500">{t("Step {i} of {n}", { i: step + 1, n: steps.length })}</DialogDescription>
          <div className="mt-3 flex gap-1" aria-hidden>
            {steps.map((s, i) => (
              <span key={s} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-brand-amber" : "bg-slate-200"}`} />
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {current === "type" && (
            <Question title={t("What would you like to match?")}>
              <div role="radiogroup" className="grid gap-3 sm:grid-cols-3">
                {TYPES.map(({ id, label, hint, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={type === id}
                    onClick={() => {
                      setType(id);
                      setPosition(null);
                    }}
                    className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-start transition ${type === id ? "border-brand-amber bg-brand-amber-soft/50 shadow-sm" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"}`}
                  >
                    <span className={`flex size-10 items-center justify-center rounded-xl ${type === id ? "bg-brand-amber text-white" : "bg-slate-100 text-slate-600"}`}>
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="text-sm font-semibold text-brand-navy">{t(label)}</span>
                    <span className="text-xs leading-relaxed text-slate-500">{t(hint)}</span>
                  </button>
                ))}
              </div>
            </Question>
          )}

          {current === "dimensions" && (
            <Question title={t("How big is it in real life?")} hint={t(type === "carpet" ? "The carpet's size on the floor." : type === "wall_paint" ? "The real size of the wall to paint." : "Depth is optional but makes the placement more accurate.")}>
              <UnitToggle unit={unit} onUnit={setUnit} />
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <NumberField label={t(dimLabels[0])} unit={unit} value={width} onChange={setWidth} required />
                <NumberField label={t(dimLabels[1])} unit={unit} value={height} onChange={setHeight} required />
                {type === "furniture" && <NumberField label={t("Depth (optional)")} unit={unit} value={depth} onChange={setDepth} />}
              </div>
              {(missing.w || missing.d || missing.h) && (
                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-800">{t("This model has no size in the catalogue. Enter it so both items are scaled correctly.")}</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    {missing.w && <NumberField label={t("Model width")} unit={unit} value={modelDims.w} onChange={(w) => setModelDims((d) => ({ ...d, w }))} required />}
                    {missing.d && <NumberField label={t("Model depth")} unit={unit} value={modelDims.d} onChange={(v) => setModelDims((d) => ({ ...d, d: v }))} required />}
                    {missing.h && <NumberField label={t("Model height")} unit={unit} value={modelDims.h} onChange={(h) => setModelDims((d) => ({ ...d, h }))} required />}
                  </div>
                </div>
              )}
            </Question>
          )}

          {current === "image" && (
            <Question title={t(type === "wall_paint" ? "Upload a texture or choose a colour" : "Upload the photo to match")}>
              {type === "wall_paint" && (
                <div className="mb-3 flex gap-2" role="radiogroup">
                  {[false, true].map((c) => (
                    <button key={String(c)} type="button" role="radio" aria-checked={useColor === c} onClick={() => setUseColor(c)} className={`h-9 rounded-lg px-3 text-sm font-medium ${useColor === c ? "bg-brand-navy text-white" : "border border-slate-200 text-slate-600"}`}>
                      {t(c ? "Solid colour" : "Texture image")}
                    </button>
                  ))}
                </div>
              )}
              {type === "wall_paint" && useColor ? (
                <div className="flex items-center gap-3">
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t("Paint colour")} className="size-14 cursor-pointer rounded-xl border border-slate-200" />
                  <input value={color} onChange={(e) => setColor(e.target.value)} aria-label={t("Hex colour")} className="h-10 w-32 rounded-xl border border-slate-200 px-3 font-mono text-sm uppercase" />
                </div>
              ) : (
                <>
                  <Upload file={file} onFile={setFile} />
                  {type === "wall_paint" && (
                    <div className="mt-3 max-w-48">
                      <NumberField label={t("One tile of the texture covers")} unit={unit} value={tile} onChange={setTile} required />
                    </div>
                  )}
                </>
              )}
            </Question>
          )}

          {current === "position" && (
            <Question title={t(type === "wall_paint" ? "Which wall?" : "Where should it go?")} hint={t("Relative to the model, as seen in its photo.")}>
              <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {POSITIONS.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={position === p.id} onClick={() => setPosition(p.id)} className={`h-12 rounded-xl border text-sm font-semibold transition ${position === p.id ? "border-brand-amber bg-brand-amber-soft/50 text-brand-navy" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {t(p.label)}
                  </button>
                ))}
              </div>
              {type === "wall_paint" && position && position !== "behind" && (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t(position === "front" ? "The wall in front of the model is behind the camera, so the wall behind it will be painted." : "Only the part of this wall that is visible in the photo can be painted.")}
                </p>
              )}
            </Question>
          )}

          {current === "variations" && (
            <Question title={t("How many variations would you like to generate?")} hint={t(type === "wall_paint" && useColor ? "A solid colour is shown from different camera angles." : "Each variation shows a different camera angle or arrangement.")}>
              <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-white p-1">
                <button type="button" aria-label={t("Less")} disabled={count <= 1} onClick={() => setCount((c) => c - 1)} className="flex size-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-30">
                  <Minus className="size-4" />
                </button>
                <output aria-live="polite" className="w-12 text-center text-2xl font-semibold tabular-nums text-brand-navy">
                  {count}
                </output>
                <button type="button" aria-label={t("More")} disabled={count >= 5} onClick={() => setCount((c) => c + 1)} className="flex size-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-30">
                  <Plus className="size-4" />
                </button>
              </div>
            </Question>
          )}

          {busy && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-slate-600">{t("Generating… this can take a minute or two")}</span>
                <span className="text-2xl font-semibold tabular-nums text-brand-navy" aria-hidden>
                  {percent}%
                </span>
              </div>
              <div role="progressbar" aria-label={t("Generating")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-brand-amber transition-[width] duration-700 ease-out" style={{ width: `${percent}%` }} />
              </div>
            </div>
          )}
          {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-600 hover:text-brand-navy disabled:invisible">
            <ArrowLeft className="rtl:-scale-x-100 size-4" aria-hidden /> {t("Back")}
          </button>
          {current === "variations" ? (
            <button type="button" onClick={() => void generate()} disabled={busy || !valid.variations} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-amber px-5 text-sm font-semibold text-brand-navy shadow-sm transition hover:bg-[#e8952a] disabled:opacity-60">
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Wand2 className="size-4" aria-hidden />}
              {busy ? t("Generating… {n}%", { n: percent }) : t("Generate")}
            </button>
          ) : (
            <button type="button" onClick={() => setStep((s) => s + 1)} disabled={!valid[current]} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-navy px-5 text-sm font-semibold text-white transition hover:bg-brand-navy-hover disabled:opacity-40">
              {t("Next")} <ArrowRight className="rtl:-scale-x-100 size-4" aria-hidden />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Question({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-base font-semibold text-brand-navy">{title}</h3>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function UnitToggle({ unit, onUnit }: { unit: Unit; onUnit: (u: Unit) => void }) {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t("Unit")} className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
      {(["cm", "m"] as const).map((u) => (
        <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => onUnit(u)} className={`h-8 rounded-md px-3 font-medium ${unit === u ? "bg-brand-navy text-white" : "text-slate-600"}`}>
          {t(u === "cm" ? "Centimetres" : "Metres")}
        </button>
      ))}
    </div>
  );
}

function NumberField({ label, unit, value, onChange, required = false }: { label: string; unit: Unit; value: string; onChange: (v: string) => void; required?: boolean }) {
  const t = useT();
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      <span className="relative block">
        <input type="number" inputMode="decimal" min="0" step="any" value={value} required={required} onChange={(e) => onChange(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/80 pe-10 ps-3 text-sm tabular-nums outline-none focus:border-brand-amber focus:bg-white focus:ring-4 focus:ring-brand-amber/15" />
        <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{t(unit)}</span>
      </span>
    </label>
  );
}

/** Drag-and-drop / click upload with preview and replace. Keeps the original file (no re-encoding). */
function Upload({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const take = (f: File | undefined) => {
    if (!f) return;
    if (!ACCEPT.includes(f.type)) return setError(t("Upload a JPG, PNG or WebP image."));
    if (f.size > MAX_BYTES) return setError(t("Images must be 15 MB or smaller."));
    setError(null);
    onFile(f);
  };
  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          take(e.dataTransfer.files[0]);
        }}
        className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed p-3 text-center transition ${drag ? "border-brand-amber bg-brand-amber-soft/40" : "border-slate-200 bg-slate-50 hover:border-slate-300"}`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="max-h-56 rounded-lg object-contain" />
        ) : (
          <>
            <ImagePlus className="size-6 text-slate-400" aria-hidden />
            <span className="text-sm font-medium text-slate-700">{t("Drop an image here or click to upload")}</span>
            <span className="text-xs text-slate-400">{t("JPG, PNG or WebP · up to 15 MB")}</span>
          </>
        )}
        <input type="file" accept={ACCEPT.join(",")} className="sr-only" onChange={(e) => take(e.target.files?.[0])} />
      </label>
      {file && (
        <p className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">{file.name}</span>
          <button type="button" onClick={() => onFile(null)} className="font-medium text-slate-600 hover:text-red-600">
            {t("Replace")}
          </button>
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
