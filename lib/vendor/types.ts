export type ModelSource = "photo" | "upload";
/** "item" = total price per piece; "m2" = price per square metre. */
export type PriceUnit = "item" | "m2";
export type ModelProvider = "meshy" | "astra";
export type ModelStatus = "draft" | "generating" | "ready" | "failed";

export interface VendorProfile {
  id: string;
  name: string;
  location: string;
  logo_url: string | null;
}

export interface ModelVariant {
  id: string;
  image_url: string;
  sort_order: number;
}

export interface CatalogModel {
  id: string;
  vendor_id: string;
  title: string;
  description: string;
  width_m: number | null;
  height_m: number | null;
  depth_m: number | null;
  price?: number | null;
  price_unit?: PriceUnit;
  category?: string;
  shape?: "straight" | "l_left" | "l_right";
  length2_m?: number | null;
  source: ModelSource;
  provider: ModelProvider | null;
  status: ModelStatus;
  glb_url: string | null;
  source_image_url: string | null;
  error: string | null;
  created_at: string;
  model_variants: ModelVariant[];
}

export type PaintKind = "color" | "texture";
export type PaintSurface = "wall" | "floor";

export interface Paint {
  id: string;
  vendor_id: string;
  name: string;
  kind: PaintKind;
  surface: PaintSurface;
  /** Paint colour; for textures the image's average colour (GLB export has no textures). */
  color: string;
  texture_url: string | null;
  /** Metres covered by one texture tile. */
  tile_m: number;
  /** Metres one texture tile covers across (u) and down (v); null on rows from before tile_size.sql. */
  tile_width_m?: number | null;
  tile_height_m?: number | null;
  price: number | null;
  price_unit: PriceUnit;
}

/** Window: an image (background removed) shown on a wall face at its real width × height. */
export interface WindowItem {
  id: string;
  vendor_id: string;
  name: string;
  width_m: number;
  height_m: number;
  image_url: string;
  price: number | null;
  price_unit: PriceUnit;
}

/** Carpet: an image laid flat on the floor at its real width × length. */
export interface Carpet {
  id: string;
  vendor_id: string;
  name: string;
  width_m: number;
  length_m: number;
  image_url: string;
  price: number | null;
  price_unit: PriceUnit;
}
