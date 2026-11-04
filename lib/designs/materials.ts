/** Part materials a customer picks in the editor (upholstery fabrics and woods, supabase/fabrics.sql) and what a
 * part needs of them. Shared by the editor, the saved design and the request spec. */
import { fabricQuote } from "./fabric";

export type MaterialKind = "fabric" | "wood" | "paint";
export type WoodClass = "natural" | "engineered" | "finish";
export type MaterialUnit = "m" | "m2" | "m3" | "sheet" | "kg" | "l";

/** The wood types offered, with what they are: a structural material (solid or engineered) or a surface finish. */
export const WOOD_TYPES: { id: string; name: string; class: WoodClass; unit: MaterialUnit }[] = [
  { id: "oak", name: "Oak", class: "natural", unit: "m3" },
  { id: "beech", name: "Beech", class: "natural", unit: "m3" },
  { id: "pine", name: "Pine", class: "natural", unit: "m3" },
  { id: "walnut", name: "Walnut", class: "natural", unit: "m3" },
  { id: "teak", name: "Teak", class: "natural", unit: "m3" },
  { id: "ash", name: "Ash", class: "natural", unit: "m3" },
  { id: "mahogany", name: "Mahogany", class: "natural", unit: "m3" },
  { id: "mdf", name: "MDF", class: "engineered", unit: "sheet" },
  { id: "hdf", name: "HDF", class: "engineered", unit: "sheet" },
  { id: "plywood", name: "Plywood", class: "engineered", unit: "sheet" },
  { id: "particleboard", name: "Particleboard", class: "engineered", unit: "sheet" },
  { id: "blockboard", name: "Blockboard", class: "engineered", unit: "sheet" },
  { id: "melamine", name: "Melamine", class: "finish", unit: "m2" },
  { id: "veneer", name: "Veneer", class: "finish", unit: "m2" },
  { id: "laminate", name: "Laminate / HPL", class: "finish", unit: "m2" },
  { id: "lacquer", name: "Clear lacquer", class: "finish", unit: "m2" },
];

export const woodType = (id: string | null | undefined) => WOOD_TYPES.find((w) => w.id === id);

// ponytail: one flat allowance for cutting and offcuts; a per-material column when vendors quote their own.
export const WOOD_WASTE = 1.15;
// ponytail: two coats everywhere; a per-design choice when customers ask for it.
export const PAINT_COATS = 2;

/** A library row as the editor uses it. */
export interface PartMaterialOption {
  id: string;
  kind: MaterialKind;
  name: string;
  url: string;
  tile: number;
  price: number | null;
  unit: MaterialUnit;
  wood_type?: string | null;
  description?: string | null;
  thicknesses_mm?: number[] | null;
  sheet?: [number, number] | null;
  normal_url?: string | null;
  roughness?: number | null;
  vendor?: { name: string; logo_url: string | null } | null;
  /** Paint: its palette colour and the m² one unit (kg / litre) covers per coat. */
  color?: { id: string; name: string; hex: string } | null;
  coverage_m2?: number | null;
}

/** What is saved on a part (MaterialEdit.material): the choice, and its estimate at the size it was saved at. */
export interface PartMaterial {
  id: string;
  kind: MaterialKind;
  name: string;
  wood_type?: string;
  thickness_mm?: number;
  price?: number | null;
  unit: MaterialUnit;
  sheet?: [number, number];
  /** Decorative surface on a structural board (MDF with walnut veneer); its pattern is what is shown. */
  finish?: { id: string; name: string; wood_type?: string; price?: number | null; unit: MaterialUnit };
  quantity?: number;
  finish_quantity?: number;
  total?: number | null;
  /** Paint: the palette colour, how far one unit goes per coat, and the coats. */
  color?: string;
  color_name?: string;
  coverage_m2?: number;
  coats?: number;
}

export const round = (x: number, step: number) => Math.ceil(x / step - 1e-9) * step;
const money = (x: number) => Math.round(x * 100) / 100;

/** Quantity and cost of one part's material from its surface area (m²). A board's area is half its surface (two
 * faces); a finish covers the whole surface. Volume is board area × thickness. Sheets are whole sheets. */
export function quote(material: Omit<PartMaterial, "quantity" | "finish_quantity" | "total">, area_m2: number): PartMaterial {
  if (material.kind === "fabric") {
    const q = fabricQuote(area_m2, material.price ?? null);
    return { ...material, quantity: q.metres, total: q.total };
  }
  if (material.kind === "paint") {
    const coats = material.coats ?? PAINT_COATS;
    const quantity = Math.max(0.1, round((area_m2 * coats) / (material.coverage_m2 ?? 10), 0.1));
    return { ...material, coats, quantity: Number(quantity.toFixed(1)), total: material.price == null ? null : money(quantity * material.price) };
  }
  const board = (area_m2 / 2) * WOOD_WASTE;
  const quantity =
    material.unit === "m3" ? round((board * (material.thickness_mm ?? 18)) / 1000, 0.001)
    : material.unit === "sheet" ? Math.max(1, Math.ceil(board / ((material.sheet?.[0] ?? 1.22) * (material.sheet?.[1] ?? 2.44)) - 1e-9))
    : material.unit === "m" ? round(board, 0.1)
    : round(board, 0.01);
  const finish_quantity = material.finish ? round(area_m2 * WOOD_WASTE, 0.01) : undefined;
  const parts = [material.price == null ? null : quantity * material.price, material.finish ? (material.finish.price == null ? null : finish_quantity! * material.finish.price) : 0];
  return { ...material, quantity, finish_quantity, total: parts.some((p) => p == null) ? null : money((parts[0] ?? 0) + (parts[1] ?? 0)) };
}

export const UNIT_LABEL: Record<MaterialUnit, string> = { m: "m", m2: "m²", m3: "m³", sheet: "sheet", kg: "kg", l: "L" };
