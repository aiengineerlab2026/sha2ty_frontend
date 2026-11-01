"use client";

import { authSession } from "@/lib/auth/client";
import { useLocale, useT } from "@/lib/i18n";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowRight,
  Box,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Plus,
  Settings,
} from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { PaintSwatch } from "@/components/vendor/PaintLibrary";
import { fetchCatalog } from "@/lib/plan/api";
import { CATEGORIES, categoryOf } from "@/lib/plan/categories";
import { formatPrice } from "@/lib/plan/pricing";
import { tileLabel } from "@/lib/plan/roomMaterials";
import type { CatalogModel } from "@/lib/plan/types";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import type {
  Carpet,
  Paint,
  VendorProfile,
  WindowItem,
} from "@/lib/vendor/types";
import type { CatalogKind } from "./CatalogDetail";
import { AppDownload } from "./AppDownload";
import { sizeLabel } from "@/lib/plan/modelNormalization";

const PAGE_TITLE: Record<CatalogKind, [string, string]> = {
  models: ["Models", "Furniture ready to place in a plan"],
  paints: ["Paints", "Wall and floor finishes"],
  carpets: ["Carpets", "Laid flat at their real size"],
  windows: ["Windows", "Placed on any wall at their real size"],
};

/**
 * Landing / dashboard: welcome banner with quick metrics, then the catalogue as one carousel per asset kind.
 * With `only` (the /catalog/[kind] pages): just that kind, as a full grid.
 */
