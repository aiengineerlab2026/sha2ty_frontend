import { publicStorageUrl, supabase } from "@/lib/supabase/client";

export async function uploadPublicFile(userId: string, file: File, folder: string): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  // Big 3D files: made smaller in the browser first (storage refuses files over its limit: 413 EntityTooLarge).
  if (ext === "glb" && file.size > 48 * 1024 * 1024) file = await (await import("./shrinkGlb")).shrinkGlb(file);
  const path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase().storage.from("cads").upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return publicStorageUrl("cads", path);
}
