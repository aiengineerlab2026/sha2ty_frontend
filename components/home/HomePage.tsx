"use client";

import { VendorRequestsPanel } from "@/components/tasks/VendorRequestsPanel";
import { CARPETS_ENABLED } from "@/lib/features";
import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
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
  Trash2,
} from "lucide-react";
import { customisedModels, deleteDesign } from "@/lib/designs/api";
import { vendorBrands } from "@/lib/tasks";
import { Header } from "@/components/shatably/Header";
import { PaintSwatch } from "@/components/vendor/PaintLibrary";
import { fetchCatalog } from "@/lib/plan/api";
import { CATALOG_GROUPS, groupOf } from "@/lib/plan/categories";
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
  // Who is signed in, for the welcome: the studio name for vendors, else the name given at sign-up (or the email).
  const [userName, setUserName] = useState<string | null>(null);
  const [ownModels, setOwnModels] = useState<number | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [paints, setPaints] = useState<Paint[]>([]);
  const [carpets, setCarpets] = useState<Carpet[]>([]);
  const [windows, setWindows] = useState<WindowItem[]>([]);
  // Upholstery fabrics (vendors' library) on the home page, and each paint's / fabric's vendor (name and logo).
  const [fabrics, setFabrics] = useState<FabricItem[]>([]);
  const [brands, setBrands] = useState<Map<string, Owner>>(new Map());
  const [platformIds, setPlatformIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false); // catalogue fetched: until then rows show placeholders, not "none yet"

  useEffect(() => {
    if (!supabaseConfigured()) return;
    // Home shows furniture and paints. Carpets and windows load on their own /catalog page, not here.
    let live = true;
    // Loaded once every query of this page has answered (home: furniture and paints), so no row says "none yet" early.
    let pending = (only === "models" ? 0 : 1) + (!only || only === "models" ? 1 : 0) + (only ? 0 : 1);
    const finish = () => live && --pending <= 0 && setLoaded(true);
    if (!only || only === "models") {
      void fetchCatalog("", 0, false)
        .then((catalog) => live && setModels(catalog.companies.flatMap((c) => c.models)))
        .catch(() => live && setModels([]))
        .finally(finish);
    }
    if (only !== "models") {
      void supabase()
        .from(only ?? "paints")
        .select("*")
        .order("name")
        // A Supabase query is only "then-able" (no .finally): finish on both outcomes.
        .then(({ data }) => {
          if (live) {
            if (!only || only === "paints") setPaints((data ?? []) as Paint[]);
            if (only === "carpets") setCarpets((data ?? []) as Carpet[]);
            if (only === "windows") setWindows((data ?? []) as WindowItem[]);
          }
          finish();
        }, finish);
    }
    if (!only) {
      void supabase()
        .from("fabrics")
        .select("id, name, texture_url, price_per_m, vendor_id")
        .eq("kind", "fabric")
        .order("name")
        .then(({ data }) => {
          if (live) setFabrics((data ?? []) as FabricItem[]);
          finish();
        }, finish);
    }
    return () => {
      live = false;
    };
  }, [only]);

  // Guests cannot read the vendors table: names and logos come from the backend's public brands list.
  useEffect(() => {
    const ids = [...new Set([...paints, ...fabrics].map((x) => (x as { vendor_id?: string | null }).vendor_id).filter((id): id is string => Boolean(id)))];
    if (!ids.length) return;
    let live = true;
    vendorBrands(ids).then(
      (list) => {
        if (!live) return;
        setBrands(new Map(list.map((b) => [b.id, { name: b.name, logo_url: b.logo_url }])));
        setPlatformIds(new Set(list.filter((b) => b.platform).map((b) => b.id)));
      },
      () => undefined, // no brands: the cards simply show no owner
    );
    return () => {
      live = false;
    };
  }, [paints, fabrics]);
  const ownerOf = (x: object) => brands.get((x as { vendor_id?: string | null }).vendor_id ?? "") ?? null;

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void authSession().then(async ({ data }) => {
      const user = data.session?.user;
      setSignedIn(Boolean(user));
      if (!user) return;
      const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
      setUserName(meta?.full_name?.trim() || meta?.name?.trim() || user.email?.split("@")[0] || "");
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

  // The home page is the furniture and the paints; carpets and windows each have their own page (/catalog/<kind>).
  const show = (kind: CatalogKind) => (only ? only === kind : kind === "models" || kind === "paints");
  const grid = Boolean(only);
  // Vendors' paints only: Sha2ty's own (the admins' studio) are left out.
  const colours = paints.filter((p) => (p.surface ?? "wall") === "wall" && !platformIds.has((p as { vendor_id?: string }).vendor_id ?? ""));
  // One carousel per model type that has models (all empty: a single "Models" row says so).
  const modelGroups = CATALOG_GROUPS.map((c) => ({
    ...c,
    items: models.filter((m) => groupOf(m.category) === c.id),
  })).filter((g) => g.items.length);
  const metrics: [string, number | null, string][] = [
    ["Your models", ownModels, "/vendor"],
    ["Catalogue models", models.length, "#models"],
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
        ) : signedIn !== true ? (
          // Signed out (or still checking): the public banner; the dark account panel is only for a signed-in user.
          signedIn === false && <Banner />
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
                    {(vendor?.name || userName || "·").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div>
                  <p className="text-sm text-slate-300">{t("Welcome back,")}</p>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {vendor?.name || userName || "…"}
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
            <dl className="grid grid-cols-2 border-t border-white/10">
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
            {!only && vendor && <div className="mt-6"><VendorRequestsPanel /></div>}
            {show("models") && signedIn && <MyCustomisedRow grid={grid} />}
            {show("models") && signedIn && <MyUploadedRow grid={grid} />}
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
                      owner={m.company ? { name: m.company, logo_url: m.company_logo ?? null } : null}
                      meta={
                        sizeLabel(m) ?? t("Size not set")
                      }
                    >
                      {m.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.thumbnail} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
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
                    owner={ownerOf(p)}
                    title={p.name}
                    meta={
                      p.kind === "color" ? p.color.toUpperCase() : tileLabel(p)
                    }
                    compact
                  >
                    <PaintSwatch
                      paint={p}
                      className="size-full"
                    />
                  </Card>
                ))}
              </Carousel>
            )}
            {!only && (
              <Carousel loading={!loaded} grid={grid} title={t("Fabrics")} subtitle={t("Upholstery fabrics from our vendors")} count={fabrics.length} empty={t("No upholstery fabrics yet.")}>
                {fabrics.map((f) => (
                  <Card
                    key={f.id}
                    href={f.vendor_id ? `/vendors/${f.vendor_id}` : "/catalog/models"}
                    price={f.price_per_m == null ? null : `${formatPrice(Number(f.price_per_m))} / ${t("m")}`}
                    tag={t("Fabric")}
                    title={f.name}
                    meta={t("Upholstery fabric")}
                    owner={ownerOf(f)}
                    compact
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {f.texture_url ? <img src={f.texture_url} alt="" loading="lazy" decoding="async" className="size-full object-cover" /> : null}
                  </Card>
                ))}
              </Carousel>
            )}
            {CARPETS_ENABLED && show("carpets") && (
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
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
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
                        loading="lazy"
                        decoding="async"
                        className="size-full object-contain p-2"
                      />
                    </div>
                  </Card>
                ))}
              </Carousel>
            )}
          </>
        }
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
  const prev = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const fadeStart = useRef<HTMLDivElement>(null);
  const fadeEnd = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  // Arrow state is written on the DOM. A React update here would repaint every card on each scroll tick.
  useEffect(() => {
    const el = track.current;
    if (!el || grid) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const x = Math.abs(el.scrollLeft);
      const atStart = x <= 2;
      const atEnd = x + el.clientWidth >= el.scrollWidth - 2;
      if (prev.current) prev.current.disabled = atStart;
      if (next.current) next.current.disabled = atEnd;
      if (fadeStart.current) fadeStart.current.style.opacity = atStart ? "0" : "1";
      if (fadeEnd.current) fadeEnd.current.style.opacity = atEnd ? "0" : "1";
      if (controls.current) controls.current.style.display = atStart && atEnd ? "none" : "flex";
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [count, grid, loading]);
  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    el.scrollBy({ left: rtl * dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section id={id} aria-label={title} className="scroll-mt-20 [content-visibility:auto] [contain-intrinsic-size:auto_22rem]">
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
        {!grid && !loading && count > 0 && (
          <div ref={controls} className="flex shrink-0 gap-2">
            <PageButton buttonRef={prev} dir={-1} title={title} onClick={() => page(-1)} />
            <PageButton buttonRef={next} dir={1} title={title} onClick={() => page(1)} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="flex gap-4 overflow-hidden pb-5 pt-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="w-60 shrink-0 animate-pulse overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
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
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">{empty}</p>
      ) : grid ? (
        <div className="flex flex-wrap gap-4 pb-5 pt-2">{children}</div>
      ) : (
        <div className="relative">
          <div
            ref={track}
            className="-mx-1 flex snap-x snap-mandatory scroll-px-1 gap-4 overflow-x-auto px-1 pb-5 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {children}
          </div>
          <div ref={fadeStart} aria-hidden className="pointer-events-none absolute inset-y-2 start-0 z-10 w-10 bg-gradient-to-r from-slate-50 to-transparent opacity-0 rtl:bg-gradient-to-l" />
          <div ref={fadeEnd} aria-hidden className="pointer-events-none absolute inset-y-2 end-0 z-10 w-10 bg-gradient-to-l from-slate-50 to-transparent opacity-0 rtl:bg-gradient-to-r" />
        </div>
      )}
    </section>
  );
}

function PageButton({
  buttonRef,
  dir,
  title,
  onClick,
}: {
  buttonRef?: Ref<HTMLButtonElement>;
  dir: 1 | -1;
  title: string;
  onClick: () => void;
}) {
  const t = useT();
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={t(dir < 0 ? "Previous: {title}" : "Next: {title}", { title })}
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

type UploadedModel = { id: string; title: string; width_m: number | null; height_m: number | null; depth_m: number | null; thumbnail_url?: string | null; source_image_url: string | null };

/** The signed-in customer's own models (made from their photos in the app, supabase/user_models.sql): private, so only
 * they see this row. A card opens it in the design editor: sizes, parts, materials and "Have it made" (open to all vendors). */
function MyUploadedRow({ grid }: { grid: boolean }) {
  const t = useT();
  const [rows, setRows] = useState<UploadedModel[] | null>(null);
  useEffect(() => {
    if (!supabaseConfigured()) return;
    void supabase()
      .from("user_models")
      .select("*") // all columns: thumbnail_url only exists once user_models.sql has been rerun
      .eq("status", "ready")
      .not("glb_url", "is", null)
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as UploadedModel[])); // before user_models.sql: none
  }, []);
  if (!rows?.length) return null;
  return (
    <Carousel loading={false} grid={grid} title={t("My uploaded models")} subtitle={t("Your own furniture, made from your photos. Only you see these.")} count={rows.length} empty="">
      {rows.map((m) => {
        const image = m.thumbnail_url || m.source_image_url;
        return (
          <Card key={m.id} href={`/designs/mine/${m.id}`} title={m.title || t("Model")} meta={sizeLabel(m) ?? t("Size not set")}>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-xs text-slate-400">{t("No preview")}</span>
            )}
          </Card>
        );
      })}
    </Carousel>
  );
}

