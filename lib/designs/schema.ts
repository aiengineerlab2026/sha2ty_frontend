/** The shared design document (design_versions.data), sha2ty.design/1. Mirrors backend/app/schemas/design.py
 * and mobile/src/lib/designs.ts: change all three together. Metres are the only unit stored. */
import type { MaterialEdit, PartDocument } from "@/lib/vendor/parts";

export const DESIGN_SCHEMA = "sha2ty.design/1";
export type DesignKind = "item" | "room" | "apartment";

export interface Dimensions {
  width: number;
  height: number;
  depth: number;
}

/** The catalogue original an item design started from (written by the server, never by a save). */
export interface SourceModel {
  model_id: string;
  title: string;
  vendor_id?: string | null;
  /** "vendor": requests go to that vendor only; "platform" (Sha2ty's own model): open to every vendor. Server-set. */
  source_type?: "vendor" | "platform" | "user" | null; // user: the customer's own model (user_models)
  glb_url: string;
  source_glb_url?: string | null;
  width_m?: number | null;
  height_m?: number | null;
  depth_m?: number | null;
}

/** One mesh moved inside a customer design. Scale is a multiplier; position is metres; rotation is degrees. */
export interface PartPose {
  scale?: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
}

/** What a save of an item design sends. */
export interface ItemEdits {
  dimensions?: Dimensions;
  components?: PartDocument;
  material_edits: Record<string, MaterialEdit>;
  part_poses?: Record<string, PartPose>;
  /** Parts removed from the model (not in its GLB, thumbnail or requests). */
  removed_parts?: string[];
  /** The vendor's part variant picked for a part (part id → variant id, from components[].variants). */
  part_variants?: Record<string, string>;
  /** The customer's own .glb the design is built on instead of the source's file. */
  base_glb_url?: string;
}

export interface ItemDesign extends ItemEdits {
  source: SourceModel;
}

/** The planner's plan at the time of the version (taken by the server from the linked floor plan). */
export interface PlanSnapshot {
  plan_id?: string | null;
  name: string;
  source: string;
  source_image_url?: string | null;
  geometry: { rooms?: unknown[] } & Record<string, unknown>;
  items: Record<string, unknown>[];
  camera?: Record<string, unknown> | null;
  warnings: unknown[];
}

export interface DesignData {
  schema: typeof DESIGN_SCHEMA;
  kind: DesignKind;
  units: "m";
  item?: ItemDesign;
  plan?: PlanSnapshot;
}

export interface DesignVersion {
  id: string;
  design_id: string;
  number: number;
  schema: string;
  glb_url: string | null;
  thumbnail_url: string | null;
  note: string;
  restored_from: string | null;
  created_at: string;
  data?: DesignData;
}

export interface Design {
  id: string;
  kind: DesignKind;
  title: string;
  source_model_id: string | null;
  plan_id: string | null;
  current_version_id: string | null;
  version_count: number;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
  current?: DesignVersion & { data: DesignData };
}
