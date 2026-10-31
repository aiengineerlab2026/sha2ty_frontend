"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Eye, LoaderCircle, Lock, LogOut, Mail, MapPin, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shatably/Logo";
import { LanguageSwitch } from "@/components/shatably/Header";
import { AuthInput } from "@/components/vendor/AuthInput";
import { API } from "@/lib/plan/api";
import { useLocale, useT } from "@/lib/i18n";
import type { VendorProfile } from "@/lib/vendor/types";

type Status = NonNullable<VendorProfile["status"]>;

export function AdminLoginForm() {
  const t = useT();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/admin-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) {
      setError(t(body?.error ?? "Cannot reach the server."));
      return;
    }
    router.push("/admin");
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <AuthInput label={t("Email")} type="email" icon={Mail} value={username} onChange={setUsername} autoComplete="email" placeholder="admin@admin.com" autoFocus />
      <AuthInput label={t("Password")} type="password" icon={Lock} value={password} onChange={setPassword} autoComplete="current-password" />
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <Button type="submit" disabled={busy || !username || !password} className="h-12 w-full rounded-xl text-base">
        {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
        {t("Log in")}
      </Button>
    </form>
  );
}

const TABS: (Status | "all")[] = ["pending", "approved", "rejected", "all"];
const LABEL: Record<Status | "all", string> = { pending: "Pending", approved: "Approved", rejected: "Rejected", all: "All" };
const BADGE: Record<Status, string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
};