/** The signed-in customer's saved customised models, as their own row above the catalogue. */
function MyCustomisedRow({ grid }: { grid: boolean }) {
  const t = useT();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof customisedModels>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      customisedModels().then(
        (list) => setRows(list),
        (e: Error) => setError(e.message),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (error || rows?.length === 0) return null; // nothing saved yet (or designs not set up): no empty row
  return (
    <Carousel loading={rows === null} grid={grid} title={t("My customised models")} subtitle={t("Your saved versions of catalogue models")} count={rows?.length ?? 0} empty="">
      {(rows ?? []).map((d) => {
        const size = d.current?.data.item?.dimensions;
        return (
          <div key={d.id} className="group relative w-60 shrink-0 snap-start overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <Link href={`/designs/${d.id}`} className="block outline-none focus-visible:ring-2 focus-visible:ring-brand-amber">
              <div className="aspect-4/3 overflow-hidden bg-slate-100">
                {d.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.thumbnail_url} alt="" loading="lazy" decoding="async" className="size-full object-contain" />
                ) : (
                  <span className="flex size-full items-center justify-center text-xs text-slate-400">{t("No preview")}</span>
                )}
              </div>
              <div className="space-y-1 p-3.5">
                <h3 className="truncate text-sm font-semibold text-brand-navy">{d.title || t("Untitled design")}</h3>
                <p className="truncate text-xs tabular-nums text-slate-500">
                  <bdi>{size ? `${size.width.toFixed(2)} × ${size.height.toFixed(2)} × ${size.depth.toFixed(2)} m` : t("Size not set")}</bdi>
                </p>
                {d.current?.data.item?.source.title && <p className="truncate text-xs text-slate-400">{t("from {title}", { title: d.current.data.item.source.title })}</p>}
              </div>
            </Link>
            <button
              type="button"
              title={t("Delete")}
              onClick={() => {
                if (!window.confirm(t("Delete “{title}”? It leaves My designs.", { title: d.title || t("Untitled design") }))) return;
                void deleteDesign(d.id).then(load, (e: Error) => setError(e.message));
              }}
              className="absolute end-2 top-2 rounded-full bg-white/90 p-1.5 text-red-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">{t("Delete")}</span>
            </button>
          </div>
        );
      })}
    </Carousel>
  );
}

