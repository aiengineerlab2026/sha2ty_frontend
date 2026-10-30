import type { Metadata } from "next";
import { Cairo, Geist, Geist_Mono, Libre_Baskerville } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleBoot } from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Arabic text falls through to Cairo (see --font-sans in globals.css); Latin keeps Geist.
const arabic = Cairo({
  variable: "--font-arabic",
  subsets: ["arabic"],
});

const serif = Libre_Baskerville({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "sha2ty",
  description: "Vendor studio for interior 3D models.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Arabic (RTL) is the default; LocaleBoot switches to a saved English choice after hydration (lib/i18n).
    <html lang="ar" dir="rtl" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} ${arabic.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-slate-50 font-sans text-brand-navy">
        <LocaleBoot />
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
