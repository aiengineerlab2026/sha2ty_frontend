"use client";

import Image from "next/image";
import { Box, Camera, Smartphone } from "lucide-react";
import { useT } from "@/lib/i18n";

/** "Get the app" card: the install QR code (public/mobile-app-qr.png) and what the app adds over the web. */
export function AppDownload() {
  const t = useT();
  const perks: [typeof Box, string][] = [
    [Camera, "See furniture in your room through the camera, at its real size (AR)"],
    [Box, "Browse models, wall finishes, paints and carpets"],
    [Smartphone, "Vendors add models from a photo"],
  ];
  return (
    <section aria-labelledby="get-app" className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:p-8">
        <div className="shrink-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {/* unoptimized: the original PNG, so lossy re-encoding never blurs the code's edges. */}
          <Image src="/mobile-app-qr.png" alt={t("QR code to install the sha2ty mobile app")} width={168} height={161} className="size-40" unoptimized />
        </div>
        <div className="min-w-0 space-y-3 text-center sm:text-start">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-amber/15 px-3 py-1 text-xs font-semibold text-brand-navy">
            <Smartphone className="size-3.5" aria-hidden /> {t("Android")}
          </p>
          <h2 id="get-app" className="text-2xl font-semibold tracking-tight text-brand-navy">
            {t("Get the sha2ty app")}
          </h2>
          <p className="text-sm text-slate-600">{t("Scan the code with your phone's camera to install the app.")}</p>
          <ul className="space-y-1.5 text-sm text-slate-600">
            {perks.map(([Icon, text]) => (
              <li key={text} className="flex items-center justify-center gap-2 sm:justify-start">
                <Icon className="size-4 shrink-0 text-brand-amber" aria-hidden /> {t(text)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
