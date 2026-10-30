"use client";

import { authSession } from "@/lib/auth/client";
import { useT } from "@/lib/i18n";
import { useEffect, useState, type FormEvent } from "react";
import { ImageUp } from "lucide-react";
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
      const { data, error } = await supabase()
        .from("vendors")
        .update({ name: name.trim(), location: location.trim(), logo_url, updated_at: new Date().toISOString() })
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

  return (
    <div className="min-h-full bg-slate-50 text-slate-900">
      <Header vendor={vendor} />
      <main className="mx-auto max-w-xl px-4 py-8">
        <h1 className="font-serif text-3xl">{t("Settings")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("Your company profile, shown with your models, paints and carpets.")}</p>
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
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving || !vendor}>
              {saving ? t("Saving…") : t("Save changes")}
            </Button>
            {status && <p className={`text-sm ${status.ok ? "text-emerald-700" : "text-red-700"}`}>{status.text}</p>}
          </div>
        </form>
      </main>
    </div>
  );
}
