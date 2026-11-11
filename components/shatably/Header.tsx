"use client";

import { apiFetch } from "@/lib/api";
import { CARPETS_ENABLED, WINDOWS_ENABLED } from "@/lib/features";
import { setLocale, useLocale, useT } from "@/lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, LogOut, Menu, PackageCheck, Shapes, Shield } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getUser, logout, onAuthChange, type AuthUser } from "@/lib/auth/client";
import type { VendorProfile } from "@/lib/vendor/types";
import { Logo, LogoMark } from "./Logo";
import { AppDownloadDialog } from "@/components/home/AppDownload";
import { CartMenu } from "./CartMenu";
import { NotificationBell } from "@/components/tasks/NotificationBell";

type NavItem = { href: string; label: string };

/** "Get the app" opens the install popup (QR code + download link) instead of navigating. */
const GET_APP = "#get-app";

/** One header for everyone (guests, customers, vendors): the public catalogue. */
const CATALOG_NAV: NavItem[] = [
  { href: "/catalog/models", label: "Models" },
  { href: "/catalog/paints", label: "Paints" },
  ...(CARPETS_ENABLED ? [{ href: "/catalog/carpets", label: "Carpets" }] : []),
  ...(WINDOWS_ENABLED ? [{ href: "/catalog/windows", label: "Windows" }] : []),
  { href: "/plan", label: "Plan" },
  { href: "/tasks", label: "Requests" },
  { href: GET_APP, label: "Get the app" },
];