export function HomePage({ only }: { only?: CatalogKind } = {}) {
  const t = useT();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [ownModels, setOwnModels] = useState<number | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [paints, setPaints] = useState<Paint[]>([]);
  const [carpets, setCarpets] = useState<Carpet[]>([]);
  const [windows, setWindows] = useState<WindowItem[]>([]);
  const [loaded, setLoaded] = useState(false); // catalogue fetched: until then rows show placeholders, not "none yet"

  useEffect(() => {
    if (!supabaseConfigured()) return;
    // The catalogue is public: load it for everyone. Account data only when signed in.
    void Promise.all([
      supabase().from("paints").select("*").order("name"),
      supabase().from("carpets").select("*").order("name"),
      supabase().from("windows").select("*").order("name"),
      fetchCatalog("", 0, false).catch(() => ({ companies: [] })),
    ]).then(([paintRows, carpetRows, windowRows, catalog]) => {
      setPaints((paintRows.data ?? []) as Paint[]);
      setCarpets((carpetRows.data ?? []) as Carpet[]);
      setWindows((windowRows.data ?? []) as WindowItem[]);
      setModels(catalog.companies.flatMap((c) => c.models));
      setLoaded(true);
    });
    void authSession().then(async ({ data }) => {
      const user = data.session?.user;
      setSignedIn(Boolean(user));
      if (!user) return;
      const [profile, own] = await Promise.all([
        supabase().from("vendors").select("*").eq("id", user.id).maybeSingle(),
        supabase()
          .from("models")
          .select("id", { count: "exact", head: true })
          .eq("vendor_id", user.id),
      ]);
      setVendor(profile.data);
      setOwnModels(own.count ?? 0);
    });
  }, []);

  const show = (kind: CatalogKind) => !only || only === kind;
  const grid = Boolean(only);
  const colours = paints.filter((p) => (p.surface ?? "wall") === "wall");
  const floors = paints.filter((p) => p.surface === "floor");
  // One carousel per model type that has models (all empty: a single "Models" row says so).
  const modelGroups = CATEGORIES.map((c) => ({
    ...c,
    items: models.filter((m) => categoryOf(m.category) === c.id),
  })).filter((g) => g.items.length);
  const metrics: [string, number | null, string][] = [
    ["Your models", ownModels, "/vendor"],
    ["Catalogue models", models.length, "#models"],
    ["Paints & floors", paints.length, "/vendor/paints"],
    ["Carpets", carpets.length, "/vendor/carpets"],
  ];

  return (
    <div className="min-h-full bg-slate-50">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6">
        {only ? (
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-brand-navy">
              {t(PAGE_TITLE[only][0])}
            </h1>
            <p className="mt-1 text-slate-500">{t(PAGE_TITLE[only][1])}</p>
          </div>
        ) : signedIn === false ? (
          <Banner />
        ) : (
          <section className="overflow-hidden rounded-3xl bg-brand-navy text-white shadow-lg">
            <div className="flex flex-col gap-6 px-6 py-7 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                {vendor?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={vendor.logo_url}
                    alt=""
                    className="size-14 rounded-2xl bg-white object-contain p-1"
                  />
                ) : (
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-white/10 text-xl font-semibold">
                    {(vendor?.name ?? "·").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div>
                  <p className="text-sm text-slate-300">{t("Welcome back,")}</p>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {vendor?.name ?? "…"}
                  </h1>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/plan"
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-amber px-4 text-sm font-semibold text-brand-navy shadow-sm hover:bg-[#e8952a]"
                >
                  <LayoutGrid className="size-4" aria-hidden />{" "}
                  {t("Open the plan builder")}
                </Link>
                <Link
                  href="/vendor/new"
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-medium hover:bg-white/15"
                >
                  <Plus className="size-4" aria-hidden /> {t("Add model")}
                </Link>
                <Link
                  href="/vendor/settings"
                  aria-label={t("Settings")}
                  className="inline-flex size-10 items-center justify-center rounded-xl bg-white/10 hover:bg-white/15"
                >
                  <Settings className="size-4" />
                </Link>
              </div>
            </div>
            <dl className="grid grid-cols-2 border-t border-white/10 sm:grid-cols-4">
              {metrics.map(([label, value, href], i) => (
                <Link
                  key={label}
                  href={href}
                  className={`px-6 py-4 transition-colors hover:bg-white/5 sm:px-8 ${i ? "sm:border-s sm:border-white/10" : ""} ${i % 2 ? "border-s border-white/10" : ""}`}
                >
                  <dt className="text-xs text-slate-400">{t(label)}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">
                    {value ?? "–"}
                  </dd>
                </Link>
              ))}
            </dl>
          </section>
        )}

        {
          <>
            {show("models") &&
              (modelGroups.length
                ? modelGroups
                : [
                    {
                      id: "models",
                      label: "Models",
                      hint: "Furniture ready to place in a plan",
                      items: [] as CatalogModel[],
                    },
                  ]
              ).map((g, i) => (
                <Carousel
                  loading={!loaded}
                  grid={grid}
                  key={g.id}
                  id={i === 0 ? "models" : undefined}
                  title={t(g.label)}
                  subtitle={t(g.hint)}
                  count={g.items.length}
                  empty={t("No ready models yet.")}
                >
                  {g.items.map((m) => (
                    <Card
                      key={m.id}
                      href={`/catalog/models/${m.id}`}
                      price={
                        m.price == null
                          ? null
                          : formatPrice(m.price, m.price_unit ?? "item")
                      }
                      title={m.title}
                      meta={
                        sizeLabel(m) ?? t("Size not set")
                      }
                    >
                      {m.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.thumbnail}
                          alt=""
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-xs text-slate-400">
                          {t("No preview")}
                        </span>
                      )}
                    </Card>
                  ))}
                </Carousel>
              ))}
            {show("paints") && (
              <Carousel
                loading={!loaded}
                grid={grid}
                title={t("Paint colours")}
                subtitle={t("Wall finishes")}
                count={colours.length}
                empty={t("No wall paints yet.")}
              >
                {colours.map((p) => (
                  <Card
                    key={p.id}
                    href={`/catalog/paints/${p.id}`}
                    price={
                      p.price == null
                        ? null
                        : formatPrice(Number(p.price), p.price_unit ?? "m2")
                    }
                    tag={p.kind === "color" ? t("Paint") : t("Wall texture")}
                    title={p.name}
                    meta={
                      p.kind === "color" ? p.color.toUpperCase() : tileLabel(p)
                    }
                    compact
                  >
                    <PaintSwatch
                      paint={p}
                      className="size-full transition-transform duration-300 group-hover:scale-105"
                    />
                  </Card>
                ))}
              </Carousel>
            )}
            {show("paints") && (
              <Carousel
                loading={!loaded}
                grid={grid}
                title={t("Floor textures")}
                subtitle={t("Ground finishes")}
                count={floors.length}
                empty={t("No floor finishes yet.")}
              >
                {floors.map((p) => (
                  <Card
                    key={p.id}
                    href={`/catalog/paints/${p.id}`}
                    price={
                      p.price == null
                        ? null
                        : formatPrice(Number(p.price), p.price_unit ?? "m2")
                    }
                    tag={t("Floor")}
                    title={p.name}
                    meta={
                      p.kind === "color" ? p.color.toUpperCase() : tileLabel(p)
                    }
                    compact
                  >
                    <PaintSwatch
                      paint={p}
                      className="size-full transition-transform duration-300 group-hover:scale-105"
                    />
                  </Card>
                ))}
              </Carousel>
            )}
            {show("carpets") && (
              <Carousel
                loading={!loaded}
                grid={grid}
                title={t("Carpets")}
                subtitle={t("Laid flat at their real size")}
                count={carpets.length}
                empty={t("No carpets yet.")}
              >
                {carpets.map((c) => (
                  <Card
                    key={c.id}
                    href={`/catalog/carpets/${c.id}`}
                    price={
                      c.price == null
                        ? null
                        : formatPrice(Number(c.price), c.price_unit ?? "item")
                    }
                    tag={t("Carpet")}
                    title={c.name}
                    meta={`${Number(c.width_m).toFixed(2)} × ${Number(c.length_m).toFixed(2)} m`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.image_url}
                      alt=""
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </Card>
                ))}
              </Carousel>
            )}
            {show("windows") && (
              <Carousel
                loading={!loaded}
                grid={grid}
                title={t("Windows")}
                subtitle={t("Placed on any wall at their real size")}
                count={windows.length}
                empty={t("No windows yet.")}
              >
                {windows.map((w) => (
                  <Card
                    key={w.id}
                    href={`/catalog/windows/${w.id}`}
                    price={
                      w.price == null
                        ? null
                        : formatPrice(Number(w.price), w.price_unit ?? "item")
                    }
                    tag={t("Window")}
                    title={w.name}
                    meta={`${Number(w.width_m).toFixed(2)} × ${Number(w.height_m).toFixed(2)} m`}
                  >
                    {/* Cut-out images: checkerboard so transparent glass reads. */}
                    <div className="size-full bg-[conic-gradient(#f1f5f9_90deg,#fff_0_180deg,#f1f5f9_0_270deg,#fff_0)] bg-size-[16px_16px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={w.image_url}
                        alt=""
                        className="size-full object-contain p-2 transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                  </Card>
                ))}
              </Carousel>
            )}
          </>
        }
        {/* Install the mobile app (full home page only, not the per-kind catalogue pages). */}
        {!only && <AppDownload />}
      </main>
    </div>
  );
}

