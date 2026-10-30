"use client";

import { setLocale, useLocale, useT } from "@/lib/i18n";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Languages, LayoutGrid, LogOut, Map as MapIcon, Menu, Plus, Settings } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getUser, logout, onAuthChange, type AuthUser } from "@/lib/auth/client";
import type { VendorProfile } from "@/lib/vendor/types";
import { Logo, LogoMark } from "./Logo";
import { CartMenu } from "./CartMenu";

type NavItem = { href: string; label: string };

/** Vendors manage their own items in the studio. */
const STUDIO_NAV: NavItem[] = [
  { href: "/vendor", label: "Models" },
  { href: "/vendor/paints", label: "Paints" },
  { href: "/vendor/carpets", label: "Carpets" },
  { href: "/vendor/windows", label: "Windows" },
  { href: "/plan", label: "Plan" },
];

/** Everyone else (guests, customers) browses the public catalogue. */
const CATALOG_NAV: NavItem[] = [
  { href: "/catalog/models", label: "Models" },
  { href: "/catalog/paints", label: "Paints" },
  { href: "/catalog/carpets", label: "Carpets" },
  { href: "/catalog/windows", label: "Windows" },
  { href: "/plan", label: "Plan" },
];

/** The most specific nav entry containing the path (/vendor/paints is Paints, not Models). */
function activeHref(pathname: string, nav: NavItem[]) {
  if (/^\/vendor\/(login|signup|reset-password)/.test(pathname)) return null;
  const hits = nav.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return hits.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/** Full-width app bar: brand · navigation + page actions · account. `actions` is the page's own toolbar. */
export function Header({ vendor, actions }: { vendor?: VendorProfile | null; actions?: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const nav = vendor ? STUDIO_NAV : CATALOG_NAV;
  const current = activeHref(pathname, nav);
  // Signed in without a vendor profile: a customer (or a vendor page still loading its profile).
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    void getUser().then(setUser);
    return onAuthChange(setUser);
  }, []);

  const signOut = async () => {
    await logout();
    router.push("/vendor/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/90 backdrop-blur">
      <div className="flex h-16 w-full items-center gap-2 px-3 sm:gap-5 sm:px-5 xl:gap-8">
        {/* With page actions (the plan editor) the links collapse into the menu until 2xl, so the
            document title and its save badge keep their room. */}
        <MobileNav nav={nav} current={current} signedIn={Boolean(vendor)} wideOnly={Boolean(actions)} />
        <Link href={vendor ? "/vendor" : "/"} className="flex shrink-0 items-center" aria-label={t("sha2ty home")}>
          {/* Phones: the mark alone, so page actions (plan title, Save) keep their room. */}
          <span className="sm:hidden">
            <LogoMark size={34} />
          </span>
          <span className="hidden sm:inline-flex">
            <Logo size={40} />
          </span>
        </Link>

        <nav className="flex h-full min-w-0 flex-1 items-center gap-4 xl:gap-6" aria-label={t("Main")}>
          <ul className={`hidden h-full shrink-0 items-center gap-1 ${actions ? "2xl:flex" : "lg:flex"}`}>
            {nav.map((item) => {
              const active = current === item.href;
              return (
                <li key={item.href} className="h-full">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex h-full items-center px-2 text-sm font-medium transition-colors xl:px-3 ${
                      active ? "text-brand-navy" : "text-slate-500 hover:text-brand-navy"
                    }`}
                  >
                    <span className="rounded-md px-1 py-1 transition-colors group-hover:bg-slate-50">{t(item.label)}</span>
                    {/* Active indicator: an amber line on the header's bottom edge; hover previews it in slate. */}
                    <span
                      aria-hidden
                      className={`absolute inset-x-2 -bottom-px h-0.5 xl:inset-x-3 rounded-full transition-all duration-200 ${
                        active ? "bg-brand-amber opacity-100" : "bg-slate-300 opacity-0 group-hover:opacity-100"
                      }`}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
          {actions && <div className="flex min-w-0 flex-1 items-center gap-2">{actions}</div>}
        </nav>

        <div className="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
          {vendor && (
            <Link
              href="/vendor/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-amber px-3.5 font-semibold text-brand-navy shadow-sm shadow-brand-amber/30 transition hover:-translate-y-px hover:bg-[#e8952a] hover:shadow-md active:translate-y-0"
            >
              <Plus className="size-4" aria-hidden />
              <span className="hidden sm:inline">{t("Add model")}</span>
            </Link>
          )}
          <LanguageSwitch />
          <CartMenu />
          {vendor ? (
            <ProfileMenu vendor={vendor} onSignOut={() => void signOut()} />
          ) : user ? (
            <button
              type="button"
              onClick={() => void signOut()}
              title={user.email}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-red-600"
            >
              <LogOut className="size-4" aria-hidden />
              <span className="hidden sm:inline">{t("Sign out")}</span>
            </button>
          ) : (
            <>
              <Link href="/vendor/login" className="hidden h-9 items-center rounded-lg px-3 font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-navy sm:inline-flex">
                {t("Log in")}
              </Link>
              <Link
                href="/vendor/signup"
                className="inline-flex h-9 items-center rounded-lg bg-brand-amber px-3.5 font-semibold text-brand-navy shadow-sm transition hover:-translate-y-px hover:bg-[#e8952a] hover:shadow-md"
              >
                {t("Sign up")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Avatar({ vendor, size = "size-8" }: { vendor: VendorProfile; size?: string }) {
  return vendor.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={vendor.logo_url} alt="" className={`${size} shrink-0 rounded-full bg-white object-cover ring-1 ring-slate-200`} />
  ) : (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-brand-navy text-xs font-semibold text-white`}>{vendor.name.slice(0, 1).toUpperCase()}</span>
  );
}

/** Account cluster: avatar + name opens a menu with the studio's pages, settings and log out. */
function ProfileMenu({ vendor, onSignOut }: { vendor: VendorProfile; onSignOut: () => void }) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg border border-transparent ps-1 pe-2 transition-colors hover:border-slate-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-amber/40 data-[state=open]:border-slate-200 data-[state=open]:bg-slate-50"
          aria-label={t("Account menu for {name}", { name: vendor.name })}
        >
          <Avatar vendor={vendor} size="size-7" />
          <span className="hidden max-w-36 truncate font-medium text-slate-700 lg:inline">{vendor.name}</span>
          <ChevronDown className="size-3.5 text-slate-400" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60 p-1.5">
        <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2 font-normal">
          <Avatar vendor={vendor} size="size-9" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-brand-navy">{vendor.name}</span>
            {vendor.location && <span className="block truncate text-xs text-slate-500">{vendor.location}</span>}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/vendor" className="cursor-pointer gap-2">
            <LayoutGrid className="size-4" aria-hidden /> {t("My models")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/plan" className="cursor-pointer gap-2">
            <MapIcon className="size-4" aria-hidden /> {t("Plan builder")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/vendor/settings" className="cursor-pointer gap-2">
            <Settings className="size-4" aria-hidden /> {t("Settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} className="cursor-pointer gap-2 text-red-600 focus:bg-red-50 focus:text-red-700">
          <LogOut className="size-4" aria-hidden /> {t("Log out")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Below lg the nav links live in a menu, so the bar never overflows on tablets and phones. */
function MobileNav({ nav, current, signedIn, wideOnly }: { nav: NavItem[]; current: string | null; signedIn: boolean; wideOnly: boolean }) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("Menu")}
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-brand-navy ${wideOnly ? "2xl:hidden" : "lg:hidden"}`}
        >
          <Menu className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-52 p-1.5">
        {nav.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href} aria-current={current === item.href ? "page" : undefined} className={`cursor-pointer ${current === item.href ? "font-semibold text-brand-navy" : ""}`}>
              {current === item.href && <span className="size-1.5 rounded-full bg-brand-amber" aria-hidden />}
              {t(item.label)}
            </Link>
          </DropdownMenuItem>
        ))}
        {!signedIn && (
          <>
            {/* On phones the bar shows only Sign up; Log in lives here. */}
            <DropdownMenuSeparator className="sm:hidden" />
            <DropdownMenuItem asChild className="sm:hidden">
              <Link href="/vendor/login" className="cursor-pointer">
                {t("Log in")}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Arabic ⇄ English. Shows the language you switch to, in that language. */
export function LanguageSwitch() {
  const locale = useLocale();
  const next = locale === "ar" ? "en" : "ar";
  return (
    <button
      type="button"
      onClick={() => setLocale(next)}
      lang={next}
      aria-label={next === "en" ? "Switch to English" : "التبديل إلى العربية"}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-navy"
    >
      <Languages className="size-4" aria-hidden />
      <span className="hidden sm:inline">{next === "en" ? "English" : "العربية"}</span>
    </button>
  );
}
