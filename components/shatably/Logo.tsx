import type { ReactNode } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";

// UI face for the optional label only: the wordmark itself is vector outlines, not text.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: "600", display: "swap" });

/**
 * "sha2ty" in Fredoka 600 at 64 px, −0.01em tracking, as outlines (fontTools, from the Google Fonts
 * Fredoka variable font at wght 600). Origin: left edge, baseline. No font is needed to draw it.
 */
const WORDMARK = "M14.13 1.09Q12.42 1.09 10.38 0.7Q8.35 0.32 6.45 -0.42Q4.54 -1.15 3.25 -2.15Q1.95 -3.15 1.78 -4.43Q1.66 -5.07 1.83 -5.78Q2 -6.5 2.42 -7.31Q2.85 -8.13 3.54 -9.02Q4.05 -9.7 4.66 -9.9Q5.28 -10.11 6.16 -9.84Q7.17 -9.68 8.21 -9.18Q9.25 -8.69 10.32 -8.14Q11.39 -7.58 12.54 -7.18Q13.68 -6.77 14.91 -6.77Q16.7 -6.77 17.7 -7.3Q18.7 -7.84 18.7 -8.82Q18.7 -9.5 18.28 -9.98Q17.86 -10.45 17.11 -10.78Q16.37 -11.1 15.4 -11.37Q14.43 -11.63 13.32 -11.91Q12.21 -12.19 11.04 -12.56Q9.49 -13.01 7.99 -13.7Q6.5 -14.38 5.3 -15.5Q4.11 -16.62 3.39 -18.26Q2.67 -19.89 2.67 -22.29Q2.67 -25.39 4.14 -27.52Q5.6 -29.65 8.42 -30.77Q11.23 -31.89 15.28 -31.89Q16.46 -31.89 17.6 -31.74Q18.74 -31.58 19.86 -31.28Q20.98 -30.98 22.06 -30.51Q23.15 -30.05 24.22 -29.46Q26.19 -28.51 26.26 -27Q26.32 -25.49 25.14 -23.84Q24.42 -22.77 23.66 -22.29Q22.9 -21.81 22.1 -21.98Q21.07 -22.24 19.88 -22.82Q18.69 -23.41 17.38 -23.92Q16.08 -24.43 14.75 -24.43Q13.71 -24.43 12.94 -24.16Q12.16 -23.89 11.77 -23.39Q11.38 -22.9 11.38 -22.24Q11.38 -21.44 11.87 -20.94Q12.37 -20.45 13.19 -20.13Q14.02 -19.81 15.11 -19.57Q16.21 -19.33 17.46 -19.09Q19.18 -18.77 21 -18.21Q22.82 -17.65 24.33 -16.63Q25.84 -15.62 26.77 -13.87Q27.7 -12.13 27.7 -9.33Q27.7 -4.29 24.18 -1.6Q20.66 1.09 14.13 1.09ZM35.84 0.61Q33.5 0.61 32.49 -0.09Q31.47 -0.78 31.26 -1.9Q31.06 -3.02 31.06 -4.26V-41.14Q31.06 -42.42 31.3 -43.5Q31.54 -44.59 32.55 -45.26Q33.57 -45.94 35.9 -45.94Q38.24 -45.94 39.23 -45.24Q40.22 -44.54 40.46 -43.46Q40.69 -42.37 40.69 -41.07V-28.03Q41.82 -29.22 43.65 -30.3Q45.47 -31.39 48 -31.39Q51.98 -31.39 55.15 -29.38Q58.32 -27.36 60.18 -23.86Q62.05 -20.37 62.05 -15.82V-4.19Q62.05 -2.96 61.82 -1.87Q61.58 -0.78 60.6 -0.1Q59.62 0.59 57.23 0.59Q54.94 0.59 53.9 -0.08Q52.86 -0.75 52.63 -1.86Q52.4 -2.98 52.4 -4.3V-15.89Q52.4 -17.73 51.76 -19.05Q51.12 -20.37 49.89 -21.12Q48.66 -21.87 46.86 -21.87Q44.5 -21.87 42.74 -20.45Q40.98 -19.02 40.69 -16.94V-4.19Q40.69 -2.96 40.45 -1.85Q40.21 -0.74 39.22 -0.06Q38.22 0.61 35.84 0.61ZM92.22 0.5Q89.84 0.5 88.71 -0.34Q87.58 -1.17 87.6 -2.38L88.27 -3.46Q87.86 -2.82 86.78 -1.89Q85.71 -0.96 83.96 -0.22Q82.21 0.51 79.68 0.51Q76.74 0.51 74.08 -0.77Q71.42 -2.05 69.37 -4.3Q67.31 -6.56 66.12 -9.44Q64.93 -12.32 64.93 -15.54Q64.93 -18.67 66.12 -21.51Q67.31 -24.35 69.4 -26.58Q71.49 -28.8 74.12 -30.08Q76.75 -31.36 79.68 -31.36Q82.06 -31.36 83.73 -30.69Q85.39 -30.02 86.5 -29.1Q87.6 -28.19 88.18 -27.36L87.65 -28.27Q87.6 -29.79 88.74 -30.6Q89.87 -31.41 92.29 -31.41Q94.61 -31.41 95.58 -30.7Q96.56 -30 96.79 -28.86Q97.02 -27.73 97.02 -26.45V-4.35Q97.02 -3.1 96.79 -1.98Q96.56 -0.85 95.58 -0.18Q94.59 0.5 92.22 0.5ZM81.06 -9.01Q82.74 -9.01 84.1 -9.88Q85.47 -10.75 86.3 -12.22Q87.12 -13.68 87.12 -15.46Q87.12 -17.33 86.28 -18.77Q85.44 -20.21 84.04 -21.06Q82.64 -21.92 80.93 -21.92Q79.09 -21.92 77.64 -21.04Q76.19 -20.16 75.34 -18.69Q74.5 -17.22 74.5 -15.38Q74.5 -13.62 75.37 -12.18Q76.24 -10.74 77.73 -9.87Q79.22 -9.01 81.06 -9.01ZM105.28 0.53Q103.34 0.53 101.9 -0.97Q100.45 -2.46 100.45 -4.43Q100.45 -5.55 100.66 -6.58Q100.86 -7.6 101.34 -8.55Q101.81 -9.5 102.62 -10.32Q104.91 -12.59 107.66 -14.48Q110.4 -16.37 113.12 -18.07Q115.84 -19.78 118.1 -21.48Q120.37 -23.18 121.74 -25.12Q123.1 -27.06 123.1 -29.38Q123.1 -30.67 122.56 -31.97Q122.02 -33.26 120.63 -34.14Q119.25 -35.02 116.7 -35.02Q115.04 -35.02 113.81 -34.57Q112.58 -34.11 111.78 -33.23Q110.99 -32.35 110.58 -31.07Q110.18 -29.79 110.18 -28.16Q110.18 -26.94 109.95 -25.9Q109.73 -24.85 108.72 -24.21Q107.71 -23.57 105.28 -23.57Q102.88 -23.57 101.87 -24.3Q100.86 -25.02 100.66 -26.2Q100.45 -27.38 100.45 -28.62Q100.45 -31.7 101.54 -34.59Q102.62 -37.49 104.74 -39.77Q106.85 -42.05 109.84 -43.4Q112.83 -44.75 116.64 -44.75Q121.31 -44.75 124.98 -42.66Q128.64 -40.58 130.77 -36.94Q132.9 -33.3 132.9 -28.54Q132.9 -25.73 132 -23.36Q131.1 -20.99 129.61 -19.04Q128.11 -17.09 126.3 -15.56Q124.5 -14.03 122.63 -12.86Q120.77 -11.68 119.17 -10.82Q117.57 -9.97 116.48 -9.39L115.57 -9.26H129.73Q131.01 -9.26 132.12 -9.02Q133.23 -8.78 133.9 -7.74Q134.56 -6.7 134.56 -4.3Q134.56 -2.02 133.86 -0.98Q133.17 0.06 132.03 0.3Q130.9 0.53 129.6 0.53ZM154.26 0.61Q150.99 0.61 148.63 -0.1Q146.27 -0.8 144.74 -2.27Q143.22 -3.74 142.49 -6.02Q141.76 -8.3 141.76 -11.42V-37.41Q141.76 -38.7 141.99 -39.74Q142.22 -40.78 143.23 -41.43Q144.24 -42.08 146.56 -42.08Q148.85 -42.08 149.86 -41.39Q150.88 -40.7 151.12 -39.6Q151.36 -38.5 151.36 -37.26V-11.82Q151.36 -10.8 151.52 -10.14Q151.68 -9.49 152.01 -9.15Q152.34 -8.82 152.9 -8.68Q153.46 -8.54 154.29 -8.54Q155.73 -8.54 156.82 -8.31Q157.9 -8.08 158.5 -7.17Q159.1 -6.26 159.1 -4.16Q159.1 -1.82 158.38 -0.82Q157.66 0.19 156.55 0.4Q155.44 0.61 154.26 0.61ZM139.76 -30.91 146.8 -30.88 155.65 -31.15Q156.88 -31.15 157.97 -30.92Q159.06 -30.69 159.75 -29.68Q160.45 -28.67 160.45 -26.3Q160.45 -24.11 159.76 -23.1Q159.07 -22.08 157.99 -21.8Q156.91 -21.52 155.63 -21.52L147.28 -21.7L139.54 -21.66Q137.65 -21.76 136.93 -22.82Q136.21 -23.89 136.21 -26.35Q136.21 -28.66 137.09 -29.78Q137.97 -30.91 139.76 -30.91ZM172.51 13.49Q169.92 12.34 169.5 10.93Q169.07 9.52 170.19 7.2L186.22 -28.7Q187.34 -31.22 188.63 -31.71Q189.92 -32.21 192.56 -31.14Q195.1 -29.97 195.54 -28.62Q195.98 -27.28 194.96 -25.02L178.82 11.15Q177.74 13.66 176.45 14.15Q175.15 14.64 172.51 13.49ZM178.08 -1.41 163.06 -24.29Q161.66 -26.43 161.94 -27.85Q162.21 -29.26 164.48 -30.69Q166.96 -32.22 168.34 -31.88Q169.71 -31.54 171.15 -29.34L182.21 -12.38Z";

