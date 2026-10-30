/** Catalogue model categories. Ceiling lights hang from the ceiling, wall art hangs on a wall at eye
 * level; everything else stands on the floor. */
export type ModelCategory = "furniture" | "table" | "wardrobe" | "tv" | "lighting" | "ceiling_light" | "air_conditioner" | "wall_art";

export const CATEGORIES: { id: ModelCategory; label: string; hint: string }[] = [
  { id: "furniture", label: "Furniture", hint: "Sofas, beds, chairs, storage" },
  { id: "table", label: "Tables", hint: "Dining, coffee and side tables, desks" },
  { id: "wardrobe", label: "Wardrobes", hint: "Wardrobes and closets" },
  { id: "tv", label: "TV & AV", hint: "TVs, screens, sound systems" },
  { id: "lighting", label: "Lights", hint: "Floor and table lamps" },
  { id: "ceiling_light", label: "Ceiling lights", hint: "Pendants and chandeliers, hung from the ceiling" },
  { id: "air_conditioner", label: "Air conditioners", hint: "Split and standing units" },
  { id: "wall_art", label: "Wall art & images", hint: "Framed pictures, paintings, prints and mirrors, hung at eye level" },
];

export const categoryOf = (c: string | null | undefined): ModelCategory => (CATEGORIES.some((x) => x.id === c) ? (c as ModelCategory) : "furniture");

export const categoryLabel = (c: string | null | undefined) => CATEGORIES.find((x) => x.id === categoryOf(c))!.label;

export type Mount = "floor" | "ceiling" | "wall";
export const mountFor = (c: string | null | undefined): Mount => {
  const cat = categoryOf(c);
  return cat === "ceiling_light" ? "ceiling" : cat === "wall_art" ? "wall" : "floor";
};

/** Picture-hanging height: the centre of wall art sits at eye level. */
export const EYE_LEVEL = 1.5;

/** Base height (metres) of an item: 0 on the floor; a ceiling item's top touches the ceiling; wall art is
 * centred at eye level (never below the floor or through the ceiling). */
export function baseHeight(mount: Mount | undefined, ceiling: number, itemHeight: number) {
  if (mount === "ceiling") return Math.max(0, ceiling - itemHeight);
  if (mount === "wall") return Math.max(0, Math.min(ceiling - itemHeight, EYE_LEVEL - itemHeight / 2));
  return 0;
}
