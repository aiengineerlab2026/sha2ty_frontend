export type ModelSource = "photo" | "upload" | "none"; // none: photos only, no 3D
/** "item" = total price per piece; "m2" = price per square metre. */
export type PriceUnit = "item" | "m2";
export type ModelProvider = "meshy" | "astra" | "sol";
export type ModelStatus = "draft" | "generating" | "ready" | "failed";

export interface VendorProfile {
  id: string;
  name: string;
  location: string;
  logo_url: string | null;
  /** Admin approval (supabase/vendor_approval.sql); missing before that migration runs. */
  status?: "pending" | "approved" | "rejected";
  /** The platform's own catalogue vendor ("Sha2ty", platform_vendor.sql). */
  platform?: boolean;
  full_name?: string | null;
  email?: string | null;
  lat?: number | null;
  lng?: number | null;
  created_at?: string;
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
  /** Untouched generated file, kept once a customized GLB replaces glb_url. */
  source_glb_url?: string | null;
  components?: import("./parts").PartDocument | null;
  material_edits?: Record<string, import("./parts").MaterialEdit> | null;
  /** The vendor's original photo; never replaced by a render. */
  source_image_url: string | null;
  /** Render of the saved 3D model (model_thumbnail.sql); shown in listings before the photo. */
  thumbnail_url?: string | null;
  /** Save counter: glb_url and thumbnail_url are written together under one version. */
  version?: number;
  error: string | null;
  created_at: string;
  model_variants: ModelVariant[];
  /** Woods customers can choose for this model (supabase/woods.sql); null: all the vendor works with. */
  woods?: string[] | null;
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

/** Door: same shape as a window; fitted into the plan's door openings only. */
export type DoorItem = WindowItem;

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
