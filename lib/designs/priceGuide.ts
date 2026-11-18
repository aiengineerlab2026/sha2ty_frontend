/** The per-piece price range for a customised model from vendors' bids on earlier requests for the same listing
 * (backend app/services/price_guide.py); low/high are null when there are too few bids to say anything. */
export type PriceGuide = { count: number; requests: number; low: number | null; high: number | null; median: number | null };

/** The range with the customer's options on top (each variant's and added part's price difference, per piece);
 * null when there is no range (the editor then says the price is set by vendors' bids). */
export function guideWithOptions(guide: PriceGuide | null | undefined, extras: (number | null | undefined)[]): { low: number; high: number; extra: number } | null {
  if (!guide || guide.low == null || guide.high == null) return null;
  const extra = extras.reduce<number>((sum, x) => sum + (typeof x === "number" ? x : 0), 0);
  return { low: Math.max(0, guide.low + extra), high: Math.max(0, guide.high + extra), extra };
}