// Exact brand artwork; colours are fixed so the mark never depends on theme variables.
const NAVY = "#172033";
const AMBER = "#F2A33A";
const WHITE = "#FFFFFF";

/** "dark" = navy artwork for light backgrounds; "light" = white artwork for dark backgrounds. Amber stays. */
export type LogoTone = "dark" | "light";

function MarkPaths({ ink }: { ink: string }) {
  return (
    <>
      <path d="M16 50L50 20L84 50V86H16Z" fill="none" stroke={ink} strokeWidth={7} strokeLinejoin="round" />
      <g transform="rotate(-40 50 64)">
        <rect x={46} y={54} width={8} height={28} rx={4} fill={ink} />
        <rect x={36} y={44} width={28} height={11} rx={2.5} fill={AMBER} />
      </g>
    </>
  );
}

/** Brand mark alone: a hammer inside a home outline. */
export function LogoMark({ size = 36, className, tone = "dark" }: { size?: number; className?: string; tone?: LogoTone }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="sha2ty" className={className}>
      <MarkPaths ink={tone === "light" ? WHITE : NAVY} />
    </svg>
  );
}

// Lockup geometry, from the brand artwork: 72 px mark, 18 px gap, 64 px "sha2ty" (196.6 px wide) over a
// 190 × 17 amber swoosh, the text block (64 px line + swoosh) vertically centred. viewBox units = artwork px.
const MARK = 72;
const GAP = 18;
const TEXT_X = MARK + GAP;
const WORD_W = 196.6;
const SWOOSH_W = 190;
// Amber "BETA" pill, 10 px after the word and 6 px below its top: 15 px Fredoka 600, 0.1em tracking, 5 × 11 padding.
const PILL_X = TEXT_X + WORD_W + 10;
const PILL_TEXT_W = 44;
const PILL_W = PILL_TEXT_W + 22;
const PILL_H = 25;
const W = PILL_X + PILL_W + 1;
const H = 84;
const BLOCK_TOP = (H - (64 + 17)) / 2;
const BASELINE = BLOCK_TOP + 55.62; // CSS line-height 1: baseline sits 55.62 px into Fredoka's 64 px line box