type Owner = { name: string; logo_url: string | null };
type FabricItem = { id: string; name: string; texture_url: string | null; price_per_m: number | null; vendor_id: string | null };

function Card({
  href,
  tag,
  title,
  meta,
  price,
  compact = false,
  owner,
  children,
}: {
  href: string;
  /** Type chip on the image (models skip it: their row already says the type). */
  tag?: string;
  title: string;
  meta: string;
  /** Formatted price, null for "Price on request", or left out (private models: no price line). */
  price?: string | null;
  /** The vendor who sells it: logo and name under the title. */
  owner?: Owner | null;
  compact?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Link
      href={href}
      className={`group flex shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm outline-none hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-brand-amber ${compact ? "w-44" : "w-60"}`}
    >
      <div
        className={`relative overflow-hidden bg-slate-100 ${compact ? "aspect-square" : "aspect-4/3"}`}
      >
        {children}
        {tag && (
          <span className="absolute start-2.5 top-2.5 max-w-[80%] truncate rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium text-slate-700 shadow-sm">
            {tag}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <h3 className="truncate text-sm font-semibold text-brand-navy">
          {title}
        </h3>
        {owner && (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-slate-600">
            <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-[9px] font-semibold text-brand-navy">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {owner.logo_url ? <img src={owner.logo_url} alt="" className="size-full object-cover" loading="lazy" /> : owner.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{owner.name}</span>
          </p>
        )}
        <p className="truncate text-xs tabular-nums text-slate-500">
          {/* Sizes and hex codes are Latin: isolate them so RTL does not reorder "m" before the numbers. */}
          <bdi dir="auto">{meta}</bdi>
        </p>
        {price !== undefined && (
          <p
            className={`mt-auto pt-1.5 text-[15px] tabular-nums ${price ? "font-semibold text-brand-navy" : "text-sm text-slate-400"}`}
          >
            {price ?? t("Price on request")}
          </p>
        )}
      </div>
    </Link>
  );
}
