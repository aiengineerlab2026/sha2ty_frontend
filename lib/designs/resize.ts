import type { Dimensions } from "./schema";

export type Axis = "width" | "height" | "depth";

export const MIN_SIZE = 0.05; // metres: the smallest a model can be dragged down to
export const MAX_SIZE = 50;

/** The size after asking for `length` on one axis. Proportional: every axis by the same factor (the model keeps its
 * shape); independent: only that axis (parts and textures stretch). Never below `min` on any axis, never above 50 m
 * — the factor is clamped, so a proportional resize stays proportional at the limit. */
export function resized(start: Dimensions, axis: Axis, length: number, proportional: boolean, min = MIN_SIZE): Dimensions {
  if (!proportional) return { ...start, [axis]: Math.min(MAX_SIZE, Math.max(min, length)) };
  const smallest = Math.min(start.width, start.height, start.depth);
  const largest = Math.max(start.width, start.height, start.depth);
  const factor = Math.min(MAX_SIZE / largest, Math.max(min / smallest, length / start[axis]));
  return { width: start.width * factor, height: start.height * factor, depth: start.depth * factor };
}

/** The axis length a handle drag asks for. Width and depth grow on both sides around the centre (a handle moved
 * 10 cm out makes the model 20 cm wider); height grows up from the floor. `side` is +1 for the handle on the
 * positive side, −1 for the opposite one; `moved` is the drag along the axis in metres. */
export function dragLength(start: Dimensions, axis: Axis, side: 1 | -1, moved: number): number {
  return axis === "height" ? start.height + moved : start[axis] + 2 * side * moved;
}

/** How much one axis is stretched against the others (1 = the original proportions). */
export function stretch(size: Dimensions, original: Dimensions): number {
  const r = [size.width / original.width, size.height / original.height, size.depth / original.depth];
  return Math.max(...r) / Math.min(...r);
}

export function formatLength(metres: number, unit: "m" | "cm"): string {
  return unit === "cm" ? `${Math.round(metres * 100)} cm` : `${metres.toFixed(2)} m`;
}
