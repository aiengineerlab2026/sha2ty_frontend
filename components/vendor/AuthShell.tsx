"use client";

import { useT } from "@/lib/i18n";
import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Logo } from "@/components/shatably/Logo";
import { LanguageSwitch } from "@/components/shatably/Header";
import dynamic from "next/dynamic";

const AuthRoom = dynamic(() => import("./AuthRoom").then((m) => m.AuthRoom), { ssr: false });

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap" });

/**
 * Split-screen auth layout: brand showcase (an apartment furnished with real catalogue models) on the left,
 * the form centred on the right. Only the logo in the top bar — no app navigation while signing in.
 */
export function AuthShell({ title, subtitle, children, wide = false }: { title: ReactNode; subtitle: ReactNode; children: ReactNode; wide?: boolean }) {
  const t = useT();
  return (
    // Large screens: exactly one viewport tall, no page scroll (the form column scrolls only if the
    // window is unusually short). Phones and tablets: a normal scrolling page.
    <div className={`grid min-h-dvh bg-white lg:h-dvh lg:grid-cols-2 lg:overflow-hidden ${jakarta.className}`}>
      <aside className="relative hidden overflow-hidden bg-brand-navy lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -start-32 -top-32 size-[28rem] rounded-full bg-brand-amber/10 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 end-0 size-[32rem] rounded-full bg-sky-400/10 blur-3xl" aria-hidden />
        <div className="relative flex min-h-0 flex-1 flex-col p-8 xl:p-12">
          <Link href="/" aria-label={t("sha2ty home")} className="self-start">
            <Logo size={44} tone="light" label={t("Vendor Studio")} />
          </Link>
          <div className="flex min-h-0 flex-1 items-center justify-center py-6">
            <AuthRoom className="size-full min-h-64" />
          </div>
          <div className="max-w-md shrink-0 space-y-5">
            <h2 className="text-[28px] font-bold leading-[1.15] tracking-tight text-white xl:text-[32px]">{t("Your catalogue, placed in real homes at real size.")}</h2>
            <ul className="space-y-3 text-[15px] text-slate-300">
              {["Turn product photos into 3D models", "Paints, floors and carpets priced per m²", "Shoppers furnish their own floor plan"].map((point) => (
                <li key={point} className="flex items-center gap-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-amber/15 text-brand-amber ring-1 ring-brand-amber/25">
                    <Check className="size-3" aria-hidden />
                  </span>
                  {t(point)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col lg:min-h-0 lg:overflow-y-auto">
        {/* On large screens the banner carries the logo, so this one stays small; on phones it is the brand. */}
        <header className="flex h-14 shrink-0 items-center justify-between px-5 sm:h-20 sm:px-10 lg:h-16">
          <Link href="/" aria-label={t("sha2ty home")} className="lg:invisible">
            <Logo size={40} />
          </Link>
          <LanguageSwitch />
        </header>
        <main className="flex flex-1 items-center justify-center px-5 pb-5 sm:px-10 sm:pb-10 lg:py-8">
          <div className={`w-full ${wide ? "max-w-[560px]" : "max-w-[440px]"}`}>
            <h1 className={`font-bold leading-tight tracking-tight text-brand-navy ${wide ? "text-2xl xl:text-[28px]" : "text-[28px]"}`}>{typeof title === "string" ? t(title) : title}</h1>
            <p className={`mt-1.5 leading-relaxed text-slate-500 ${wide ? "text-sm" : "text-[15px]"}`}>{typeof subtitle === "string" ? t(subtitle) : subtitle}</p>
            <div className={wide ? "mt-4 sm:mt-6" : "mt-9"}>{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
