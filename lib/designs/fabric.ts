/** How much upholstery fabric a part takes and what it costs: the part's surface area laid on a standard roll. */

// ponytail: one standard roll width and a flat allowance for seams and pattern matching; make them per-fabric
// columns when vendors sell other widths.
export const ROLL_WIDTH_M = 1.4;
export const ALLOWANCE = 1.1;

export interface FabricQuote {
  area_m2: number;
  /** Running metres to buy, rounded up to the next 10 cm. */
  metres: number;
  total: number | null;
}

export function fabricQuote(area_m2: number, pricePerMetre: number | null): FabricQuote {
  const metres = Math.ceil(((area_m2 * ALLOWANCE) / ROLL_WIDTH_M) * 10 - 1e-9) / 10;
  return { area_m2, metres, total: pricePerMetre == null ? null : Math.round(metres * pricePerMetre * 100) / 100 };
}