/** The most specific nav entry containing the path (/catalog/models/x is Models). */
function activeHref(pathname: string, nav: NavItem[]) {
  if (/^\/vendor\/(login|signup|reset-password)/.test(pathname)) return null;
  const hits = nav.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return hits.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/** Full-width app bar: brand · navigation + page actions · account. `actions` is the page's own toolbar. */
// ponytail: `vendor` kept so callers compile; the header is the same for everyone now.
export function Header({ actions }: { vendor?: VendorProfile | null; actions?: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [getApp, setGetApp] = useState(false);
  // Anyone signed in (customer or vendor).
  const [user, setUser] = useState<AuthUser | null>(null);
  // Requests are a signed-in feature: guests do not see the link (the page itself asks them to log in).
  const nav = CATALOG_NAV.filter((item) => user || item.href !== "/tasks");
  const current = activeHref(pathname, nav);
  // The links show whenever they fit beside the brand and the account controls (measured, so a desktop never gets the
  // menu button for links that would fit); the menu button only when they do not. With page actions (the plan
  // editor) the links share the bar with them, so they stay in the menu until 2xl as before.
  const navRef = useRef<HTMLElement>(null);
  const linksRef = useRef<HTMLUListElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const bar = navRef.current;
    const links = linksRef.current;
    if (!bar || !links || actions) return;
    const check = () => setFits(links.scrollWidth <= bar.clientWidth);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(bar);
    observer.observe(links);
    return () => observer.disconnect();
  }, [actions, nav.length]);
  const showLinks = actions ? "hidden 2xl:flex" : fits ? "flex" : "pointer-events-none invisible absolute flex";
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    void getUser().then(setUser);
    return onAuthChange(setUser);
  }, []);
  // Checked again whenever the session changes: signing out ends the admin's session too.
  useEffect(() => {
    void apiFetch("/api/auth/admin-me")
      .then((res) => res.json())
      .then((body) => setAdmin(Boolean(body?.admin)))
      .catch(() => setAdmin(false));
  }, [user]);

  const signOut = async () => {
    setAdmin(false);
    setUser(null);
    await logout();
    router.push("/vendor/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/90 backdrop-blur">
      <div className="flex h-16 w-full items-center gap-2 px-3 sm:gap-5 sm:px-5 xl:gap-8">
        {/* With page actions (the plan editor) the links collapse into the menu until 2xl, so the
            document title and its save badge keep their room. */}
        <AppDownloadDialog open={getApp} onOpenChange={setGetApp} />
        <Link href="/" className="flex shrink-0 items-center" aria-label={t("sha2ty home")}>
          {/* Phones: the mark alone, so page actions (plan title, Save) keep their room. */}
          <span className="sm:hidden">
            <LogoMark size={34} />
          </span>
          <span className="hidden sm:inline-flex">
            <Logo size={40} />
          </span>
        </Link>

        {/* The links show only when the space left by the brand and the account controls fits them all (a container
            query on this nav, so a longer studio nav or a wider account area never overlaps); otherwise the menu. */}
        <nav ref={navRef} className="relative flex h-full min-w-9 flex-1 items-center gap-4 xl:gap-6" aria-label={t("Main")}>
          {(actions || !fits) && <MobileNav nav={nav} current={current} signedIn={Boolean(user)} admin={admin} wideOnly={Boolean(actions)} onGetApp={() => setGetApp(true)} />}
          {/* Kept laid out when hidden (invisible): its natural width is what is measured. */}
          <ul ref={linksRef} aria-hidden={!actions && !fits ? true : undefined} className={`h-full shrink-0 items-center gap-1 whitespace-nowrap ${showLinks}`}>
            {nav.map((item) => {
              const active = current === item.href;
              return (
                <li key={item.href} className="h-full">
                  <NavLink
                    href={item.href}
                    onGetApp={() => setGetApp(true)}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex h-full items-center px-2 text-sm font-semibold transition-colors xl:px-3 ${
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
                  </NavLink>
                </li>
              );
            })}
          </ul>
          {actions && <div className="flex min-w-0 flex-1 items-center gap-2">{actions}</div>}
        </nav>

        <div className="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
          {admin && (
            <Link
              href="/admin"
              title={t("Admin")}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-navy"
            >
              <Shield className="size-4" aria-hidden />
              <span className="sr-only sm:not-sr-only">{t("Admin")}</span>
            </Link>
          )}
          <LanguageSwitch />
          {user && <NotificationBell me={user.id} />}
          {user && (
            <Link
              href="/designs"
              title={t("My designs")}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-navy`}
            >
              <Shapes className="size-4" aria-hidden />
              <span className="sr-only 2xl:not-sr-only">{t("My designs")}</span>
            </Link>
          )}
          <CartMenu />
          {user ? (
            <>
              <Link
                href="/orders"
                title={t("Bought items")}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-brand-navy"
              >
                <PackageCheck className="size-4" aria-hidden />
                <span className="sr-only 2xl:not-sr-only">{t("Bought items")}</span>
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                title={user.email}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-red-600"
              >
                <LogOut className="size-4" aria-hidden />
                <span className="hidden sm:inline">{t("Sign out")}</span>
              </button>
            </>
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

/** When the links do not fit beside the brand and account controls they live in this menu, so the bar never overflows. */
/** A header nav entry: a link, or for "Get the app" a button that opens the install popup. */
function NavLink({ href, onGetApp, children, ...rest }: { href: string; onGetApp: () => void; className: string; children: ReactNode; "aria-current"?: "page" }) {
  if (href === GET_APP)
    return (
      <button type="button" onClick={onGetApp} {...rest}>
        {children}
      </button>
    );
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

function MobileNav({ nav, current, signedIn, admin, wideOnly, onGetApp }: { nav: NavItem[]; current: string | null; signedIn: boolean; admin: boolean; wideOnly: boolean; onGetApp: () => void }) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("Menu")}
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-brand-navy ${wideOnly ? "2xl:hidden" : ""}`}
        >
          <Menu className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-52 p-1.5">
        {nav.map((item) =>
          item.href === GET_APP ? (
            <DropdownMenuItem key={item.href} onSelect={onGetApp} className="cursor-pointer">
              {t(item.label)}
            </DropdownMenuItem>
          ) : (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href} aria-current={current === item.href ? "page" : undefined} className={`cursor-pointer ${current === item.href ? "font-semibold text-brand-navy" : ""}`}>
              {current === item.href && <span className="size-1.5 rounded-full bg-brand-amber" aria-hidden />}
              {t(item.label)}
            </Link>
          </DropdownMenuItem>
          ),
        )}
        {admin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/admin" className="cursor-pointer">
                {t("Admin")}
              </Link>
            </DropdownMenuItem>
          </>
        )}
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
// ponytail: two languages, so no search box; add one if the list grows past ~8.
const LANGUAGES = [
  { code: "ar", short: "AR", name: "العربية", region: "مصر", Flag: EgyptFlag },
  { code: "en", short: "EN", name: "English", region: "United Kingdom", Flag: UkFlag },
] as const;

function FlagCircle({ Flag, size = "size-5" }: { Flag: () => ReactNode; size?: string }) {
  return (
    <span className={`${size} shrink-0 overflow-hidden rounded-full shadow-[0_0_0_1px_rgb(0_0_0/0.08)]`}>
      <Flag />
    </span>
  );
}

/** Flag + code trigger; the dropdown picks the language. */
export function LanguageSwitch() {
  const locale = useLocale();
  const t = useT();
  const current = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[1];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("Language")}
          className="group inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent ps-2 pe-1.5 text-sm font-semibold text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-50 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-amber/40 data-[state=open]:border-slate-200 data-[state=open]:bg-slate-50 data-[state=open]:text-brand-navy"
        >
          <FlagCircle Flag={current.Flag} />
          <span className="hidden tracking-wide sm:inline">{current.short}</span>
          <ChevronDown className="size-3.5 text-slate-400 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56 p-1.5">
        <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-xs font-medium text-slate-400">{t("Language")}</DropdownMenuLabel>
        {LANGUAGES.map(({ code, short, name, region, Flag }) => {
          const active = code === locale;
          return (
            <DropdownMenuItem
              key={code}
              lang={code}
              onSelect={() => setLocale(code)}
              className={`cursor-pointer gap-3 rounded-md px-2 py-2 ${active ? "bg-brand-amber/10 focus:bg-brand-amber/15" : ""}`}
            >
              <FlagCircle Flag={Flag} size="size-7" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-brand-navy">{name}</span>
                <span className="block truncate text-xs text-slate-500">{region}</span>
              </span>
              {active ? <Check className="size-4 text-brand-amber" aria-hidden /> : <span className="text-xs font-semibold text-slate-400">{short}</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Inline SVG flags: emoji flags don't render on Windows. Both are cropped to a square for the circle.
function UkFlag() {
  return (
    <svg viewBox="15 0 30 30" className="size-full" aria-hidden>
      <clipPath id="uk-flag-diagonals">
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#uk-flag-diagonals)" stroke="#C8102E" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

function EgyptFlag() {
  return (
    <svg viewBox="0 0 30 30" className="size-full" aria-hidden>
      <path d="M0,0 h30 v10 h-30 z" fill="#CE1126" />
      <path d="M0,10 h30 v10 h-30 z" fill="#fff" />
      <path d="M0,20 h30 v10 h-30 z" fill="#000" />
      {/* ponytail: eagle simplified to a gold mark; it's ~5px at this size */}
      <path d="M15,11.5 l2.6,1.6 -0.6,4.6 -2,1 -2,-1 -0.6,-4.6 z" fill="#C09300" />
    </svg>
  );
}
