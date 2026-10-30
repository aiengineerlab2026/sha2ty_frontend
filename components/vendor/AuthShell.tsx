"use client";

import { useT } from "@/lib/i18n";
import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Logo } from "@/components/shatably/Logo";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap" });

/**
 * Split-screen auth layout: brand showcase (an isometric apartment, drawn in SVG) on the left,
 * the form centred on the right. Only the logo in the top bar — no app navigation while signing in.
 */
export function AuthShell({ title, subtitle, children, wide = false }: { title: ReactNode; subtitle: ReactNode; children: ReactNode; wide?: boolean }) {
  const t = useT();
  return (
    // Large screens: exactly one viewport tall, no page scroll (the form column scrolls only if the
    // window is unusually short). Phones and tablets: a normal scrolling page.
    <div className={`grid min-h-dvh bg-white lg:h-dvh lg:grid-cols-2 lg:overflow-hidden ${jakarta.className}`}>
      <aside className="relative hidden overflow-hidden bg-brand-navy lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -start-32 -top-32 size-[28rem] rounded-full bg-brand-amber/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 end-0 size-[32rem] rounded-full bg-sky-400/10 blur-3xl" aria-hidden />
        <div className="relative flex min-h-0 flex-1 flex-col p-8 xl:p-12">
          <Link href="/" aria-label="sha2ty home" className="self-start">
            <Logo size={44} tone="light" label={t("Vendor Studio")} />
          </Link>
          <div className="flex min-h-0 flex-1 items-center justify-center py-6">
            <IsoApartment className="max-h-full w-full max-w-lg drop-shadow-[0_30px_40px_rgba(0,0,0,0.35)]" />
          </div>
          <div className="max-w-md shrink-0 space-y-5">
            <h2 className="text-[28px] font-bold leading-[1.15] tracking-tight text-white xl:text-[32px]">Your catalogue, placed in real homes at real size.</h2>
            <ul className="space-y-3 text-[15px] text-slate-300">
              {["Turn product photos into 3D models", "Paints, floors and carpets priced per m²", "Shoppers furnish their own floor plan"].map((point) => (
                <li key={point} className="flex items-center gap-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-amber/15 text-brand-amber ring-1 ring-brand-amber/25">
                    <Check className="size-3" aria-hidden />
                  </span>
                  {t(point)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col lg:min-h-0 lg:overflow-y-auto">
        {/* On large screens the banner carries the logo, so this one stays small; on phones it is the brand. */}
        <header className="flex h-14 shrink-0 items-center px-5 sm:h-20 sm:px-10 lg:hidden">
          <Link href="/" aria-label="sha2ty home">
            <Logo size={40} />
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center px-5 pb-5 sm:px-10 sm:pb-10 lg:py-8">
          <div className={`w-full ${wide ? "max-w-[560px]" : "max-w-[440px]"}`}>
            <h1 className={`font-bold leading-tight tracking-tight text-brand-navy ${wide ? "text-2xl xl:text-[28px]" : "text-[28px]"}`}>{title}</h1>
            <p className={`mt-1.5 leading-relaxed text-slate-500 ${wide ? "text-sm" : "text-[15px]"}`}>{subtitle}</p>
            <div className={wide ? "mt-4 sm:mt-6" : "mt-9"}>{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}

type Box = { x: number; z: number; w: number; d: number };

// Plan in metres: three rooms and their walls (x → end-down, z → start-down in isometric).
const ROOMS: (Box & { fill: string })[] = [
  { x: 0, z: 0, w: 6, d: 5, fill: "#d9c6a5" }, // living
  { x: 6, z: 0, w: 4, d: 5, fill: "#e2d3b8" }, // kitchen
  { x: 0, z: 5, w: 5, d: 4, fill: "#cdb48e" }, // bedroom
  { x: 5, z: 5, w: 5, d: 4, fill: "#efe6d4" }, // bath + hall
];
const T = 0.18;
const H = 2.4;
const WALLS: Box[] = [
  { x: 0, z: 0, w: 10, d: T },
  { x: 0, z: 0, w: T, d: 9 },
  { x: 6, z: 0, w: T, d: 3.4 },
  { x: 0, z: 5, w: 3.6, d: T },
  { x: 4.6, z: 5, w: 3.4, d: T },
  { x: 5, z: 5, w: T, d: 2.6 },
];
const FURNITURE: (Box & { h: number; fill: string })[] = [
  { x: 1, z: 1, w: 2.6, d: 0.9, h: 0.8, fill: "#f2a33a" }, // sofa
  { x: 1.4, z: 2.6, w: 1.4, d: 0.8, h: 0.4, fill: "#ffffff" }, // table
  { x: 7, z: 0.3, w: 2.8, d: 0.6, h: 0.9, fill: "#94a3b8" }, // counter
  { x: 0.8, z: 6.2, w: 1.8, d: 2.1, h: 0.5, fill: "#f8fafc" }, // bed
];

const C = Math.cos(Math.PI / 6);
const S = 0.5;
const iso = (x: number, z: number, y = 0) => [(x - z) * C, (x + z) * S - y] as const;
const pts = (list: (readonly [number, number])[]) => list.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(" ");

/** Extruded box: top face plus the two faces visible from the viewer (front-left, front-right). */
function Prism({ b, h, fill, shade = true }: { b: Box; h: number; fill: string; shade?: boolean }) {
  const { x, z, w, d } = b;
  return (
    <g>
      <polygon points={pts([iso(x, z + d, 0), iso(x + w, z + d, 0), iso(x + w, z + d, h), iso(x, z + d, h)])} fill={fill} filter={shade ? "url(#dark)" : undefined} />
      <polygon points={pts([iso(x + w, z, 0), iso(x + w, z + d, 0), iso(x + w, z + d, h), iso(x + w, z, h)])} fill={fill} filter={shade ? "url(#darker)" : undefined} />
      <polygon points={pts([iso(x, z, h), iso(x + w, z, h), iso(x + w, z + d, h), iso(x, z + d, h)])} fill={fill} />
    </g>
  );
}

function IsoApartment({ className }: { className?: string }) {
  const t = useT();
  const minX = iso(0, 9)[0] - 1;
  const maxX = iso(10, 0)[0] + 1;
  const minY = iso(0, 0, H)[1] - 1;
  const maxY = iso(10, 9)[1] + 1;
  // Back-to-front order so nearer pieces cover farther ones.
  const depth = (b: Box) => b.x + b.w + b.z + b.d;
  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className={className} role="img" aria-label={t("Isometric preview of a furnished apartment")}>
      <defs>
        <filter id="dark">
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.82" />
            <feFuncG type="linear" slope="0.82" />
            <feFuncB type="linear" slope="0.82" />
          </feComponentTransfer>
        </filter>
        <filter id="darker">
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.68" />
            <feFuncG type="linear" slope="0.68" />
            <feFuncB type="linear" slope="0.68" />
          </feComponentTransfer>
        </filter>
      </defs>
      {/* slab */}
      <Prism b={{ x: -0.3, z: -0.3, w: 10.6, d: 9.6 }} h={0} fill="#24314d" shade={false} />
      <polygon points={pts([iso(-0.3, 9.3, 0), iso(10.3, 9.3, 0), iso(10.3, 9.3, -0.35), iso(-0.3, 9.3, -0.35)])} fill="#111827" />
      <polygon points={pts([iso(10.3, -0.3, 0), iso(10.3, 9.3, 0), iso(10.3, 9.3, -0.35), iso(10.3, -0.3, -0.35)])} fill="#0b1220" />
      {ROOMS.map((r) => (
        <polygon key={`${r.x}-${r.z}`} points={pts([iso(r.x, r.z), iso(r.x + r.w, r.z), iso(r.x + r.w, r.z + r.d), iso(r.x, r.z + r.d)])} fill={r.fill} stroke="#00000014" strokeWidth={0.03} />
      ))}
      {/* rug */}
      <polygon points={pts([iso(0.8, 0.7), iso(4, 0.7), iso(4, 3.8), iso(0.8, 3.8)])} fill="#f2a33a" opacity={0.25} />
      {[...WALLS.map((b) => ({ b, h: H, fill: "#f1ede6" })), ...FURNITURE.map((f) => ({ b: f as Box, h: f.h, fill: f.fill }))]
        .sort((a, b) => depth(a.b) - depth(b.b))
        .map((p, i) => (
          <Prism key={i} b={p.b} h={p.h} fill={p.fill} />
        ))}
    </svg>
  );
}
