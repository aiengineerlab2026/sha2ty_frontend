"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/shatably/Header";
import { Button } from "@/components/ui/button";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import type { CatalogModel, VendorProfile } from "@/lib/vendor/types";

export function Dashboard() {
  const t = useT();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!supabaseConfigured()) {
      setError(t("Supabase is not configured."));
      setLoading(false);
      return;
    }
    const { data: session } = await supabase().auth.getSession();
    if (!session.session) {
      window.location.href = "/vendor/login";
      return;
    }
    const userId = session.session.user.id;
    let profile = await supabase().from("vendors").select("*").eq("id", userId).maybeSingle();
    if (!profile.data) {
      const meta = session.session.user.user_metadata ?? {};
      await supabase().from("vendors").insert({
        id: userId,
        name: typeof meta.name === "string" ? meta.name : "Vendor",
        location: typeof meta.location === "string" ? meta.location : "",
      });
      profile = await supabase().from("vendors").select("*").eq("id", userId).maybeSingle();
    }
    const list = await supabase()
      .from("models")
      .select("*, model_variants(*)")
      .eq("vendor_id", userId)
      .order("created_at", { ascending: false });
    if (profile.error) setError(profile.error.message);
    else setVendor(profile.data);
    if (list.error) setError(list.error.message);
    else setModels((list.data ?? []) as CatalogModel[]);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const remove = async (id: string) => {
    if (!window.confirm(t("Remove this model?"))) return;
    const { error: next } = await supabase().from("models").delete().eq("id", id);
    if (next) {
      setError(next.message);
      return;
    }
    setModels((current) => current.filter((model) => model.id !== id));
  };

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            {vendor &&
              (vendor.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={vendor.logo_url} alt={`${vendor.name} logo`} className="size-16 shrink-0 rounded-full bg-white object-cover shadow-sm ring-1 ring-slate-200" />
              ) : (
                <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand-navy text-2xl font-semibold text-white">
                  {vendor.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            <div>
              {vendor && <p className="text-sm font-medium text-slate-500">{vendor.name}</p>}
              <h1 className="font-serif text-3xl">{t("Your models")}</h1>
              <p className="mt-1 text-sm text-slate-500">{t("Generate from a photo or upload a GLB. Saved files live on the sha2ty CDN.")}</p>
            </div>
          </div>
          <Button asChild>
            <Link href="/vendor/new">{t("Add model")}</Link>
          </Button>
        </div>
        {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
        {loading ? (
          <p className="text-sm text-slate-500">{t("Loading…")}</p>
        ) : models.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-slate-600">{t("No models yet.")}</p>
            <Button className="mt-4" asChild>
              <Link href="/vendor/new">{t("Add your first model")}</Link>
            </Button>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((model) => (
              <li key={model.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="aspect-4/3 bg-slate-100">
                  {model.model_variants[0]?.image_url || model.source_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={model.model_variants[0]?.image_url || model.source_image_url || ""}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center text-xs text-slate-400">{t("No preview")}</div>
                  )}
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-medium">{model.title}</h2>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] capitalize text-slate-600">{model.status}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="xs" variant="outline">
                      <Link href={`/vendor/models/${model.id}`}>{t("Edit")}</Link>
                    </Button>
                    {model.glb_url && (
                      <Button asChild size="xs">
                        <Link href={`/vendor/models/${model.id}`}>{t("View 3D")}</Link>
                      </Button>
                    )}
                    {model.glb_url && (
                      <a href={model.glb_url} className="text-xs text-amber-800 underline" target="_blank" rel="noreferrer">
                        {t("Download GLB")}
                      </a>
                    )}
                    <Button variant="destructive" size="xs" onClick={() => remove(model.id)}>
                      {t("Remove")}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
