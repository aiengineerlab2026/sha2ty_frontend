"use client";

import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { safeHtml } from "@/components/plan/ModelDetails";
import { tileLabel } from "@/lib/plan/roomMaterials";
import { ModelViewer } from "@/components/vendor/ModelViewer";
import { PaintSwatch } from "@/components/vendor/PaintLibrary";
import { fetchCatalogModel } from "@/lib/plan/api";
import { formatPrice } from "@/lib/plan/pricing";
import type { CatalogModel } from "@/lib/plan/types";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import type { Carpet, Paint, VendorProfile, WindowItem } from "@/lib/vendor/types";
import { ImageCarousel } from "@/components/shatably/ImageCarousel";
import { Reviews } from "@/components/shatably/Reviews";
import { useVariantUrls } from "@/lib/catalog/variants";
import { MatchButton } from "@/components/match/MatchWizard";

export type CatalogKind = "models" | "paints" | "carpets" | "windows";

type Item = { kind: "models"; data: CatalogModel } | { kind: "paints"; data: Paint } | { kind: "carpets"; data: Carpet } | { kind: "windows"; data: WindowItem };

/** Details page for one catalogue item (model, paint / floor finish, or carpet). */
export function CatalogDetail({ kind, id }: { kind: CatalogKind; id: string }) {
  const t = useT();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void authSession()
      .then(async ({ data }) => {
        // Public page: the item loads for everyone; the account only matters for the plan builder link.
        const user = data.session?.user;
        setSignedIn(Boolean(user));
        if (user) void supabase().from("vendors").select("*").eq("id", user.id).maybeSingle().then(({ data: v }) => setVendor(v));
        try {
          if (kind === "models") {
            const model = await fetchCatalogModel(id);
            if (!model) throw new Error(t("This model is not in the catalogue."));
            setItem({ kind, data: model });
          } else {
            const { data: row, error: next } = await supabase().from(kind).select("*").eq("id", id).maybeSingle();
            if (next) throw next;
            if (!row) throw new Error(t("This item is not in the catalogue."));
            setItem(kind === "paints" ? { kind, data: row as Paint } : kind === "windows" ? { kind, data: row as WindowItem } : { kind: "carpets", data: row as Carpet });
          }
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      });
  }, [kind, id]);

  return (
    <div className="min-h-full bg-slate-50">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-navy">
          <ArrowLeft className="rtl:-scale-x-100 size-4" aria-hidden /> {t("Back to catalogue")}
        </Link>
        {error && <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {!item && !error && <p className="mt-6 text-sm text-slate-500">{t("Loading…")}</p>}
        {item?.kind === "models" && <ModelView model={item.data} signedIn={signedIn} />}
        {item?.kind === "paints" && <PaintView paint={item.data} signedIn={signedIn} />}
        {item?.kind === "carpets" && <CarpetView carpet={item.data} signedIn={signedIn} />}
        {item?.kind === "windows" && <WindowView win={item.data} signedIn={signedIn} />}
        {/* Stars and comments from shoppers, for every kind of catalogue item. */}
        {item && <Reviews kind={({ models: "model", paints: "paint", carpets: "carpet", windows: "window" } as const)[item.kind]} itemId={item.data.id} />}
      </main>
    </div>
  );
}

function ModelView({ model, signedIn }: { model: CatalogModel; signedIn: boolean }) {
  const t = useT();
  const photos = useMemo(() => [...new Set([model.thumbnail, ...(model.variants ?? [])].filter((u): u is string => Boolean(u)))], [model]);
  const [shown, setShown] = useState<"3d" | number>(photos.length || !model.glb_url ? 0 : "3d");
  const description = useMemo(() => safeHtml(model.description ?? ""), [model.description]);
  const dims = model.width_m && model.height_m && model.depth_m ? { width: model.width_m, height: model.height_m, depth: model.depth_m } : null;

  return (
    <Layout
      signedIn={signedIn}
      media={
        <div className="space-y-3">
          {shown === "3d" ? <ModelViewer url={model.glb_url} dimensions={dims} /> : <ImageCarousel images={photos} alt={model.title} className="aspect-4/3 bg-white" />}
          {/* Tabs only when there is a choice: photo-only models (no GLB) show just the photos. */}
          {model.glb_url && photos.length > 0 && (
            <div className="flex gap-2" role="tablist" aria-label={t("View")}>
              <button type="button" role="tab" aria-selected={shown !== "3d"} onClick={() => setShown(0)} className={VIEW_TAB(shown !== "3d")}>
                {t("Photos · {n}", { n: photos.length })}
              </button>
              <button type="button" role="tab" aria-selected={shown === "3d"} onClick={() => setShown("3d")} className={VIEW_TAB(shown === "3d")}>
                {t("3D view")}
              </button>
            </div>
          )}
          <MatchButton model={model} />
        </div>
      }
      tag={model.company}
      price={model.price == null ? null : formatPrice(model.price, model.price_unit ?? "item")}
      title={model.title}
      facts={dims ? [["Width", `${dims.width.toFixed(2)} m`], ["Height", `${dims.height.toFixed(2)} m`], ["Depth", `${dims.depth.toFixed(2)} m`]] : [["Size", t("Not set")]]}
    >
      {description ? (
        <div className="text-sm leading-relaxed text-slate-600 [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-brand-navy [&_li]:ms-5 [&_ol]:list-decimal [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: description }} />
      ) : (
        <p className="text-sm text-slate-400">{t("No description.")}</p>
      )}
    </Layout>
  );
}

