export type MatchType = "furniture" | "wall_paint" | "carpet";
export type MatchPosition = "front" | "left" | "right" | "behind";
export type Unit = "cm" | "m";

export interface MatchVariation {
  id: string;
  imageUrl: string;
  description: string;
}

export type Step = "type" | "dimensions" | "image" | "position" | "variations";

/** Wizard steps per match type: carpets always go under the model, so they skip the position. The
 * model's footprint, the floor perspective and the wall are estimated by the backend (no clicks). */
export function stepsFor(type: MatchType | null): Step[] {
  if (type === "carpet") return ["type", "dimensions", "image", "variations"];
  return ["type", "dimensions", "image", "position", "variations"];
}

export function toCm(value: number, unit: Unit) {
  return unit === "m" ? value * 100 : value;
}

/** Carousel step without wrap-around: arrows stop at the first / last image. */
export function stepIndex(index: number, count: number, dir: 1 | -1) {
  return Math.min(Math.max(index + dir, 0), Math.max(count - 1, 0));
}

export interface MatchRequest {
  modelId: string;
  matchType: MatchType;
  width: number;
  height: number;
  depth?: number;
  unit: Unit;
  position?: MatchPosition;
  variationsCount: number;
  uploadedImage?: File | null;
  color?: string;
  tileSize?: number;
  /** Only when the catalogue has no size for the model (same unit). */
  modelWidth?: number;
  modelDepth?: number;
  modelHeight?: number;
}

export function matchForm(req: MatchRequest) {
  const form = new FormData();
  for (const [key, value] of Object.entries(req)) {
    if (value == null || value === "") continue;
    if (value instanceof File) form.append(key, value);
    else if (Array.isArray(value)) form.append(key, JSON.stringify(value));
    else form.append(key, String(value));
  }
  return form;
}


/** Split an NDJSON stream chunk: complete lines parsed, the unfinished tail kept for next time. */
export function splitLines(buffer: string): { events: Record<string, unknown>[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  return { events: lines.filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>), rest };
}
