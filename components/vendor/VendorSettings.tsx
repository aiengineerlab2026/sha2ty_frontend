"use client";

import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { useEffect, useState, type FormEvent } from "react";
import { ImagePlus, ImageUp, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import { Header } from "@/components/shatably/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { uploadPublicFile } from "@/lib/vendor/storage";
import type { VendorProfile } from "@/lib/vendor/types";

/** Vendor profile: company name, location and logo. */
export function VendorSettings() {
  const t = useT();
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  // Typed as one line, "Cairo, Giza, New Cairo": saved as a list.
  const [areas, setAreas] = useState("");
  const [portfolio, setPortfolio] = useState<{ url: string; caption: string }[]>([]);
  const [uploading, setUploading] = useState(0);
  const [logo, setLogo] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured()) return;
    void authSession()
      .then(async ({ data }) => {
        if (!data.session) {
          window.location.href = "/vendor/login";
          return;
        }
        const { data: profile } = await supabase().from("vendors").select("*").eq("id", data.session.user.id).maybeSingle();
        setVendor(profile);
        setName(profile?.name ?? "");
        setLocation(profile?.location ?? "");
        setBio(profile?.bio ?? "");
        setAreas((profile?.service_areas ?? []).join("، "));
        setPortfolio(profile?.portfolio ?? []);
      });
  }, []);

  useEffect(() => {
    if (!logo) return;
    const url = URL.createObjectURL(logo);
    // Object URL for the chosen file; revoked when it changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!vendor) return;
    if (!name.trim()) {
      setStatus({ ok: false, text: t("Company name is required.") });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const logo_url = logo ? await uploadPublicFile(vendor.id, logo, "logo") : vendor.logo_url;
      const service_areas = [...new Set(areas.split(/[,،\n]/).map((a) => a.trim()).filter(Boolean))].slice(0, 30);
      const { data, error } = await supabase()
        .from("vendors")
        .update({ name: name.trim(), location: location.trim(), logo_url, bio: bio.trim().slice(0, 2000), service_areas, portfolio, updated_at: new Date().toISOString() })
        .eq("id", vendor.id)
        .select()
        .single();
      if (error) throw error;
      setVendor(data);
      setLogo(null);
      setStatus({ ok: true, text: t("Saved.") });
    } catch (caught) {
      setStatus({ ok: false, text: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setSaving(false);
    }
  };

  const shown = (logo && preview) || vendor?.logo_url;

  const addWork = async (files: FileList | null) => {
    if (!files || !vendor) return;
    const picked = [...files].filter((f) => f.type.startsWith("image/") && f.size <= 10 * 1024 * 1024).slice(0, 12 - portfolio.length);
    setUploading((n) => n + picked.length);
    for (const file of picked) {
      try {
        const url = await uploadPublicFile(vendor.id, file, "portfolio");
        setPortfolio((now) => [...now, { url, caption: "" }].slice(0, 12));
      } catch {
        setStatus({ ok: false, text: t("A picture could not be uploaded. Try again.") });
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-xl px-4 py-8">
        <h1 className="font-serif text-3xl">{t("Settings")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("Your company profile, shown with your models and paints.")}</p>
        {vendor && <Link href={`/vendors/${vendor.id}`} className="mt-2 inline-block text-sm font-semibold text-brand-navy underline-offset-4 hover:underline">{t("See your public page")}</Link>}
        <form onSubmit={save} className="mt-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown} alt={t("Logo")} className="size-20 rounded-2xl bg-white object-contain p-1 ring-1 ring-slate-200" />
            ) : (
              <span className="flex size-20 items-center justify-center rounded-2xl bg-brand-navy text-3xl font-semibold text-white">
                {(name || "V").slice(0, 1).toUpperCase()}
              </span>
            )}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <ImageUp className="size-4" aria-hidden />
              {vendor?.logo_url || logo ? t("Change logo") : t("Upload logo")}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-600">{t("Company name")}</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-600">{t("Location")}</span>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-600">{t("About your workshop")}</span>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={2000} rows={4} placeholder={t("What you make, your materials, years of experience…")} className="w-full rounded-md border border-slate-200 px-3 py-2 text-base outline-none focus:border-brand-amber focus:ring-2 focus:ring-brand-amber/20 sm:text-sm" />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-600">{t("Areas you deliver to")}</span>
            <Input value={areas} onChange={(e) => setAreas(e.target.value)} placeholder={t("e.g. Cairo, Giza, New Cairo")} />
            <span className="block text-xs text-slate-500">{t("Separate areas with commas. Requests in these areas are marked for you, and customers see them on your page.")}</span>
          </label>
          <div className="space-y-2 text-sm">
            <span className="text-slate-600">{t("Portfolio: photos of your own work")}</span>
            <p className="text-xs text-slate-500">{t("Up to 12 photos of pieces you made. Customers see them marked as shared by you; projects finished on Sha2ty are listed separately.")}</p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {portfolio.map((p, i) => (
                <li key={p.url} className="space-y-1">
                  <span className="relative block aspect-square overflow-hidden rounded-xl border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="size-full object-cover" />
                    <button type="button" aria-label={t("Remove picture")} onClick={() => setPortfolio((now) => now.filter((_, j) => j !== i))} className="absolute end-1 top-1 flex size-6 items-center justify-center rounded-full bg-white/90 shadow"><X className="size-3.5" aria-hidden /></button>
                  </span>
                  <Input value={p.caption} maxLength={120} placeholder={t("Caption (optional)")} onChange={(e) => setPortfolio((now) => now.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))} />
                </li>
              ))}
              {Array.from({ length: uploading }, (_, i) => <li key={`u${i}`} className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-slate-300"><LoaderCircle className="size-5 animate-spin text-slate-400" aria-label={t("Uploading…")} /></li>)}
              {portfolio.length + uploading < 12 && (
                <li>
                  <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 text-xs text-slate-500 hover:border-brand-amber">
                    <ImagePlus className="size-5" aria-hidden /> {t("Add pictures")}
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { void addWork(e.target.files); e.target.value = ""; }} />
                  </label>
                </li>
              )}
            </ul>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || uploading > 0 || !vendor}>
              {saving ? t("Saving…") : t("Save changes")}
            </Button>
            {status && <p className={`text-sm ${status.ok ? "text-emerald-700" : "text-red-700"}`}>{status.text}</p>}
          </div>
        </form>
      </main>
    </div>
  );
}
