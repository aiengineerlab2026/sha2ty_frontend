"use client";

import Image from "next/image";
import { Download, Smartphone } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** The Android build the QR code opens (EAS): the same link, for a click on desktop or a tap on a phone. */
export const APP_DOWNLOAD_URL = "https://expo.dev/accounts/alaahamed/projects/shatably/builds/2196baf9-458d-4b6f-9417-0ba4962e9827";

/** "Get the app" from the header: the same QR code and download link in a popup, on any page. */
export function AppDownloadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs gap-3 p-6 text-center sm:max-w-xs">
        <DialogTitle className="text-xl font-semibold text-brand-navy">{t("Get the sha2ty app")}</DialogTitle>
        <DialogDescription className="text-sm text-slate-600">{t("Scan the code with your phone's camera to install the app.")}</DialogDescription>
        <div className="mx-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {/* unoptimized: the original PNG, so lossy re-encoding never blurs the code's edges. */}
          <Image src="/mobile-app-qr.png" alt={t("QR code to install the sha2ty mobile app")} width={208} height={199} className="size-52" unoptimized />
        </div>
        <p className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500">
          <Smartphone className="size-3.5" aria-hidden /> {t("Android")}
        </p>
        <a
          href={APP_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-amber px-5 text-sm font-semibold text-brand-navy shadow-sm transition hover:bg-[#e8952a] hover:shadow-md"
        >
          <Download className="size-4" aria-hidden /> {t("Download the app")}
        </a>
      </DialogContent>
    </Dialog>
  );
}