/** Vendor signup requests: details of every studio, approve or reject. */
export function AdminRequests() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorProfile[] | null>(null);
  const [tab, setTab] = useState<Status | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API}/api/admin${path}`, init);
    if (res.status === 401) {
      router.replace("/admin/login");
      return null;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${res.status}).`);
    return body;
  };

  useEffect(() => {
    call("/vendors")
      .then((body) => body && setVendors(body.vendors))
      .catch((caught: Error) => setError(caught.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = async (id: string, status: Status) => {
    setSaving(id);
    setError(null);
    try {
      const body = await call(`/vendors/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (body) setVendors((list) => list?.map((v) => (v.id === id ? { ...v, ...body.vendor } : v)) ?? null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/admin-logout", { method: "POST" });
    router.push("/admin/login");
  };

  const statusOf = (v: VendorProfile): Status => v.status ?? "approved";
  const count = (s: Status | "all") => (vendors ?? []).filter((v) => s === "all" || statusOf(v) === s).length;
  const shown = (vendors ?? []).filter((v) => tab === "all" || statusOf(v) === tab);
  const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Logo size={36} label={t("Admin")} />
          <div className="flex items-center gap-1">
            <LanguageSwitch />
            <Button variant="ghost" onClick={() => void signOut()}>
              <LogOut className="size-4" aria-hidden />
              {t("Sign out")}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <VisionModelSetting call={call} />
        <h1 className="mt-10 text-2xl font-bold text-brand-navy">{t("Vendor requests")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("New studios sell right away; suspend or reject any of them here.")}</p>

        <div role="tablist" className="mt-6 flex flex-wrap gap-2">
          {TABS.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={tab === s}
              onClick={() => setTab(s)}
              className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition ${tab === s ? "bg-brand-navy text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-brand-navy"}`}
            >
              {t(LABEL[s])}
              <span className={`rounded-full px-1.5 text-xs ${tab === s ? "bg-white/20" : "bg-slate-100"}`}>{count(s)}</span>
            </button>
          ))}
        </div>

        {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t(error)}</p>}
        {!vendors && !error && <LoaderCircle className="mx-auto mt-16 size-6 animate-spin text-slate-400" aria-label={t("Loading…")} />}
        {vendors && shown.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center text-slate-500">
            <Clock className="mx-auto mb-2 size-6 text-slate-300" aria-hidden />
            {tab === "pending" ? t("No requests waiting for approval.") : t("Nothing here yet.")}
          </div>
        )}

        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {shown.map((v) => {
            const status = statusOf(v);
            const busy = saving === v.id;
            return (
              <li key={v.id} className="flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-start gap-4">
                  {v.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.logo_url} alt="" className="size-14 shrink-0 rounded-full bg-white object-cover ring-1 ring-slate-200" />
                  ) : (
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-navy text-lg font-semibold text-white">{v.name.slice(0, 1).toUpperCase()}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="truncate text-lg font-semibold text-brand-navy">{v.name}</h2>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${BADGE[status]}`}>{t(LABEL[status])}</span>
                    </div>
                    {v.created_at && <p className="text-xs text-slate-400">{t("Signed up {date}", { date: date.format(new Date(v.created_at)) })}</p>}
                  </div>
                </div>
                <dl className="mt-4 space-y-2 text-sm text-slate-600">
                  {v.full_name && (
                    <div className="flex items-center gap-2">
                      <UserRound className="size-4 shrink-0 text-slate-400" aria-label={t("Full name")} />
                      <dd>{v.full_name}</dd>
                    </div>
                  )}
                  {v.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="size-4 shrink-0 text-slate-400" aria-label={t("Email")} />
                      <dd>
                        <a href={`mailto:${v.email}`} className="hover:text-brand-navy hover:underline" dir="ltr">
                          {v.email}
                        </a>
                      </dd>
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" aria-label={t("Location")} />
                    <dd>
                      {v.location || "—"}
                      {v.lat != null && v.lng != null && (
                        <a href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noreferrer" className="ms-2 font-medium text-brand-navy hover:underline">
                          {t("Open in Google Maps")}
                        </a>
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 flex gap-2 border-t border-slate-100 pt-4">
                  {status !== "approved" && (
                    <Button disabled={busy} onClick={() => void setStatus(v.id, "approved")} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                      {t("Approve")}
                    </Button>
                  )}
                  {status !== "rejected" && (
                    <Button disabled={busy} variant="outline" onClick={() => void setStatus(v.id, "rejected")} className="flex-1 text-red-600 hover:bg-red-50 hover:text-red-700">
                      <X className="size-4" aria-hidden />
                      {status === "approved" ? t("Suspend") : t("Reject")}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}

type VisionOption = { id: string; label: string; configured: boolean };

/** Which vision model reads floor plans and vendor product photos before 3D (saved on the server). */
function VisionModelSetting({ call }: { call: (path: string, init?: RequestInit) => Promise<{ model?: string; options?: VisionOption[] } | null> }) {
  const t = useT();
  const [model, setModel] = useState<string | null>(null);
  const [options, setOptions] = useState<VisionOption[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call("/vision")
      .then((body) => {
        if (!body) return;
        setModel(body.model ?? null);
        setOptions(body.options ?? []);
      })
      .catch((caught: Error) => setError(caught.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (id: string) => {
    if (id === model || saving) return;
    setSaving(id);
    setError(null);
    try {
      const body = await call("/vision", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: id }) });
      if (body?.model) setModel(body.model);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-2">
        <Eye className="size-5 text-brand-navy" aria-hidden />
        <h2 className="text-lg font-semibold text-brand-navy">{t("Vision model")}</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500">{t("Reads floor plans and vendor product photos into details before they are turned into 3D.")}</p>
      {!model && !error && <LoaderCircle className="mt-4 size-5 animate-spin text-slate-400" aria-label={t("Loading…")} />}
      <div role="radiogroup" aria-label={t("Vision model")} className="mt-4 grid gap-3 sm:grid-cols-3">
        {options.map((o) => {
          const on = o.id === model;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!o.configured || Boolean(saving)}
              onClick={() => void choose(o.id)}
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-start transition disabled:cursor-not-allowed disabled:opacity-60 ${on ? "border-brand-amber bg-amber-50/60 ring-2 ring-brand-amber/30" : "border-slate-200 hover:border-slate-300"}`}
            >
              <span>
                <span className="block font-semibold text-brand-navy">{o.label}</span>
                <span className="block text-xs text-slate-500" dir="ltr">{o.id}</span>
                {!o.configured && <span className="mt-1 block text-xs text-red-600">{t("No API key on the server")}</span>}
              </span>
              {saving === o.id ? <LoaderCircle className="size-4 animate-spin text-slate-400" aria-hidden /> : on ? <Check className="size-5 text-brand-amber" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{t(error)}</p>}
    </section>
  );
}