function PaintView({ paint, signedIn }: { paint: Paint; signedIn: boolean }) {
  const t = useT();
  const floor = paint.surface === "floor";
  return (
    <Layout
      signedIn={signedIn}
      media={<PaintMedia paint={paint} />}
      price={paint.price == null ? null : formatPrice(Number(paint.price), paint.price_unit ?? "m2")}
      tag={floor ? t("Floor finish") : paint.kind === "color" ? t("Wall paint") : t("Wall texture")}
      title={paint.name}
      facts={[
        ["For", floor ? t("Floors") : t("Walls")],
        ["Type", paint.kind === "color" ? t("Colour") : t("Texture")],
        ["Colour", paint.color.toUpperCase()],
        ...(paint.kind === "texture" ? ([["Tile size", tileLabel(paint).replace(" tile", "")]] as [string, string][]) : []),
      ]}
    >
      <p className="text-sm text-slate-600">In the plan builder, open the Paint tab, click {paint.name}, then click a {floor ? "floor" : "wall face"} to apply it.</p>
    </Layout>
  );
}

function CarpetView({ carpet, signedIn }: { carpet: Carpet; signedIn: boolean }) {
  const t = useT();
  return (
    <Layout
      signedIn={signedIn}
      media={<CutoutMedia kind="carpet" id={carpet.id} image={carpet.image_url} name={carpet.name} />}
      tag={t("Carpet")}
      price={carpet.price == null ? null : formatPrice(Number(carpet.price), carpet.price_unit ?? "item")}
      title={carpet.name}
      facts={[
        ["Width", `${Number(carpet.width_m).toFixed(2)} m`],
        ["Length", `${Number(carpet.length_m).toFixed(2)} m`],
        ["Area", `${(Number(carpet.width_m) * Number(carpet.length_m)).toFixed(2)} m²`],
      ]}
    >
      <p className="text-sm text-slate-600">In the plan builder, open the Carpets tab, click {carpet.name}, then click the floor to lay it at its real size.</p>
    </Layout>
  );
}

function WindowView({ win, signedIn }: { win: WindowItem; signedIn: boolean }) {
  const t = useT();
  return (
    <Layout
      signedIn={signedIn}
      media={<CutoutMedia kind="window" id={win.id} image={win.image_url} name={win.name} />}
      tag={t("Window")}
      price={win.price == null ? null : formatPrice(Number(win.price), win.price_unit ?? "item")}
      title={win.name}
      facts={[
        ["Width", `${Number(win.width_m).toFixed(2)} m`],
        ["Height", `${Number(win.height_m).toFixed(2)} m`],
        ["Area", `${(Number(win.width_m) * Number(win.height_m)).toFixed(2)} m²`],
      ]}
    >
      <p className="text-sm text-slate-600">In the plan builder, open Windows, click {win.name}, then click a wall to place it at its real size.</p>
    </Layout>
  );
}

const VIEW_TAB = (on: boolean) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${on ? "bg-brand-navy text-white" : "border border-slate-200 bg-white text-slate-600 hover:text-brand-navy"}`;

/** Paint: the swatch / texture, then any variant photos in a carousel. */
function PaintMedia({ paint }: { paint: Paint }) {
  const variants = useVariantUrls("paint", paint.id);
  if (paint.kind === "texture") return <ImageCarousel images={[paint.texture_url!, ...variants]} alt={paint.name} className="aspect-4/3" />;
  return (
    <div className="space-y-3">
      <PaintSwatch paint={paint} className="aspect-4/3 w-full rounded-2xl shadow-sm ring-1 ring-slate-200" />
      {variants.length > 0 && <ImageCarousel images={variants} alt={paint.name} className="aspect-video" />}
    </div>
  );
}

/** Carpet / window: the cut-out (on a checkerboard) and its variant photos as one carousel. */
function CutoutMedia({ kind, id, image, name }: { kind: "carpet" | "window"; id: string; image: string; name: string }) {
  const variants = useVariantUrls(kind, id);
  return <ImageCarousel images={[image, ...variants]} alt={name} className="aspect-4/3" checker />;
}

function Layout({
  media,
  tag,
  title,
  price,
  facts,
  children,
}: {
  /** Kept for callers; the plan builder link is the same for guests and members. */
  signedIn?: boolean;
  media: ReactNode;
  tag: string;
  title: string;
  /** Formatted price, or null for "Price on request". */
  price: string | null;
  facts: [string, string][];
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div>{media}</div>
      <div className="space-y-5">
        <div>
          <span className="inline-block rounded-full bg-slate-200/70 px-2.5 py-0.5 text-xs font-medium text-slate-700">{tag}</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-brand-navy">{title}</h1>
          <p className={`mt-2 text-2xl tabular-nums ${price ? "font-semibold text-brand-navy" : "text-base text-slate-400"}`}>{price ?? t("Price on request")}</p>
        </div>
        <dl className="grid grid-cols-3 gap-3">
          {facts.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
              <dt className="text-[11px] text-slate-500">{t(label)}</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-brand-navy">{value}</dd>
            </div>
          ))}
        </dl>
        {children}
        {/* Anyone can design; saving the plan asks guests to log in. */}
        <Link
          href="/plan"
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-amber px-5 text-sm font-semibold text-brand-navy shadow-sm hover:bg-[#e8952a]"
        >
          <LayoutGrid className="size-4" aria-hidden /> {t("Use it in the plan builder")}
        </Link>
      </div>
    </div>
  );
}
