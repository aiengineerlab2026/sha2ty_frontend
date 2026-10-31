"use client";

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, CircleAlert, CircleX, DoorOpen, Layers, LoaderCircle, Magnet, Maximize, MousePointer2, PenLine, SplitSquareHorizontal, Trash2, TriangleAlert, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { resegmentPlan } from "@/lib/plan/api";
import type { CorrectionState, LabelPx, OpeningPx, PlanGeometry, Vec2, WallPx, ZonePx } from "@/lib/plan/types";

type Tool = "select" | "wall" | "door" | "zone";
type Layer = "image" | "walls" | "rooms" | "doors" | "lowConfidence" | "invalid" | "labels";
type Selection = { type: "wall" | "opening"; id: string } | { type: "room"; id: string } | null;

const LAYERS: { key: Layer; label: string; swatch: string }[] = [
  { key: "image", label: "Drawing", swatch: "#cbd5e1" },
  { key: "walls", label: "Walls", swatch: "#1e293b" },
  { key: "rooms", label: "Rooms", swatch: "#3b82f6" },
  { key: "doors", label: "Doors & windows", swatch: "#10b981" },
  { key: "lowConfidence", label: "Low-confidence walls", swatch: "#f59e0b" },
  { key: "invalid", label: "Invalid geometry", swatch: "#ef4444" },
  { key: "labels", label: "Labels", swatch: "#334155" },
];

const TOOLS: { tool: Tool; label: string; icon: typeof MousePointer2 }[] = [
  { tool: "select", label: "Select / move", icon: MousePointer2 },
  { tool: "wall", label: "Add wall", icon: PenLine },
  { tool: "door", label: "Mark door", icon: DoorOpen },
  { tool: "zone", label: "Zone boundary", icon: SplitSquareHorizontal },
];

const KINDS = ["bedroom", "bathroom", "living", "dining", "kitchen", "patio", "closet", "hall", "laundry", "room"];

