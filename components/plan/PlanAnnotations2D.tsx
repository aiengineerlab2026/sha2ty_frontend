"use client";

import { useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import type { PlanGeometry, Vec2 } from "@/lib/plan/types";
import { inside } from "@/lib/plan/roomMaterials";

/**
 * Architectural 2D layer (2D view only, never in 3D or exports): door swings, window double lines,
 * opening markers, room labels with area, and optional perimeter dimension lines.
 */
type Span = { start: Vec2; end: Vec2; thickness?: number; kind?: string };

const INK = "#334155";
const Y = 0.03; // just above the floors

export function PlanAnnotations2D({
  geometry,
  sides,
  showDimensions,
}: {
  geometry: PlanGeometry;
  /** Wall id → room kind on [left, right] side (null = outside), from wallSides(). */
  sides: Map<string, [string | null, string | null]>;
  showDimensions: boolean;
}) {
  const areas = geometry.zones?.length ? geometry.zones : geometry.rooms;
  const inAnyArea = (p: Vec2) => areas.some((a) => inside(p, a.polygon));
  const openings = (geometry.openings ?? []) as Span[];

  const doors = useMemo(
    () =>
      ((geometry.doors ?? []) as Span[]).map((door) => {
        const { u, n, len } = frame(door);
        const mid = lerp(door.start, door.end, 0.5);
        // Swing into a room (the +n side unless only −n is inside).
        const s = inAnyArea(add(mid, n, 0.3)) || !inAnyArea(add(mid, n, -0.3)) ? 1 : -1;
        const v: Vec2 = [n[0] * s, n[1] * s];
        const arc = Array.from({ length: 17 }, (_, i) => {
          const a = (i / 16) * (Math.PI / 2);
          return p3([door.start[0] + len * (Math.cos(a) * u[0] + Math.sin(a) * v[0]), door.start[1] + len * (Math.cos(a) * u[1] + Math.sin(a) * v[1])]);
        });
        return { arc, leaf: [p3(door.start), p3(add(door.start, v, len))] };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometry.doors, areas],
  );

  const labels = useMemo(
    () =>
      areas.map((a) => {
        const at = ("label_point" in a && a.label_point) || centroid(a.polygon);
        const dims = a.dimensions;
        return { id: a.id, name: a.name, at, area: polygonArea(a.polygon), dims: dims ? `${dims.width.toFixed(2)} × ${dims.length.toFixed(2)} m` : null };
      }),
    [areas],
  );

  const dimensions = useMemo(() => {
    if (!showDimensions) return [];
    return geometry.walls.flatMap((wall) => {
      if ((wall.elevation ?? 0) > 0 || wall.height < 1.5) return []; // lintels / sills
      const [left, right] = sides.get(wall.id) ?? [null, null];
      const s = left === null ? 1 : right === null ? -1 : 0; // perimeter walls only, measured outside
      const { n, len } = frame(wall);
      if (!s || len < 0.6) return [];
      const off = wall.thickness / 2 + 0.35;
      const a = add(wall.start, n, off * s);
      const b = add(wall.end, n, off * s);
      const tick = (p: Vec2) => [p3(add(p, n, 0.12)), p3(add(p, n, -0.12))];
      return [{ id: wall.id, line: [p3(a), p3(b)], ticks: [tick(a), tick(b)], at: lerp(a, b, 0.5), text: `${len.toFixed(2)} m` }];
    });
  }, [geometry.walls, sides, showDimensions]);

  return (
    <group>
      {doors.map((d, i) => (
        <group key={`door-${i}`}>
          <Line points={d.arc} color={INK} lineWidth={1} transparent opacity={0.7} />
          <Line points={d.leaf} color={INK} lineWidth={1.6} />
        </group>
      ))}
      {((geometry.windows ?? []) as Span[]).map((w, i) => {
        const { n } = frame(w);
        const h = (w.thickness ?? 0.2) / 2;
        const edge = (k: number) => [p3(add(w.start, n, h * k)), p3(add(w.end, n, h * k))];
        const { len } = frame(w);
        const mid = lerp(w.start, w.end, 0.5);
        return (
          <group key={`window-${i}`}>
            {/* glass pane band (Rx(−π/2) maps local y to −z, hence the negated angle), frame lines, glazing line */}
            <mesh position={[mid[0], Y - 0.005, mid[1]]} rotation={[-Math.PI / 2, 0, -Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0])]}>
              <planeGeometry args={[len, h * 2]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            <Line points={edge(1)} color={INK} lineWidth={1.2} />
            <Line points={edge(-1)} color={INK} lineWidth={1.2} />
            <Line points={edge(0)} color="#60a5fa" lineWidth={1} />
          </group>
        );
      })}
      {openings
        .filter((o) => o.kind === "opening")
        .map((o, i) => (
          <Line key={`opening-${i}`} points={[p3(o.start), p3(o.end)]} color={INK} lineWidth={1} dashed dashSize={0.12} gapSize={0.08} />
        ))}
      {dimensions.map((d) => (
        <group key={`dim-${d.id}`}>
          <Line points={d.line} color="#64748b" lineWidth={1} />
          {d.ticks.map((t, i) => (
            <Line key={i} points={t} color="#64748b" lineWidth={1} />
          ))}
          <Html position={[d.at[0], Y, d.at[1]]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
            <span className="whitespace-nowrap rounded bg-white/90 px-1 text-[10px] font-medium tabular-nums text-slate-600 shadow-sm">{d.text}</span>
          </Html>
        </group>
      ))}
      {labels.map((l) => (
        <Html key={`label-${l.id}`} position={[l.at[0], Y, l.at[1]]} center zIndexRange={[6, 0]} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap text-center leading-tight">
            <p className="text-[12px] font-semibold tracking-tight text-brand-navy">{l.name}</p>
            <p className="text-[10px] tabular-nums text-slate-500">
              {l.area.toFixed(1)} m²{l.dims ? ` · ${l.dims}` : ""}
            </p>
          </div>
        </Html>
      ))}
    </group>
  );
}

function frame(s: { start: Vec2; end: Vec2 }) {
  const dx = s.end[0] - s.start[0];
  const dz = s.end[1] - s.start[1];
  const len = Math.hypot(dx, dz) || 1e-9;
  const u: Vec2 = [dx / len, dz / len];
  return { u, n: [-u[1], u[0]] as Vec2, len };
}

const add = (p: Vec2, d: Vec2, k: number): Vec2 => [p[0] + d[0] * k, p[1] + d[1] * k];
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const p3 = (p: Vec2): [number, number, number] => [p[0], Y, p[1]];

function polygonArea(poly: Vec2[]) {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) sum += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(sum) / 2;
}

function centroid(poly: Vec2[]): Vec2 {
  const n = poly.length || 1;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}
