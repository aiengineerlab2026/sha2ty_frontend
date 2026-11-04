import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Cairo, Geist, Geist_Mono, Libre_Baskerville } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleProvider, type Locale } from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Cairo is the whole interface in Arabic (its Latin letters too, so mixed text matches); English keeps
// Geist with Cairo for any Arabic. See the language font stacks in globals.css.
const arabic = Cairo({
  variable: "--font-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const serif = Libre_Baskerville({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "700"],
});

// The language cookie decides `<html lang>` before paint, so this layout cannot be a static shell.
export const instant = false;

export const metadata: Metadata = {
  title: "sha2ty",
  description: "Vendor studio for interior 3D models.",
};

// One-time: a language saved before the cookie existed is copied across, and the page reloads once if the
// HTML was rendered in the other language. After that the cookie is the source of truth.
const MIGRATE_LANG = `(function(){try{if(/(?:^|; )lang=(ar|en)/.test(document.cookie))return;var s=localStorage.getItem("lang");if(s!=="en"&&s!=="ar")return;document.cookie="lang="+s+"; Path=/; Max-Age=31536000; SameSite=Lax";if(s!==document.documentElement.lang)location.replace(location.pathname+location.search+location.hash);}catch(e){}})();`;

// crypto.randomUUID only exists on HTTPS and localhost; the app's editor opens the site over plain HTTP on the LAN
// (http://192.168.x.x:3000). getRandomValues works everywhere: an RFC 4122 v4 id from it, before any other script.
const UUID_FALLBACK = `(function(){var c=window.crypto;if(!c||c.randomUUID)return;c.randomUUID=function(){var b=c.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;var h=Array.prototype.map.call(b,function(x){return(x+256).toString(16).slice(1)}).join("");return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20)};})();`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const saved = (await cookies()).get("lang")?.value;
  const locale: Locale = saved === "en" ? "en" : "ar";
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} ${arabic.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-slate-50 font-sans text-brand-navy">
        <script dangerouslySetInnerHTML={{ __html: UUID_FALLBACK + MIGRATE_LANG }} />
        <LocaleProvider locale={locale}>
          <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
