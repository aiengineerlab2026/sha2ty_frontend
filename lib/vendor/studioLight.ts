/** One light for every view of a product: the editor, the catalogue / request viewer, the saved thumbnail and the
 * request report's pictures. A neutral room environment (no tint) plus a white key and fill, calibrated so a
 * front-facing matte colour renders as itself (#a9b99c sage → #aabb9c): a wood or fabric looks like its swatch.
 * The editor used drei's "warehouse" preset, a warm photo that turned walnut (swatch ≈ rgb 110 74 52) orange
 * (≈ 125 78 41 on screen). Change these together with the measured swatch check in lib/designs/__tests__. */
export const STUDIO_LIGHT = { environment: 0.7, key: 0.5, fill: 0.15, ambient: 0 } as const;

/** The key and fill directions (world space): from the front right above, and a low back fill. */
export const KEY_POSITION: [number, number, number] = [6, 8, 4];
export const FILL_POSITION: [number, number, number] = [-4, 2, -3];

/** sRGB 0–255 → CIE Lab, for comparing a rendered colour with its swatch (ΔE76: under ~10 reads as the same
 * material, over ~20 as a different one). */
export function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
