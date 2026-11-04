"use client";

import { useT } from "@/lib/i18n";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Armchair, Building2, Copy, DoorOpen, Loader2, Trash2 } from "lucide-react";
import { Header } from "@/components/shatably/Header";
import { authSession } from "@/lib/auth/client";
import { deleteDesign, duplicateDesign, listDesigns } from "@/lib/designs/api";
import type { Design, DesignKind } from "@/lib/designs/schema";

const KINDS: { id: DesignKind | null; label: string }[] = [
  { id: null, label: "All" },
  { id: "item", label: "Items" },
  { id: "room", label: "Rooms" },
  { id: "apartment", label: "Apartments" },
];

const ICON = { item: Armchair, room: DoorOpen, apartment: Building2 };
const PAGE = 30;

/** My designs: the signed-in user's customised items, rooms and apartments. */
export function DesignLibrary() {
  const t = useT();
  const [kind, setKind] = useState<DesignKind | null>(null);
  const [rows, setRows] = useState<Design[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const load = useCallback(
    (which: DesignKind | null, offset: number) =>
      authSession().then(async ({ data }) => {
        if (!data.session) {
          router.push(`/vendor/login?next=${encodeURIComponent("/designs")}`);
          return;
        }
        const page = await listDesigns(which ?? undefined, offset);
        setRows((current) => (offset ? [...(current ?? []), ...page.designs] : page.designs));
        setMore(page.designs.length === PAGE);
      }),
    [router],
  );

  useEffect(() => {
    void load(kind, 0).catch((caught: Error) => setError(caught.message));
  }, [kind, load]);

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await run();
      await load(kind, 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-full bg-slate-50">
      <Header />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-brand-navy">{t("My designs")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("Customised items, rooms and apartments, with every saved version.")}</p>
          </div>
          <div className="flex gap-1" role="tablist">
            {KINDS.map((k) => (
              <button
                key={k.label}
                type="button"
                role="tab"
                aria-selected={kind === k.id}
                onClick={() => setKind(k.id)}
                className={`rounded-full px-3 py-1 text-sm ${kind === k.id ? "bg-brand-navy text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
              >
                {t(k.label)}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {rows === null && !error && <p className="mt-6 text-sm text-slate-500">{t("Loading…")}</p>}
        {rows?.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            <p>{t("No designs yet.")}</p>
            <p className="mt-1">
              {t("Open a model in the catalogue and choose “Customise”, or save a plan from the plan builder to My designs.")}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Link href="/" className="rounded-lg bg-brand-amber px-3 py-1.5 font-semibold text-brand-navy">{t("Explore models")}</Link>
              <Link href="/plan" className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-brand-navy">{t("Plan builder")}</Link>
            </div>
          </div>
        )}
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows?.map((design) => {
            const Icon = ICON[design.kind];
            return (
              <li key={design.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <Link href={`/designs/${design.id}`} className="block">
                  <div className="flex aspect-4/3 items-center justify-center bg-slate-100">
                    {design.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={design.thumbnail_url} alt="" className="size-full object-contain" loading="lazy" />
                    ) : (
                      <Icon className="size-10 text-slate-300" aria-hidden />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="truncate font-semibold text-brand-navy">{design.title || t("Untitled design")}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {t({ item: "Item", room: "Room", apartment: "Apartment" }[design.kind])} ·{" "}
                      {new Date(design.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                </Link>
                <div className="flex gap-1 border-t border-slate-100 p-2 text-xs">
                  <button type="button" disabled={busy === design.id} onClick={() => void act(design.id, () => duplicateDesign(design.id))} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                    <Copy className="size-3.5" aria-hidden /> {t("Duplicate")}
                  </button>
                  <button
                    type="button"
                    disabled={busy === design.id}
                    onClick={() => window.confirm(t("Delete “{title}”? It leaves My designs.", { title: design.title || t("Untitled design") })) && void act(design.id, () => deleteDesign(design.id))}
                    className="ms-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {busy === design.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />} {t("Delete")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {more && (
          <button type="button" onClick={() => void load(kind, rows?.length ?? 0).catch((caught: Error) => setError(caught.message))} className="mx-auto mt-6 block rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-brand-navy">
            {t("Load more")}
          </button>
        )}
      </main>
    </div>
  );
}
