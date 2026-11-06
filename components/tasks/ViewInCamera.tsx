"use client";

import { useState } from "react";
import { Camera, Copy } from "lucide-react";
import { appView, useInApp } from "@/lib/app";
import { useT } from "@/lib/i18n";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** "View in camera": the request's model in the room, at its size. In the Sha2ty app its own AR view opens
 * (mobile/src/app/ar/[id].tsx, sized to the request's dimensions); in a browser on Android, Google's Scene Viewer.
 * Elsewhere (desktop, iPhone browsers: no AR for a GLB) it says to open the request on a phone, with its link. */
export function ViewInCamera({ glb, title, size }: { glb: string; title: string; size: { width: number; height: number; depth: number } | null }) {
  const t = useT();
  const inApp = useInApp();
  const [help, setHelp] = useState(false);
  const [copied, setCopied] = useState(false);

  const open = () => {
    if (inApp) {
      appView()?.postMessage(JSON.stringify({ type: "ar", glb, title, w: size?.width, h: size?.height, d: size?.depth }));
    } else if (/android/i.test(navigator.userAgent)) {
      // ponytail: Scene Viewer shows the file at its own scale (no resize to the request's size); the app does resize.
      const viewer = `arvr.google.com/scene-viewer/1.2?file=${encodeURIComponent(glb)}&mode=ar_preferred&resizable=false&title=${encodeURIComponent(title)}`;
      window.location.href = `intent://${viewer}#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(window.location.href)};end;`;
    } else {
      setHelp(true);
    }
  };

  return (
    <>
      <button type="button" onClick={open} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-brand-navy shadow-sm transition hover:bg-slate-50">
        <Camera className="size-4" aria-hidden /> {t("View in camera")}
      </button>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="max-w-sm gap-3 p-6">
          <DialogTitle className="text-lg font-semibold text-brand-navy">{t("View in camera")}</DialogTitle>
          <DialogDescription className="text-sm text-slate-600">
            {t("Open this request on your Android phone (in the Sha2ty app or the browser) to see the model in your room through the camera.")}
          </DialogDescription>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => setCopied(true))}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-brand-amber px-4 text-sm font-semibold text-brand-navy transition hover:bg-[#e8952a]"
          >
            <Copy className="size-4" aria-hidden /> {copied ? t("Link copied") : t("Copy the link")}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
