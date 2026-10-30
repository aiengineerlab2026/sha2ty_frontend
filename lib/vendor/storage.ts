import { supabase } from "@/lib/supabase/client";

export async function uploadPublicFile(userId: string, file: File, folder: string): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase().storage.from("cads").upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return supabase().storage.from("cads").getPublicUrl(path).data.publicUrl;
}