/**
 * Full logo as one SVG: mark + "sha2ty" outlines + amber swoosh + amber "BETA" pill. `size` is the mark's height
 * in px, so the lockup scales from it. `label` (e.g. "Vendor Studio") follows a small amber dot.
 */
export function Logo({
  size = 36,
  className = "",
  label,
  labelClassName = "inline-flex",
  tone = "dark",
}: {
  size?: number;
  className?: string;
  label?: ReactNode;
  labelClassName?: string;
  tone?: LogoTone;
}) {
  const ink = tone === "light" ? WHITE : NAVY;
  const scale = size / MARK;
  return (
    <span className={`inline-flex items-center ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W * scale} height={H * scale} role="img" aria-label="sha2ty" className="shrink-0 overflow-visible">
        <svg x={0} y={(H - MARK) / 2} width={MARK} height={MARK} viewBox="0 0 100 100">
          <MarkPaths ink={ink} />
        </svg>
        <path d={WORDMARK} transform={`translate(${TEXT_X} ${BASELINE})`} fill={ink} />
        <svg x={TEXT_X} y={BLOCK_TOP + 64} width={SWOOSH_W} height={17} viewBox="0 0 260 18" overflow="visible">
          <path d="M6 12Q90 2 254 9" fill="none" stroke={AMBER} strokeWidth={8} strokeLinecap="round" />
        </svg>
        <rect x={PILL_X} y={BLOCK_TOP + 6} width={PILL_W} height={PILL_H} rx={PILL_H / 2} fill={AMBER} />
        <text
          x={PILL_X + PILL_W / 2}
          y={BLOCK_TOP + 6 + PILL_H / 2}
          textAnchor="middle"
          dominantBaseline="central"
          textLength={PILL_TEXT_W}
          lengthAdjust="spacingAndGlyphs"
          fill={NAVY}
          style={{ fontFamily: "Fredoka, ui-rounded, system-ui, sans-serif", fontSize: 15, fontWeight: 600, letterSpacing: "0.1em" }}
        >
          BETA
        </text>
      </svg>
      {label && (
        <span className={`items-center ${labelClassName} ${jakarta.className}`}>
          <span aria-hidden className="rounded-full" style={{ width: size * 0.12, height: size * 0.12, margin: `0 ${size * 0.22}px`, background: AMBER }} />
          <span className={`uppercase ${tone === "light" ? "text-slate-300" : "text-slate-500"}`} style={{ fontSize: Math.max(9, size * 0.24), fontWeight: 600, letterSpacing: "0.14em" }}>
            {label}
          </span>
        </span>
      )}
    </span>
  );
}
