"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Check, Loader2, Save } from "lucide-react";
import { authSession } from "@/lib/auth/client";
import { supabase } from "@/lib/supabase/client";
import { customizedModelFields, type MaterialEdit, type PartDocument, type PartEditorApi } from "@/lib/vendor/parts";

const ModelViewer = dynamic(() => import("@/components/vendor/ModelViewer").then((mod) => mod.ModelViewer), {
  ssr: false,
  loading: () => <div className="h-dvh bg-[#e4eaee]" />,
});

type Row = { id: string; title: string; glb_url: string | null; source_glb_url: string | null; components: PartDocument | null; material_edits: Record<string, MaterialEdit> | null; version: number | null };

/** The app's editor for a freshly generated model: its parts (split as on the web), their fabrics, woods and paints,
 * names and visibility. Saving writes a new GLB and part list to the row (row-level security: only its owner), then
 * tells the app (`saved`) so it can close this view. No site header: it fills the app's screen. */
export function AppModelEditor({ table, id }: { table: "models" | "user_models"; id: string }) {
  const t = useT();
  const [userId, setUserId] = useState<string | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const editor = useRef<PartEditorApi | null>(null);

  useEffect(() => {
    void authSession().then(async ({ data }) => {
      if (!data.session) return setError(t("Sign in again in the app."));
      setUserId(data.session.user.id);
      const { data: found, error: next } = await supabase().from(table).select("*").eq("id", id).maybeSingle();
      if (next || !found) return setError(next?.message ?? t("Model not found."));
      if (!found.glb_url) return setError(t("This model has no 3D file yet."));
      setRow(found as Row);
    });
  }, [table, id, t]);

  const save = async () => {
    if (!editor.current || !row || !userId) return;
    setBusy(true);
    setError(null);
    try {
      const { fields } = await customizedModelFields(userId, row.id, row.glb_url!, row.source_glb_url, editor.current, row.version ?? 1);
      const { error: next } = await supabase().from(table).update(fields).eq("id", row.id);
      if (next) throw new Error(next.message);
      editor.current.markClean?.();
      setSaved(true);
      // The app's browser view listens for this and closes.
      (window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } }).ReactNativeWebView?.postMessage("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    // Phones (the app): the page scrolls, the bar stays on top and the 3D view sticks under it (ModelViewer's
    // top-16) while the parts and their materials scroll below. Wide screens: a fixed workspace, as on the web.
    <div className="min-h-dvh bg-slate-50 lg:flex lg:h-dvh lg:flex-col">
      <div className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <p className="min-w-0 flex-1 truncate font-semibold text-brand-navy">{row?.title || t("Edit model")}</p>
        {saved && <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check className="size-3.5" aria-hidden /> {t("Saved")}</span>}
        <button type="button" disabled={busy || !row} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />} {t("Save")}
        </button>
      </div>
      {error && <p className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {row && (
        <div className="p-2 sm:p-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <ModelViewer
          edit
          fill
          parts={row.components}
          edits={row.material_edits ?? {}}
          replay={!row.source_glb_url || row.source_glb_url === row.glb_url}
          onApi={(api) => { editor.current = api; }}
          url={row.glb_url!}
          woodModel={table === "models" ? row.id : null}
          removedParts={[]}
        />
        </div>
      )}
    </div>
  );
}
