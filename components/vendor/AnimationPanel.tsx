"use client";

import { useState } from "react";
import { ChevronDown, DoorOpen, Pause, Play, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  enabledAnimations, manualAnimation, problems, withDirection, withHinge, type AnimationFlag,
  type AnimationConfig, type Direction, type Hinge, type Openness, type PartAnimation,
} from "@/lib/vendor/animation";
import type { Box3, Mesh } from "three";

type Part = { id: string; name: string; nameAr?: string | null; mesh: Mesh };
const HINGE_LABEL: Record<Hinge, string> = { left: "Left edge", right: "Right edge", top: "Top edge", bottom: "Bottom edge", back: "Back edge", front: "Front edge" };
const DIRECTION_LABEL: Record<Direction, string> = { front: "Out to the front", back: "In to the back", left: "To the left", right: "To the right", up: "Up", down: "Down" };
const field = "w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs";

/** Movable parts: the question, the detected animations and their controls. `edit`: the vendor can correct them
 * (enable, hinge, angle, direction, distance, add, remove); otherwise only open and close. */
export function AnimationPanel({
  config, detected, onChange, parts, boxOf, target, onTarget, edit, onRebuild,
}: {
  config: AnimationConfig;
  /** What the generation detected: Reset goes back to it. */
  detected: AnimationConfig | null;
  onChange: (config: AnimationConfig) => void;
  parts: Part[];
  /** A part's box in model coordinates (pivots and travel). */
  boxOf: (mesh: Mesh) => Box3;
  target: Openness;
  onTarget: (target: Openness) => void;
  edit: boolean;
  /** Replace an irregular part with a clean flat panel (the editor's copy only). */
  onRebuild?: (partId: string) => void;
}) {
  const t = useT();
  const ar = t("Part") === "جزء";
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  // Folded to its header in the editor when there are many (the parts list keeps its room); open on product pages.
  const [folded, setFolded] = useState(() => edit && config.animations.length > 3);
  const shown = enabledAnimations(config);
  const label = (a: { label: string; labelAr?: string | null }) => (ar && a.labelAr) || a.label;
  const set = (id: string, next: PartAnimation) => onChange({ ...config, source: "manual", animations: config.animations.map((a) => (a.id === id ? { ...next, issues: problems(next, parts) } : a)) });
  const all = (value: number) => onTarget(Object.fromEntries(shown.map((a) => [a.id, value])));
  const preview = () => {
    all(1);
    setTimeout(() => all(0), Math.max(...shown.map((a) => a.duration), 0.5) * 1000 + 600);
  };
  const part = (id: string) => parts.find((p) => p.id === id);
  /** A movement detected in the photo with no separate mesh of its own: the vendor names the part that is it. */
  const assign = (flag: AnimationFlag, partId: string) => {
    const p = part(partId);
    if (!p) return;
    const box = boxOf(p.mesh);
    let next: PartAnimation = { ...manualAnimation(p.id, flag.label, box), labelAr: flag.labelAr ?? p.nameAr };
    if (flag.motion === "slide" || flag.motion === "extend" || flag.motion === "retract") next = withDirection(next, flag.motion === "retract" ? "back" : "front", (box.max.z - box.min.z) || 0.3);
    else if (flag.motion === "fold") next = withHinge(next, "bottom", box);
    else if (flag.motion === "lift") next = withHinge(next, "back", box);
    onChange({ ...config, answer: "yes", source: "manual", movable: true, flagged: config.flagged.filter((f) => f !== flag), animations: [...config.animations, { ...next, issues: problems(next, parts) }] });
    setOpen(next.id);
  };
  const needCheck = config.animations.filter((a) => a.issues.length).length + config.flagged.length;

  if (!edit && !shown.length) return null;
  return (
    <section className="space-y-2 rounded-2xl border border-slate-200/80 bg-white p-3 text-sm shadow-sm">
      {/* A header that folds the panel: in the editor it shares the column with the parts list. */}
      <button type="button" onClick={() => setFolded((f) => !f)} aria-expanded={!folded} className="flex w-full items-center gap-2 text-start text-[13px] font-semibold text-brand-navy">
        <DoorOpen className="size-4 shrink-0 text-brand-amber" aria-hidden />
        <span className="flex-1">{t("Movable parts")}</span>
        {shown.length > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium tabular-nums text-slate-500">{shown.length}</span>}
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition-transform ${folded ? "" : "rotate-180"}`} aria-hidden />
      </button>
      {!folded && <>
      {edit && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-600">{t("Does this object have movable or interactive parts?")}</p>
          <div className="flex gap-1.5" role="radiogroup">
            {(["yes", "no"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={config.answer === v} onClick={() => { onChange({ ...config, answer: v }); if (v === "no") all(0); }}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold ring-1 ${config.answer === v ? "bg-brand-navy text-white ring-brand-navy" : "text-slate-600 ring-slate-200 hover:bg-slate-50"}`}>
                {t(v === "yes" ? "Yes" : "No")}
              </button>
            ))}
          </div>
          <p className="text-[11px] tabular-nums text-slate-500">
            {t("Detected {d} · moving {m} · need a check {c}", { d: config.animations.length + config.flagged.filter((f) => !f.component).length, m: shown.length, c: needCheck })}
          </p>
          {config.answer == null && <p className="text-[11px] text-slate-500">{config.animations.length ? t("{n} detected automatically. Check them below.", { n: config.animations.length }) : t("None detected: the object stays static unless you add one.")}</p>}
        </div>
      )}
      {config.answer !== "no" && (
        <>
          {shown.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => all(1)} className="rounded-lg bg-brand-amber px-2.5 py-1 text-xs font-semibold text-brand-navy">{t("Open all")}</button>
              <button type="button" onClick={() => all(0)} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-brand-navy ring-1 ring-slate-200">{t("Close all")}</button>
              {edit && <button type="button" onClick={preview} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-brand-navy ring-1 ring-slate-200"><Play className="size-3" aria-hidden />{t("Preview")}</button>}
              {edit && detected && (
                <button type="button" onClick={() => { all(0); onChange({ ...detected, answer: config.answer }); }} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                  <RotateCcw className="size-3" aria-hidden />{t("Reset")}
                </button>
              )}
            </div>
          )}
          <ul className="space-y-1.5">
            {(edit ? config.animations : shown).map((a) => {
              const isOpen = (target[a.id] ?? 0) > 0;
              const mesh = part(a.component)?.mesh;
              return (
                <li key={a.id} className="rounded-xl border border-slate-100 p-2">
                  <div className="flex items-center gap-2">
                    {edit && <input type="checkbox" checked={a.enabled} onChange={(e) => set(a.id, { ...a, enabled: e.target.checked })} aria-label={t("Animate {name}", { name: label(a) })} className="size-3.5 accent-[#f2a33a]" />}
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{label(a)}</span>
                    <button type="button" disabled={!a.enabled} onClick={() => onTarget({ ...target, [a.id]: isOpen ? 0 : 1 })} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold text-brand-navy ring-1 ring-slate-200 disabled:opacity-40">
                      {isOpen ? <Pause className="size-3" aria-hidden /> : <Play className="size-3" aria-hidden />}{t(isOpen ? "Close" : "Open")}
                    </button>
                    {edit && (
                      <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} aria-label={t("Adjust {name}", { name: label(a) })} className="rounded-md p-0.5 text-slate-400 hover:text-brand-navy">
                        <ChevronDown className={`size-4 transition-transform ${open === a.id ? "rotate-180" : ""}`} aria-hidden />
                      </button>
                    )}
                  </div>
                  {a.issues.length > 0 && <p className="mt-1 flex gap-1 text-[11px] text-amber-700"><TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />{a.issues.map((i) => t(i)).join(" ")}</p>}
                  {edit && onRebuild && a.issues.some((i) => i.startsWith("An irregular piece")) && (
                    <button type="button" onClick={() => onRebuild(a.component)} className="mt-1 rounded-md px-2 py-0.5 text-[11px] font-semibold text-brand-navy ring-1 ring-slate-200 hover:bg-slate-50">{t("Rebuild as a flat panel")}</button>
                  )}
                  {edit && open === a.id && mesh && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                      <label className="col-span-2 space-y-0.5">{t("Movement")}
                        <select className={field} value={a.type} onChange={(e) => set(a.id, e.target.value === "rotation" ? withHinge(a, a.hinge ?? "left", boxOf(mesh)) : withDirection(a, a.direction ?? "front", boxOf(mesh).max.z - boxOf(mesh).min.z || 0.3))}>
                          <option value="rotation">{t("Turns on a hinge")}</option>
                          <option value="translation">{t("Slides")}</option>
                        </select>
                      </label>
                      {a.type === "rotation" ? (
                        <>
                          <label className="space-y-0.5">{t("Hinge (pivot)")}
                            <select className={field} value={a.hinge ?? "left"} onChange={(e) => set(a.id, withHinge(a, e.target.value as Hinge, boxOf(mesh)))}>
                              {(Object.keys(HINGE_LABEL) as Hinge[]).map((h) => <option key={h} value={h}>{t(HINGE_LABEL[h])}</option>)}
                            </select>
                          </label>
                          <label className="space-y-0.5">{t("Angle (°)")}
                            <input type="number" min={5} max={180} className={field} value={Math.abs(a.to ?? 0)} onChange={(e) => set(a.id, { ...a, to: Math.sign(a.to || -1) * Math.min(180, Math.max(5, Number(e.target.value) || 0)) })} />
                          </label>
                          <label className="col-span-2 flex items-center gap-1.5">
                            <input type="checkbox" checked={(a.to ?? 0) > 0} onChange={() => set(a.id, { ...a, to: -(a.to ?? 0) })} className="size-3 accent-[#f2a33a]" />{t("Turn the other way")}
                          </label>
                        </>
                      ) : (
                        <>
                          <label className="space-y-0.5">{t("Direction")}
                            <select className={field} value={a.direction ?? "front"} onChange={(e) => set(a.id, withDirection(a, e.target.value as Direction, Math.abs(a.distance ?? 0.3)))}>
                              {(Object.keys(DIRECTION_LABEL) as Direction[]).map((d) => <option key={d} value={d}>{t(DIRECTION_LABEL[d])}</option>)}
                            </select>
                          </label>
                          <label className="space-y-0.5">{t("Distance (cm)")}
                            <input type="number" min={1} max={300} className={field} value={Math.round(Math.abs(a.distance ?? 0) * 100)} onChange={(e) => set(a.id, withDirection(a, a.direction ?? "front", Math.min(3, Math.max(0.01, (Number(e.target.value) || 0) / 100))))} />
                          </label>
                        </>
                      )}
                      <fieldset className="col-span-2 space-y-1">
                        <legend className="mb-1">{t("Moves with it (handles, trim, decorations)")}</legend>
                        <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
                          {parts.filter((p) => p.id !== a.component && !config.animations.some((o) => o.component === p.id || (o.id !== a.id && o.follow.includes(p.id)))).map((p) => (
                            <label key={p.id} className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 ring-1 ${a.follow.includes(p.id) ? "bg-brand-amber-soft ring-brand-amber" : "ring-slate-200"}`}>
                              <input type="checkbox" className="size-3 accent-[#f2a33a]" checked={a.follow.includes(p.id)} onChange={(e) => set(a.id, { ...a, follow: e.target.checked ? [...a.follow, p.id] : a.follow.filter((id) => id !== p.id) })} />
                              {(ar && p.nameAr) || p.name}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <label className="space-y-0.5">{t("Duration (s)")}
                        <input type="number" min={0.2} max={3} step={0.1} className={field} value={a.duration} onChange={(e) => set(a.id, { ...a, duration: Math.min(3, Math.max(0.2, Number(e.target.value) || 0.8)) })} />
                      </label>
                      <button type="button" onClick={() => onChange({ ...config, source: "manual", animations: config.animations.filter((x) => x.id !== a.id) })} className="inline-flex items-center justify-center gap-1 self-end rounded-lg px-2 py-1 text-red-700 ring-1 ring-red-200 hover:bg-red-50">
                        <Trash2 className="size-3" aria-hidden />{t("Remove")}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {edit && (
            <div className="flex gap-1.5">
              <select className={field} value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={t("Part to animate")}>
                <option value="">{t("Add a movable part…")}</option>
                {parts.filter((p) => !config.animations.some((a) => a.component === p.id)).map((p) => <option key={p.id} value={p.id}>{(ar && p.nameAr) || p.name}</option>)}
              </select>
              <button type="button" disabled={!adding} onClick={() => {
                const p = part(adding);
                if (!p) return;
                const next = manualAnimation(p.id, p.name, boxOf(p.mesh));
                onChange({ ...config, answer: "yes", source: "manual", movable: true, animations: [...config.animations, { ...next, labelAr: p.nameAr, issues: problems(next, parts) }] });
                setAdding("");
                setOpen(next.id);
              }} aria-label={t("Add")} className="rounded-lg bg-brand-navy px-2 text-white disabled:opacity-40"><Plus className="size-4" aria-hidden /></button>
            </div>
          )}
          {edit && config.flagged.length > 0 && (
            <details className="text-[11px] text-slate-600">
              <summary className="cursor-pointer font-medium text-amber-700">{t("{n} movements need a check", { n: config.flagged.length })}</summary>
              <ul className="mt-1 space-y-1.5">
                {config.flagged.map((f, i) => (
                  <li key={i} className="space-y-1">
                    <p><b>{label(f)}</b>: {t(f.reason)}</p>
                    {!f.component && (
                      // No mesh of its own was matched: the vendor points at the part that is it (or leaves it static).
                      <select className={field} value="" onChange={(e) => e.target.value && assign(f, e.target.value)} aria-label={t("Assign {name} to a part", { name: label(f) })}>
                        <option value="">{t("Assign to a part…")}</option>
                        {parts.filter((p) => !config.animations.some((a) => a.component === p.id || a.follow.includes(p.id))).map((p) => <option key={p.id} value={p.id}>{(ar && p.nameAr) || p.name}</option>)}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {edit && config.interior && <p className="text-[11px] text-slate-500">{t(config.interior.note)}</p>}
        </>
      )}
      </>}
    </section>
  );
}
