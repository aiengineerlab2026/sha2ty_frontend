"use client";

import { useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";

/** "Replace 3D file": the person's new .glb version of the model. Asks first (the new file has its own parts, so part
 * names, materials and variants start over), uploads it and hands back its URL. */
export function ReplaceGlb({ upload, onReplaced, onError, className, label = true }: { upload: (file: File) => Promise<string>; onReplaced: (url: string) => void; onError: (message: string) => void; className?: string; label?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.glb$/i.test(file.name)) return onError(t("Choose a .glb file."));
    // A binary glTF starts with "glTF": anything else (a renamed file) is refused before it is uploaded.
    if (new TextDecoder().decode(await file.slice(0, 4).arrayBuffer()) !== "glTF") return onError(t("This is not a valid .glb file."));
    if (!window.confirm(t("Replace the 3D file with “{name}”? Part names, materials and part changes start over on the new file.", { name: file.name }))) return;
    setBusy(true);
    try {
      onReplaced(await upload(file));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <label title={t("Replace 3D file")} className={`cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-amber ${busy ? "pointer-events-none opacity-60" : ""} ${className ?? ""}`}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileUp className="size-4" aria-hidden />}
      <span className={label ? "" : "sr-only"}>{busy ? t("Uploading…") : t("Replace 3D file")}</span>
      <input type="file" accept=".glb,model/gltf-binary" className="sr-only" disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}