export function PlanCorrection({
  geometry,
  onConfirm,
  onCancel,
  busy,
  errors,
}: {
  geometry: PlanGeometry;
  onConfirm: (state: CorrectionState) => void;
  onCancel: () => void;
  busy?: string | null;
  errors?: string[];
}) {
  const t = useT();
  const width = geometry.image_size?.width ?? 1000;
  const height = geometry.image_size?.height ?? 700;
  const thickness = geometry.thickness_px ?? 8;

  const [walls, setWalls] = useState<WallPx[]>(geometry.walls_px ?? []);
  const [openings, setOpenings] = useState<OpeningPx[]>(geometry.openings_px ?? []);
  const [labels, setLabels] = useState<LabelPx[]>(geometry.labels ?? []);
  const [zoneLines, setZoneLines] = useState<{ start: Vec2; end: Vec2 }[]>(geometry.zone_lines ?? []);
  const [pxPerFt, setPxPerFt] = useState<string>(geometry.scale?.px_per_ft ? String(geometry.scale.px_per_ft) : "");
  const [result, setResult] = useState<PlanGeometry>(geometry);
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>("select");
  const [manhattan, setManhattan] = useState(true);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ image: true, walls: true, rooms: true, doors: true, lowConfidence: true, invalid: true, labels: true });
  const [selection, setSelection] = useState<Selection>(null);
  const [mergeWith, setMergeWith] = useState<string | null>(null);
  const [draftStart, setDraftStart] = useState<Vec2 | null>(null);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [drag, setDrag] = useState<{ id: string; end: "start" | "end" } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, w: width, h: height });
  const svg = useRef<SVGSVGElement>(null);

  const metersPerPixel = useMemo(() => {
    const v = Number(pxPerFt);
    return v > 0 ? 0.3048 / v : null;
  }, [pxPerFt]);

  const state: CorrectionState = useMemo(
    () => ({
      image_size: { width, height },
      thickness_px: thickness,
      walls_px: walls,
      openings_px: openings,
      labels,
      zone_lines: zoneLines,
      straight_lines: geometry.straight_lines,
      drawing_unit: geometry.drawing_unit,
      scale_refs: geometry.scale_refs,
      // Optional: only a scale the user typed (different from the estimate) is sent; otherwise the backend estimates.
      meters_per_pixel: metersPerPixel && Math.abs((metersPerPixel - (geometry.scale?.meters_per_pixel ?? 0)) / metersPerPixel) > 0.002 ? metersPerPixel : null,
      height: geometry.height,
      wall_thickness: geometry.wall_thickness,
    }),
    [width, height, thickness, walls, openings, labels, zoneLines, geometry, metersPerPixel],
  );

  // Live re-detection: rooms always come from the current walls, so preview and 3D agree.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (drag) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPending(true);
      try {
        const next = await resegmentPlan(state, controller.signal);
        setResult(next);
        setRequestError(null);
      } catch (caught) {
        if (!controller.signal.aborted) setRequestError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!controller.signal.aborted) setPending(false);
      }
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [state, drag]);

  const rooms = result.rooms_px ?? [];
  const zones = result.zones_px ?? [];
  const validation = result.validation ?? { ok: true, errors: [], warnings: [] };
  const scale = result.scale;

  const toImage = useCallback((event: { clientX: number; clientY: number }): Vec2 => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return [0, 0];
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  }, []);

  const snap = useCallback(
    (p: Vec2, from: Vec2 | null): Vec2 => {
      // Snap to existing wall ends first, then (optionally) force horizontal/vertical.
      const radius = thickness * 1.2;
      for (const w of walls) {
        for (const q of [w.start, w.end]) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < radius) return [q[0], q[1]];
      }
      if (manhattan && from) {
        return Math.abs(p[0] - from[0]) >= Math.abs(p[1] - from[1]) ? [p[0], from[1]] : [from[0], p[1]];
      }
      return p;
    },
    [walls, thickness, manhattan],
  );

  const onCanvasClick = (event: React.MouseEvent) => {
    if (tool === "select") return;
    const raw = toImage(event);
    const p = tool === "wall" ? snap(raw, draftStart) : raw;
    if (!draftStart) {
      setDraftStart(p);
      return;
    }
    const end = tool === "wall" || tool === "door" ? orthoIfClose(draftStart, p, manhattan) : p;
    if (Math.hypot(end[0] - draftStart[0], end[1] - draftStart[1]) > thickness) {
      if (tool === "wall") {
        const id = `u${Date.now()}`;
        setWalls((list) => [...list, { id, start: draftStart, end, thickness, orientation: orientationOf(draftStart, end), confidence: 1 }]);
      } else if (tool === "door") {
        setOpenings((list) => [...list, { id: `u${Date.now()}`, kind: "door", start: draftStart, end, thickness, evidence: "marked by user", confidence: 1 }]);
      } else {
        setZoneLines((list) => [...list, { start: draftStart, end }]);
      }
    }
    setDraftStart(null);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const p = toImage(event);
    setCursor(p);
    if (drag) {
      setWalls((list) =>
        list.map((w) => {
          if (w.id !== drag.id) return w;
          const other = drag.end === "start" ? w.end : w.start;
          const q = orthoIfClose(other, snap(p, other), manhattan);
          const next = drag.end === "start" ? { ...w, start: q } : { ...w, end: q };
          return { ...next, orientation: orientationOf(next.start, next.end) };
        }),
      );
    }
  };

  const onWheel = (event: React.WheelEvent) => {
    const [px, py] = toImage(event);
    const factor = event.deltaY > 0 ? 1.15 : 1 / 1.15;
    setView((v) => {
      const w = clamp(v.w * factor, width / 12, width * 1.5);
      const h = (w / v.w) * v.h;
      return { x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h };
    });
  };

  const selectedRoom = selection?.type === "room" ? rooms.find((r) => r.id === selection.id) : null;
  const selectedWall = selection?.type === "wall" ? walls.find((w) => w.id === selection.id) : null;
  const selectedOpening = selection?.type === "opening" ? openings.find((o) => o.id === selection.id) : null;

  const deleteSelected = () => {
    if (selection?.type === "wall") setWalls((list) => list.filter((w) => w.id !== selection.id));
    if (selection?.type === "opening") setOpenings((list) => list.filter((o) => o.id !== selection.id));
    setSelection(null);
  };

  const mergeRooms = (aId: string, bId: string) => {
    // Merging two enclosed rooms means the wall between them is not real: remove it (and its openings).
    const a = rooms.find((r) => r.id === aId);
    const b = rooms.find((r) => r.id === bId);
    if (!a || !b) return;
    const reach = thickness * 1.6;
    const between = (p: Vec2) => distanceToPolygon(p, a.polygon) <= reach && distanceToPolygon(p, b.polygon) <= reach;
    setWalls((list) => list.filter((w) => !between(midpoint(w.start, w.end))));
    setOpenings((list) => list.filter((o) => !between(midpoint(o.start, o.end))));
    setMergeWith(null);
  };

  const editZone = (zone: ZonePx, patch: Partial<LabelPx>) => {
    setLabels((list) => {
      if (zone.label_index != null && list[zone.label_index]) {
        return list.map((l, i) => (i === zone.label_index ? { ...l, ...patch } : l));
      }
      // Unlabelled zone: the edit becomes a new label at the zone's visual centre.
      const [x, y] = zone.label_point;
      return [...list, { name: zone.name, kind: zone.kind, x, y, box: [x - 1, y - 1, 2, 2], text: zone.name, dims_m: null, dims_text: null, dims_uncertain: false, ...patch }];
    });
  };

  const fontSize = Math.max(8, Math.min(14, view.w / 70));
  const roomInvalid = (id: string) => {
    const r = rooms.find((room) => room.id === id);
    return Boolean(r && (r.invalid.length || r.uncertain));
  };

  const hiddenLayers = LAYERS.filter((l) => !layers[l.key]).length;
  const problems = [...(requestError ? [requestError] : []), ...(errors ?? []), ...validation.errors];
  // Thin, zoom-independent outlines: overlays stay precise at any zoom level.
  const hair = { vectorEffect: "non-scaling-stroke" as const };

  return (
    <div className="mx-auto flex min-h-[560px] w-full max-w-7xl flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-brand-navy">{t("Correct the detected plan")}</h2>
          <p className="text-sm text-slate-500">{t("Rooms are re-detected from the walls after every edit.")}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          {pending ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> {t("Re-detecting…")}
            </>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden /> {rooms.length} rooms · {zones.length} zones
            </>
          )}
        </span>
      </header>

      {/* Editing tools (left) are separate from view controls and layer visibility (right). */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5">
        <div role="toolbar" aria-label={t("Editing tools")} className="flex items-center gap-0.5 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
          {TOOLS.map(({ tool: id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              onClick={() => {
                setTool(id);
                setDraftStart(null);
              }}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${
                tool === id ? "bg-brand-navy text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-brand-navy"
              }`}
            >
              <Icon className="size-3.5" aria-hidden />
              {t(label)}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={manhattan}
          onClick={() => setManhattan((v) => !v)}
          title={t("Snap walls to horizontal / vertical")}
          className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
            manhattan ? "border-brand-amber/60 bg-brand-amber-soft text-brand-navy" : "border-slate-200 bg-white text-slate-500 hover:text-brand-navy"
          }`}
        >
          <Magnet className="size-3.5" aria-hidden /> {t("Snap H/V")}
        </button>

        <div className="ms-auto flex items-center gap-2">
          <div className="flex items-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm">
            {[
              { label: "Zoom in", icon: ZoomIn, on: () => setView((v) => zoomed(v, 1 / 1.3)) },
              { label: "Zoom out", icon: ZoomOut, on: () => setView((v) => zoomed(v, 1.3)) },
              { label: "Fit to drawing", icon: Maximize, on: () => setView({ x: 0, y: 0, w: width, h: height }) },
            ].map(({ label, icon: Icon, on }, i) => (
              <button
                key={label}
                type="button"
                aria-label={t(label)}
                title={t(label)}
                onClick={on}
                className={`flex size-8 items-center justify-center text-slate-600 transition-colors hover:bg-slate-100 hover:text-brand-navy ${i ? "border-s border-slate-200" : ""}`}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:text-brand-navy data-[state=open]:border-brand-navy/30 data-[state=open]:text-brand-navy"
              >
                <Layers className="size-3.5" aria-hidden /> Layers &amp; overlays
                {hiddenLayers > 0 && <span className="rounded-full bg-slate-200 px-1.5 text-[10px] tabular-nums">{hiddenLayers} off</span>}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1.5">
              {LAYERS.map((layer) => (
                <label key={layer.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  <span className="inline-block size-2.5 rounded-sm ring-1 ring-black/5" style={{ background: layer.swatch }} aria-hidden />
                  <span className="flex-1">{t(layer.label)}</span>
                  <Switch checked={layers[layer.key]} onCheckedChange={() => setLayers((l) => ({ ...l, [layer.key]: !l[layer.key] }))} aria-label={layer.label} />
                </label>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_340px] lg:grid-rows-[minmax(0,1fr)]">
        <div className="relative min-h-[320px] overflow-hidden bg-[#f1f4f7] [background-image:radial-gradient(#d5dce4_1px,transparent_1px)] [background-size:16px_16px]">
          <svg
            ref={svg}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            preserveAspectRatio="xMidYMid meet"
            className={`absolute inset-0 size-full touch-none ${tool === "select" ? "cursor-default" : "cursor-crosshair"}`}
            onClick={onCanvasClick}
            onPointerMove={onPointerMove}
            onPointerUp={() => setDrag(null)}
            onPointerLeave={() => setDrag(null)}
            onWheel={onWheel}
          >
            {/* The image is drawn at its pixel size: every overlay below shares these coordinates. */}
            {layers.image && geometry.preview_image && <image href={geometry.preview_image} x={0} y={0} width={width} height={height} opacity={0.55} />}

            {layers.rooms &&
              rooms.map((room) => {
                const selected = selectedRoom?.id === room.id || mergeWith === room.id;
                const bad = layers.invalid && roomInvalid(room.id);
                return (
                  <path
                    key={room.id}
                    d={pathOf(room.polygon, room.holes)}
                    fillRule="evenodd"
                    fill={bad ? "#ef444414" : selected ? "#3b82f62e" : "#3b82f612"}
                    stroke={bad ? "#ef4444" : "#3b82f6"}
                    strokeOpacity={selected || bad ? 0.95 : 0.55}
                    strokeWidth={selected ? 2 : 1.25}
                    strokeDasharray={bad ? "5 4" : undefined}
                    {...hair}
                    className="transition-[fill] duration-150"
                    onClick={(event) => {
                      if (tool !== "select") return;
                      event.stopPropagation();
                      if (event.shiftKey && selectedRoom && selectedRoom.id !== room.id) setMergeWith(room.id);
                      else {
                        setSelection({ type: "room", id: room.id });
                        setMergeWith(null);
                      }
                    }}
                  />
                );
              })}

            {layers.rooms &&
              zones
                .filter((z) => z.boundary !== "wall")
                .map((z) => (
                  <polygon
                    key={z.id}
                    points={z.polygon.map((p) => p.join(",")).join(" ")}
                    fill="none"
                    stroke={z.boundary === "inferred" ? "#f59e0b" : "#3b82f6"}
                    strokeOpacity={0.8}
                    strokeDasharray="4 4"
                    strokeWidth={1}
                    {...hair}
                    pointerEvents="none"
                  />
                ))}

            {zoneLines.map((line, index) => (
              <line key={`zl${index}`} x1={line.start[0]} y1={line.start[1]} x2={line.end[0]} y2={line.end[1]} stroke="#8b5cf6" strokeWidth={1.5} strokeDasharray="4 3" {...hair} />
            ))}

            {walls.map((wall) => {
              const low = wall.confidence < 1 || wall.orientation === "d";
              if (low ? !layers.lowConfidence : !layers.walls) return null;
              const selected = selectedWall?.id === wall.id;
              return (
                <g key={wall.id}>
                  <line
                    x1={wall.start[0]}
                    y1={wall.start[1]}
                    x2={wall.end[0]}
                    y2={wall.end[1]}
                    stroke={selected ? "#7c3aed" : low ? "#f59e0b" : "#1e293b"}
                    strokeOpacity={low && !selected ? 0.55 : 0.82}
                    strokeWidth={Math.max(3, wall.thickness * 0.8)}
                    strokeLinecap="square"
                    onClick={(event) => {
                      if (tool !== "select") return;
                      event.stopPropagation();
                      setSelection({ type: "wall", id: wall.id });
                    }}
                  />
                  {/* Low-confidence walls: a thin dashed centre line marks them without shouting. */}
                  {low && !selected && (
                    <line x1={wall.start[0]} y1={wall.start[1]} x2={wall.end[0]} y2={wall.end[1]} stroke="#b45309" strokeWidth={1} strokeDasharray="3 3" {...hair} pointerEvents="none" />
                  )}
                </g>
              );
            })}

            {layers.doors &&
              openings.map((o) => (
                <line
                  key={o.id}
                  x1={o.start[0]}
                  y1={o.start[1]}
                  x2={o.end[0]}
                  y2={o.end[1]}
                  stroke={selectedOpening?.id === o.id ? "#7c3aed" : o.kind === "window" ? "#0ea5e9" : o.kind === "opening" ? "#f59e0b" : "#10b981"}
                  strokeWidth={Math.max(3, o.thickness * 0.7)}
                  strokeOpacity={0.9}
                  strokeLinecap="round"
                  strokeDasharray={o.kind === "window" ? "5 3" : o.kind === "opening" ? "1 4" : undefined}
                  onClick={(event) => {
                    if (tool !== "select") return;
                    event.stopPropagation();
                    setSelection({ type: "opening", id: o.id });
                  }}
                />
              ))}

            {selectedWall &&
              (["start", "end"] as const).map((end) => (
                <circle
                  key={end}
                  cx={selectedWall[end][0]}
                  cy={selectedWall[end][1]}
                  r={Math.max(4, thickness * 0.7)}
                  fill="#ffffff"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  {...hair}
                  className="cursor-move"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setDrag({ id: selectedWall.id, end });
                  }}
                />
              ))}

            {draftStart && cursor && (
              <line
                x1={draftStart[0]}
                y1={draftStart[1]}
                x2={orthoIfClose(draftStart, cursor, manhattan && tool !== "zone")[0]}
                y2={orthoIfClose(draftStart, cursor, manhattan && tool !== "zone")[1]}
                stroke={tool === "wall" ? "#1e293b" : tool === "door" ? "#10b981" : "#8b5cf6"}
                strokeWidth={tool === "wall" ? thickness : 3}
                strokeOpacity={0.45}
                pointerEvents="none"
              />
            )}

            {layers.labels &&
              zones.map((z) => (
                <g key={`t${z.id}`} pointerEvents="none" fontSize={fontSize} textAnchor="middle" fontFamily="ui-sans-serif, system-ui, sans-serif">
                  <text x={z.label_point[0]} y={z.label_point[1]} fill="#172033" stroke="#ffffff" strokeWidth={3.5} strokeLinejoin="round" paintOrder="stroke" fontWeight={600}>
                    {z.name}
                  </text>
                  {z.measured_m && (
                    <text x={z.label_point[0]} y={z.label_point[1] + fontSize * 1.15} fontSize={fontSize * 0.78} fill="#64748b" stroke="#ffffff" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke">
                      {z.measured_m[0].toFixed(1)} × {z.measured_m[1].toFixed(1)} m
                    </text>
                  )}
                </g>
              ))}
          </svg>
          {tool !== "select" && (
            <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-navy/90 px-3 py-1 text-xs text-white shadow-lg backdrop-blur">
              {draftStart ? t("Click the end point") : t(tool === "zone" ? "Click the start point of the zone boundary" : tool === "door" ? "Click the start point of the door" : "Click the start point of the wall")}
            </p>
          )}
        </div>

        <aside className="flex min-h-0 flex-col gap-3 overflow-auto border-s border-slate-100 bg-slate-50/60 p-4 text-sm">
          <SelectionPanel
            wall={selectedWall}
            opening={selectedOpening}
            onDelete={deleteSelected}
            onOpeningKind={(kind) => setOpenings((list) => list.map((o) => (o.id === selectedOpening?.id ? { ...o, kind } : o)))}
          />
          {selectedRoom && mergeWith && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-xs text-slate-700">
              {t("Merge")} <b>{selectedRoom.name}</b> {t("with")} <b>{rooms.find((r) => r.id === mergeWith)?.name}</b>{t("? This removes the wall between them.")}
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" onClick={() => mergeRooms(selectedRoom.id, mergeWith)}>
                  {t("Merge")}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setMergeWith(null)}>
                  {t("Cancel")}
                </Button>
              </div>
            </div>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{t("Scale")}</h3>
            <div className="flex items-center gap-2">
              <Input className="h-9 w-24 rounded-lg tabular-nums" inputMode="decimal" value={pxPerFt} onChange={(e) => setPxPerFt(e.target.value)} />
              <span className="text-xs text-slate-500">px per foot {metersPerPixel ? `· ${(1 / metersPerPixel).toFixed(1)} px/m` : ""}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {scale?.source === "printed dimensions"
                ? t("From {n} printed room sizes · confidence {p}%", { n: scale.candidates.filter((c) => c.inlier).length, p: Math.round((scale.confidence ?? 0) * 100) })
                : scale?.source === "user"
                  ? t("Entered manually")
                  : t("Estimated from {refs} · approximate, confidence {p}%", { refs: (scale?.source ?? "heuristic").split(" + ").map((s) => t(s)).join(" + "), p: Math.round((scale?.confidence ?? 0) * 100) })}
              {scale && !scale.uniform ? " · horizontal and vertical scales differ" : ""}
            </p>
            <p className="mt-1 text-[11px] text-slate-400">{t("Optional: type px per foot to override the estimate.")}</p>
          </section>

          <section className="space-y-2">
            <h3 className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Rooms · {rooms.length}</h3>
            {rooms.map((room) => {
              const flagged = room.invalid.length > 0 || room.uncertain;
              const selected = selectedRoom?.id === room.id;
              return (
                <div
                  key={room.id}
                  className={`cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition-all duration-150 ${
                    selected ? "border-blue-400 ring-2 ring-blue-500/15" : flagged ? "border-red-200" : "border-slate-200 hover:border-slate-300"
                  }`}
                  onClick={() => setSelection({ type: "room", id: room.id })}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-500">{room.kind === "open_plan" ? t("Open plan") : t("Enclosed room")}</span>
                    <ConfidenceBadge value={room.confidence} />
                  </div>
                  <div className="space-y-3 divide-slate-100 [&>*+*]:border-t [&>*+*]:pt-3">
                    {zones
                      .filter((z) => z.room_id === room.id)
                      .map((zone) => (
                        <ZoneEditor key={`${zone.id}:${zone.name}:${zone.dims_text ?? ""}:${zone.kind}`} zone={zone} onChange={(patch) => editZone(zone, patch)} />
                      ))}
                  </div>
                  {[...room.invalid, ...(room.uncertain ? [t("May combine two rooms. Add the missing wall or a zone boundary.")] : [])].map((problem) => (
                    <p key={problem} className="mt-2 flex gap-1.5 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] leading-relaxed text-red-700">
                      <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> {problem}
                    </p>
                  ))}
                </div>
              );
            })}
            <p className="px-0.5 text-[11px] leading-relaxed text-slate-500">{t("Shift-click a second room on the drawing to merge them. Draw a wall to split a room, or a zone boundary to divide an open plan.")}</p>
          </section>
        </aside>
      </div>

      <footer className="flex shrink-0 flex-col gap-3 border-t border-slate-100 px-5 py-3">
        {(problems.length > 0 || validation.warnings.length > 0) && (
          <ul className="max-h-28 space-y-1.5 overflow-auto text-xs">
            {problems.map((e) => (
              <li key={`e${e}`} className="flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-red-700">
                <CircleX className="mt-px size-3.5 shrink-0" aria-hidden /> {e}
              </li>
            ))}
            {validation.warnings.map((w) => (
              <li key={`w${w}`} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> {w}
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <button
            type="button"
            disabled={Boolean(busy) || pending || !validation.ok}
            onClick={() => onConfirm(state)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-amber px-5 text-sm font-semibold text-brand-navy shadow-sm transition-colors hover:bg-[#e8952a] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            <Box className="size-4" aria-hidden />
            {busy ?? (validation.ok ? t("Generate 3D apartment") : t("Fix the errors above to generate 3D"))}
          </button>
        </div>
      </footer>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const t = useT();
  const tone = value >= 0.7 ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15" : value >= 0.5 ? "bg-amber-50 text-amber-700 ring-amber-600/20" : "bg-red-50 text-red-700 ring-red-600/15";
  const dot = value >= 0.7 ? "bg-emerald-500" : value >= 0.5 ? "bg-amber-500" : "bg-red-500";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ring-inset ${tone}`} title={t("Detection confidence")}>
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {Math.round(value * 100)}%
    </span>
  );
}

function SelectionPanel({
  wall,
  opening,
  onDelete,
  onOpeningKind,
}: {
  wall?: WallPx | null;
  opening?: OpeningPx | null;
  onDelete: () => void;
  onOpeningKind: (kind: OpeningPx["kind"]) => void;
}) {
  const t = useT();
  if (!wall && !opening) return null;
  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/70 p-3 text-xs text-slate-700">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-violet-500">{wall ? t("Selected wall") : t("Selected opening")}</h3>
      {wall && (
        <p className="leading-relaxed">
          {Math.round(Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]))} px long · {Math.round(wall.thickness)} px thick
          {wall.confidence < 1 ? " · low confidence" : ""}. Drag the handles to move its ends.
        </p>
      )}
      {opening && (
        <div className="space-y-1.5">
          <select className={SELECT} value={opening.kind} onChange={(e) => onOpeningKind(e.target.value as OpeningPx["kind"])}>
            <option value="door">{t("Door")}</option>
            <option value="window">{t("Window")}</option>
            <option value="opening">{t("Open passage")}</option>
          </select>
          <p className="text-slate-500">{opening.evidence}</p>
        </div>
      )}
      <Button type="button" size="sm" variant="outline" className="mt-2.5 border-red-200 text-red-700 hover:bg-red-50" onClick={onDelete}>
        <Trash2 className="size-3.5" aria-hidden /> {t("Delete")}
      </Button>
    </section>
  );
}

const SELECT =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm capitalize text-slate-700 outline-none transition-colors focus:border-brand-amber focus:ring-2 focus:ring-brand-amber/25";

function ZoneEditor({ zone, onChange }: { zone: ZonePx; onChange: (patch: Partial<LabelPx>) => void }) {
  const t = useT();
  // Local drafts; the parent remounts this editor (key) when the server returns new values.
  const [name, setName] = useState(zone.name);
  const [dims, setDims] = useState(zone.dims_text ?? "");
  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-[1fr_7.5rem] gap-2">
        <Input className="h-9 rounded-lg font-medium text-brand-navy" aria-label={t("Room name")} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== zone.name && onChange({ name, text: name })} />
        <select className={SELECT} aria-label={t("Room type")} value={zone.kind} onChange={(e) => onChange({ kind: e.target.value })}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <Input
        className="h-9 rounded-lg text-xs tabular-nums"
        aria-label={t("Printed size")}
        placeholder={t("Printed size, e.g. 13' x 12'")}
        value={dims}
        onChange={(e) => setDims(e.target.value)}
        onBlur={() => dims !== (zone.dims_text ?? "") && onChange({ dims_text: dims || null, dims_m: null })}
      />
      <div className="flex flex-wrap gap-1.5 text-[10px] font-medium">
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 tabular-nums text-slate-600">
          {zone.measured_m ? `${zone.measured_m[0].toFixed(2)} × ${zone.measured_m[1].toFixed(2)} m` : t("Size unknown until scale is set")}
        </span>
        {zone.dims_error != null && zone.dims_error > 0.12 && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-amber-700">{t("Differs from printed size")}</span>}
        {zone.boundary === "inferred" && <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-orange-700">{t("Boundary inferred")}</span>}
        {zone.boundary === "drawn_line" && <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-sky-700">{t("Follows drawn line")}</span>}
      </div>
    </div>
  );
}

function orientationOf(a: Vec2, b: Vec2): WallPx["orientation"] {
  if (Math.abs(a[1] - b[1]) < 0.5) return "h";
  if (Math.abs(a[0] - b[0]) < 0.5) return "v";
  return "d";
}

function orthoIfClose(from: Vec2, to: Vec2, enabled: boolean): Vec2 {
  if (!enabled) return to;
  // Manhattan snap only within 10°: genuinely diagonal walls stay diagonal.
  const angle = (Math.abs(Math.atan2(to[1] - from[1], to[0] - from[0])) * 180) / Math.PI;
  const off = Math.min(angle % 90, 90 - (angle % 90));
  if (off > 10) return to;
  return Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]) ? [to[0], from[1]] : [from[0], to[1]];
}

function pathOf(polygon: Vec2[], holes: Vec2[][] = []) {
  return [polygon, ...holes].map((ring) => `M${ring.map((p) => `${p[0]},${p[1]}`).join("L")}Z`).join(" ");
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function distanceToPolygon(p: Vec2, polygon: Vec2[]) {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi;
    const dy = yj - yi;
    const t = clamp(((p[0] - xi) * dx + (p[1] - yi) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    best = Math.min(best, Math.hypot(p[0] - (xi + t * dx), p[1] - (yi + t * dy)));
  }
  return inside ? 0 : best;
}

function zoomed(v: { x: number; y: number; w: number; h: number }, factor: number) {
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  return { x: cx - (v.w * factor) / 2, y: cy - (v.h * factor) / 2, w: v.w * factor, h: v.h * factor };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
