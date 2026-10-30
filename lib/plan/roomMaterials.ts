import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

/** Room type → floor colour (flat beige tones) and wall paint. Keep in sync with ROOM_FINISHES in backend geometry_builder.py. */
export type WallPattern = "plaster" | "tile" | "brick" | "plain";

export interface RoomFinish {
  floor: string;
  wall: string;
  wallPattern: WallPattern;
  /** Wall tile size in metres (tile pattern only). */
  wallModule?: number;
}

export const ROOM_FINISHES: Record<string, RoomFinish> = {
  bedroom: { floor: "#d9c6a5", wall: "#ece4d6", wallPattern: "plaster" },
  living: { floor: "#cdb48e", wall: "#efe8dc", wallPattern: "plaster" },
  dining: { floor: "#e2d3b8", wall: "#f0eadf", wallPattern: "plaster" },
  kitchen: { floor: "#e8dcc4", wall: "#f4f2ed", wallPattern: "tile", wallModule: 0.15 },
  bathroom: { floor: "#efe6d4", wall: "#cfe2e8", wallPattern: "tile", wallModule: 0.2 },
  laundry: { floor: "#ebe1cd", wall: "#eef0f0", wallPattern: "tile", wallModule: 0.2 },
  patio: { floor: "#c8b593", wall: "#d9d4cb", wallPattern: "brick" },
  closet: { floor: "#d4bf9c", wall: "#ebe5da", wallPattern: "plaster" },
  hall: { floor: "#dccaa9", wall: "#eee8de", wallPattern: "plaster" },
  garage: { floor: "#bfae90", wall: "#d6d6d2", wallPattern: "plaster" },
  room: { floor: "#d8c7a8", wall: "#efe9df", wallPattern: "plaster" },
};

/** Outside face of exterior walls: flat untextured render, same colour as the GLB export. */
export const FACADE: RoomFinish = { floor: "#c8b593", wall: "#d9d4cb", wallPattern: "plain" };

/** Metres one texture tile covers: [across, down]. Older data only has the square tile_m. */
export function tileSize(p: { tile_m: number; tile_w?: number; tile_h?: number; tile_width_m?: number | null; tile_height_m?: number | null }): [number, number] {
  const w = Number(p.tile_w ?? p.tile_width_m ?? p.tile_m) || 1;
  const h = Number(p.tile_h ?? p.tile_height_m ?? p.tile_m) || 1;
  return [w, h];
}

/** Tile size for people, in centimetres (stored in metres): "60 × 30 cm tile". */
export const tileLabel = (p: Parameters<typeof tileSize>[0]) => {
  const [w, h] = tileSize(p).map((m) => Math.round(m * 1000) / 10);
  return w === h ? `${w} cm tile` : `${w} × ${h} cm tile`;
};

export function finishFor(kind: string | undefined): RoomFinish {
  return ROOM_FINISHES[kind ?? ""] ?? ROOM_FINISHES.room;
}

const wallCache = new Map<string, { texture: Texture; span: [number, number] }>();

/**
 * Wall texture and the real-world size (metres) one texture tile covers. Callers clone it and set
 * `repeat = faceSize / span`, so tiles and bricks keep their true size on walls of any length.
 */
export function wallTexture(finish: RoomFinish): { texture: Texture; span: [number, number] } | null {
  if (finish.wallPattern === "plain" || typeof document === "undefined") return null;
  const key = `${finish.wallPattern}:${finish.wall}:${finish.wallModule ?? ""}`;
  const hit = wallCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  let span: [number, number];
  if (finish.wallPattern === "brick") {
    // Running bond: 4 courses of 2 bricks, 0.25 × 0.075 m bricks with 10 mm joints.
    canvas.width = 256;
    canvas.height = 154;
    span = [0.52, 0.34];
    ctx.fillStyle = "#cfc6b8"; // mortar
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bw = canvas.width / 2;
    const bh = canvas.height / 4;
    for (let row = 0; row < 4; row++) {
      for (let col = -1; col < 3; col++) {
        const x = col * bw + (row % 2 ? bw / 2 : 0);
        const shade = ((row * 7 + col * 13) % 5) * 6 - 12;
        ctx.fillStyle = shadeHex(finish.wall, shade);
        ctx.fillRect(x + 3, row * bh + 3, bw - 6, bh - 6);
      }
    }
  } else if (finish.wallPattern === "tile") {
    canvas.width = canvas.height = 256;
    const m = finish.wallModule ?? 0.2;
    span = [m * 4, m * 4];
    ctx.fillStyle = finish.wall;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; // light grout
    ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 64, 0);
      ctx.lineTo(i * 64, 256);
      ctx.moveTo(0, i * 64);
      ctx.lineTo(256, i * 64);
      ctx.stroke();
    }
  } else {
    // Painted plaster: flat paint with a faint deterministic grain.
    canvas.width = canvas.height = 128;
    span = [1, 1];
    ctx.fillStyle = finish.wall;
    ctx.fillRect(0, 0, 128, 128);
    let seed = 7;
    for (let i = 0; i < 1400; i++) {
      seed = (seed * 16807) % 2147483647;
      const x = seed % 128;
      seed = (seed * 16807) % 2147483647;
      const y = seed % 128;
      ctx.fillStyle = i % 2 ? "rgba(0,0,0,0.035)" : "rgba(255,255,255,0.05)";
      ctx.fillRect(x, y, 2, 2);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  const entry = { texture, span };
  wallCache.set(key, entry);
  return entry;
}

function shadeHex(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amount));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

type Area = { kind: string; polygon: [number, number][] };

/** Room type on each side of a wall (null = outside). Sides: left/right of start→end, seen from above. */
export function wallSides(start: [number, number], end: [number, number], thickness: number, areas: Area[]): [string | null, string | null] {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const len = Math.hypot(dx, dz) || 1;
  // Normal of the box's local +Z face after rotation.y = −atan2(dz, dx): (−sin a, cos a).
  const nx = -dz / len;
  const nz = dx / len;
  const mx = (start[0] + end[0]) / 2;
  const mz = (start[1] + end[1]) / 2;
  const reach = thickness / 2 + 0.08;
  const at = (s: number) => {
    const p: [number, number] = [mx + nx * reach * s, mz + nz * reach * s];
    return areas.find((a) => inside(p, a.polygon))?.kind ?? null;
  };
  return [at(1), at(-1)];
}

export function inside(pt: [number, number], polygon: [number, number][]) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if (zi > pt[1] !== zj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi + 1e-12) + xi) hit = !hit;
  }
  return hit;
}
