import { WebIO, type Texture } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, weld } from "@gltf-transform/functions";

/** Supabase Storage's per-file limit for this project (Free plan: 50 MB); a bit of room is kept under it. */
export const STORAGE_LIMIT = 50 * 1024 * 1024;
const TARGET = 48 * 1024 * 1024;
// ponytail: 2048 px is plenty for furniture seen in a room; raise it if close-ups look soft.
const MAX_TEXTURE = 2048;

/** One texture redrawn at most MAX_TEXTURE px on its long side: PNG stays PNG (it may have transparency), the rest
 * become JPEG. Left as it is when already small or when the browser cannot decode it. */
async function resize(texture: Texture) {
  const image = texture.getImage();
  const mime = texture.getMimeType();
  if (!image || !/image\/(png|jpeg|webp)/.test(mime)) return;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([image as BlobPart], { type: mime }));
  } catch {
    return;
  }
  const scale = Math.min(1, MAX_TEXTURE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && image.byteLength < 1024 * 1024) return bitmap.close();
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = mime === "image/png" ? "image/png" : "image/jpeg";
  const blob = await canvas.convertToBlob({ type, quality: 0.85 });
  if (blob.size >= image.byteLength) return; // no gain
  texture.setImage(new Uint8Array(await blob.arrayBuffer())).setMimeType(type);
  const uri = texture.getURI();
  if (uri) texture.setURI(uri.replace(/\.\w+$/, type === "image/png" ? ".png" : ".jpg"));
}

/**
 * A GLB small enough to store, looking the same: repeated and unused data removed, shared vertices welded and
 * textures capped at 2048 px; if still too big, vertex data is quantized (KHR_mesh_quantization, read by the web
 * viewer and the app's AR). Files already under the limit are returned untouched. Throws when even that is not
 * enough, saying how big it still is.
 */
export async function shrinkGlb(file: File): Promise<File> {
  if (file.size <= TARGET) return file;
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  let doc;
  try {
    doc = await io.readBinary(new Uint8Array(await file.arrayBuffer()));
  } catch (caught) {
    throw new Error(`This GLB could not be read to make it smaller (${caught instanceof Error ? caught.message : String(caught)}). Export it with smaller textures and try again.`);
  }
  await doc.transform(dedup(), prune(), weld());
  for (const texture of doc.getRoot().listTextures()) await resize(texture);
  let out = await io.writeBinary(doc);
  if (out.byteLength > TARGET) {
    await doc.transform(quantize());
    out = await io.writeBinary(doc);
  }
  if (out.byteLength > STORAGE_LIMIT) {
    throw new Error(`This model is still ${(out.byteLength / 1048576).toFixed(0)} MB after optimising (the limit is 50 MB). Reduce its polygons in your 3D tool, or raise the upload limit in Supabase Storage settings.`);
  }
  return new File([out as BlobPart], file.name, { type: "model/gltf-binary" });
}
