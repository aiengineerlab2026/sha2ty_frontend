import type { PartInfo } from "./parts";
import { meshNameAr } from "./meshNames";

/** A panel's surface layer. A mirrored or glazed door is often a pane in front of a wooden backing inside a frame, all
 * with nearly the same outline from the front: the photo reading's "mirror" belongs to the pane, never to the wood
 * behind it (backend mesh_analysis.match picks by layer now; documents saved before it are repaired here). */
export type Layer = "mirror" | "glass" | "backing" | "solid";

const WORDS: [Exclude<Layer, "solid">, RegExp][] = [
  ["backing", /\b(backing|back ?board|substrate)\b/i],
  ["mirror", /\bmirror\b|مرآة|مراية/i],
  ["glass", /\b(glass|glazed|glazing|pane)\b|زجاج/i],
];
const plain = (text: string) => text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ");

/** The layer a name says (null: it says none). */
export const layerOfName = (text: string): Exclude<Layer, "solid"> | null => WORDS.find(([, re]) => re.test(plain(text)))?.[0] ?? null;

/** The layer a part's own material shows: a polished metal is a mirror, a see-through one glass, anything else solid. */
export type Look = { metalness?: number; roughness?: number; transparent?: boolean; opacity?: number; transmission?: number };
export function layerOfLook(look: Look): Layer {
  if ((look.transmission ?? 0) > 0 || (look.transparent && (look.opacity ?? 1) < 0.95)) return "glass";
  if ((look.metalness ?? 0) >= 0.8 && (look.roughness ?? 1) <= 0.25) return "mirror";
  return "solid";
}

/** The part as its own file describes it, when the photo reading's name for it is a different layer (a backing named
 * "door mirror", a mirror named "door frame", a wooden frame named "mirror"): the link and the name are dropped, the
 * file's own name (its id) is kept. Deterministic; a part that agrees, or says nothing either way, is unchanged. */
export function ownLayerName(info: PartInfo, own: { materialName?: string; look: Look }): PartInfo {
  if (info.naming !== "vision") return info;
  const file = layerOfName(`${info.id} ${own.materialName ?? ""}`) ?? layerOfLook(own.look);
  const said = layerOfName(info.name);
  // The photo says pane and the file another layer, or the file says pane and the photo does not.
  const clash = said === "mirror" || said === "glass" ? file !== said : file === "mirror" || file === "glass";
  if (!clash) return info;
  const name = plain(info.id).replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
  return { id: info.id, name, nameAr: meshNameAr(name), editable: info.editable, naming: "file", ...(info.variants ? { variants: info.variants } : {}) };
}
