// ponytail: switched off for now (vendors, shoppers, planner, catalogue); data, tables and code stay.
// Set one to true to bring every entry point of it back.
export const CARPETS_ENABLED = false;
export const WINDOWS_ENABLED = false;
/** The "TV & AV" model category (its catalogue row, the planner group and the category pickers). */
export const TV_ENABLED = false;

/** Catalogue kinds (models, paints, carpets, windows) that are switched on. */
export const kindEnabled = (kind: string) => (kind !== "carpets" || CARPETS_ENABLED) && (kind !== "windows" || WINDOWS_ENABLED);