/**
 * Native scroll-snap row (swipe works on touch). Prev / next arrows flank it and disable at either end;
 * edges fade only on the side that has more to scroll.
 */
function Carousel({
  id,
  title,
  subtitle,
  count,
  empty,
  grid = false,
  loading = false,
  children,
}: {
  id?: string;
  title: string;
  subtitle: string;
  count: number;
  empty: string;
  grid?: boolean;
  loading?: boolean;
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    // RTL: scrollLeft runs 0 → negative, so measure its magnitude.
    const x = Math.abs(el.scrollLeft);
    setEdges({ start: x <= 2, end: x + el.clientWidth >= el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, count]);
  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    el.scrollBy({
      left: rtl * dir * el.clientWidth * 0.85,
      behavior: "smooth",
    });
  };
  // Edges fade only on a side with more to scroll; "start" is the right edge in Arabic (RTL).
  const rtl = useLocale() === "ar";
  const fade = `linear-gradient(to ${rtl ? "left" : "right"}, ${edges.start ? "#000" : "transparent"}, #000 40px, #000 calc(100% - 40px), ${edges.end ? "#000" : "transparent"})`;

  return (
    <section id={id} aria-label={title} className="scroll-mt-20">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-brand-navy">
            {title}
            {!loading && (
              <span className="rounded-full bg-brand-navy/5 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">
                {count}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        </div>
        {!grid && count > 0 && !(edges.start && edges.end) && (
          <div className="flex shrink-0 gap-2">
            <PageButton
              dir={-1}
              title={title}
              disabled={edges.start}
              onClick={() => page(-1)}
            />
            <PageButton
              dir={1}
              title={title}
              disabled={edges.end}
              onClick={() => page(1)}
            />
          </div>
        )}
      </div>
      {loading ? (
        <div className="flex gap-4 overflow-hidden pb-5 pt-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="w-60 shrink-0 animate-pulse overflow-hidden rounded-2xl border border-slate-200/80 bg-white"
            >
              <div className="aspect-4/3 bg-slate-100" />
              <div className="space-y-2 p-3.5">
                <div className="h-3 w-1/3 rounded bg-slate-100" />
                <div className="h-4 w-2/3 rounded bg-slate-100" />
                <div className="h-3 w-1/2 rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : count === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          {empty}
        </p>
      ) : grid ? (
        <div className="flex flex-wrap gap-4 pb-5 pt-2">{children}</div>
      ) : (
        <div
          ref={track}
          onScroll={measure}
          style={{ maskImage: fade, WebkitMaskImage: fade }}
          className="-mx-1 flex snap-x snap-mandatory scroll-px-1 gap-4 overflow-x-auto scroll-smooth px-1 pb-5 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {children}
        </div>
      )}
    </section>
  );
}

function PageButton({
  dir,
  title,
  disabled,
  onClick,
}: {
  dir: 1 | -1;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t(dir < 0 ? "Previous: {title}" : "Next: {title}", { title })}
      disabled={disabled}
      onClick={onClick}
      className="flex size-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition duration-150 hover:-translate-y-px hover:border-brand-navy hover:bg-brand-navy hover:text-white hover:shadow-md active:translate-y-0 active:scale-95 disabled:pointer-events-none disabled:opacity-35 disabled:shadow-none"
    >
      {dir < 0 ? (
        <ChevronLeft className="rtl:-scale-x-100 size-4" />
      ) : (
        <ChevronRight className="rtl:-scale-x-100 size-4" />
      )}
    </button>
  );
}

/** Default banner for visitors: build a 3D apartment, with a "Try it" call to action. */
function Banner() {
  const t = useT();
  return (
    <section className="relative isolate overflow-hidden rounded-3xl bg-brand-navy px-6 py-10 text-white shadow-lg sm:px-10 sm:py-14">
      <div
        aria-hidden
        className="absolute -end-24 -top-24 -z-10 size-96 rounded-full bg-brand-amber/20 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -bottom-32 start-1/3 -z-10 size-80 rounded-full bg-sky-400/10 blur-3xl"
      />
      <div className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-amber">
            <Box className="size-3.5" aria-hidden />{" "}
            {t("Free 3D apartment builder")}
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("Create your apartment in 3D")}
          </h1>
          <p className="mt-3 text-slate-300">
            {t(
              "Upload a floor plan or enter a room, then furnish it with real models, paints, carpets and windows at their real size. Walk through it before you buy.",
            )}
          </p>
          <Link
            href="/plan"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-brand-amber px-6 text-sm font-semibold text-brand-navy shadow-sm transition hover:bg-[#e8952a] hover:shadow-md"
          >
            {t("Try it")}{" "}
            <ArrowRight className="rtl:-scale-x-100 size-4" aria-hidden />
          </Link>
        </div>
        {/* Isometric room sketch. */}
        <svg
          viewBox="0 0 240 180"
          aria-hidden
          className="hidden w-64 shrink-0 md:block lg:w-80"
        >
          <path
            d="M120 20 220 70 120 120 20 70Z"
            fill="#ffffff14"
            stroke="#ffffff40"
            strokeWidth={1.5}
          />
          <path
            d="M20 70v60l100 50v-60Z"
            fill="#ffffff0d"
            stroke="#ffffff30"
            strokeWidth={1.5}
          />
          <path
            d="M220 70v60l-100 50v-60Z"
            fill="#ffffff1a"
            stroke="#ffffff30"
            strokeWidth={1.5}
          />
          <path
            d="M120 20v50M120 70 70 95M120 70l50 25"
            stroke="#ffffff30"
            strokeWidth={1.5}
          />
          <path d="M60 78l30 15 22-11-30-15Z" fill="#F2A33A" />
          <path d="M60 78v8l30 15v-8ZM90 93v8l22-11v-8Z" fill="#c9812a" />
          <path d="M150 52l28 14 14-7-28-14Z" fill="#ffffffb0" />
          <path d="M178 66v18l14-7V59Z" fill="#ffffff70" />
        </svg>
      </div>
    </section>
  );
}

function Card({
  href,
  tag,
  title,
  meta,
  price,
  compact = false,
  children,
}: {
  href: string;
  /** Type chip on the image (models skip it: their row already says the type). */
  tag?: string;
  title: string;
  meta: string;
  /** Formatted price, or null for "Price on request". */
  price: string | null;
  compact?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Link
      href={href}
      className={`group flex shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5 outline-none transition duration-200 hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl hover:shadow-slate-900/10 focus-visible:ring-2 focus-visible:ring-brand-amber ${compact ? "w-44" : "w-60"}`}
    >
      <div
        className={`relative overflow-hidden bg-slate-100 ${compact ? "aspect-square" : "aspect-4/3"}`}
      >
        {children}
        {tag && (
          <span className="absolute start-2.5 top-2.5 max-w-[80%] truncate rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-slate-700 shadow-sm backdrop-blur">
            {tag}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <h3 className="truncate text-sm font-semibold text-brand-navy">
          {title}
        </h3>
        <p className="truncate text-xs tabular-nums text-slate-500">
          {/* Sizes and hex codes are Latin: isolate them so RTL does not reorder "m" before the numbers. */}
          <bdi dir="auto">{meta}</bdi>
        </p>
        <p
          className={`mt-auto pt-1.5 text-[15px] tabular-nums ${price ? "font-semibold text-brand-navy" : "text-sm text-slate-400"}`}
        >
          {price ?? t("Price on request")}
        </p>
      </div>
    </Link>
  );
}
