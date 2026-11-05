"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Box, Check, Clock, Eye, LoaderCircle, Lock, LogOut, Mail, MapPin, Plus, Sparkles, UserRound, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shatably/Logo";
import { LanguageSwitch } from "@/components/shatably/Header";
import { AuthInput } from "@/components/vendor/AuthInput";
import { API } from "@/lib/plan/api";
import { AdminWoods } from "./AdminWoods";
import { AdminModels } from "./AdminModels";
import { AdminPaintColors } from "./AdminPaintColors";
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
  const count = (s: Status | "all") => (vendors ?? []).filter((v) => !v.platform && (s === "all" || statusOf(v) === s)).length;
  // The Sha2ty catalogue vendor is managed above, not approved or suspended here.
  const shown = (vendors ?? []).filter((v) => !v.platform && (tab === "all" || statusOf(v) === tab));
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
        <PlatformCatalog call={call} />
        <div className="mt-6"><VisionModelSetting call={call} /></div>
        <div className="mt-6"><GeneratorSetting call={call} /></div>
        <div className="mt-6"><MatchModelSetting call={call} /></div>
        <div className="mt-6"><AdminWoods call={call} /></div>
        <div className="mt-6"><AdminPaintColors call={call} /></div>
        <div className="mt-6"><AdminModels call={call} /></div>
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
function VisionModelSetting({ call }: { call: (path: string, init?: RequestInit) => Promise<Record<string, unknown> | null> }) {
  return <ServerChoice call={call} path="/vision" field="model" icon={<Eye className="size-5 text-brand-navy" aria-hidden />} title="Vision model" intro="Reads floor plans and vendor product photos into details before they are turned into 3D." />;
}

/** Which service turns vendors' photos into 3D models; vendors no longer choose (backend generator_setting.py). */
function GeneratorSetting({ call }: { call: (path: string, init?: RequestInit) => Promise<Record<string, unknown> | null> }) {
  return <ServerChoice call={call} path="/generator" field="provider" icon={<Box className="size-5 text-brand-navy" aria-hidden />} title="3D generator" intro="Turns vendors' product photos into 3D models, on the web and in the app. Vendors do not choose it." />;
}

/** Which GPT combines the model's photo and the other item's photo into one room ("See how it looks with other items"). */
function MatchModelSetting({ call }: { call: (path: string, init?: RequestInit) => Promise<Record<string, unknown> | null> }) {
  return <ServerChoice call={call} path="/match-model" field="provider" icon={<Wand2 className="size-5 text-brand-navy" aria-hidden />} title="Image combining model" intro="Combines a model's photo with another item's photo into one room for “See how it looks with other items”. GPT Sol by default." />;
}

/** One server setting picked from a few options, each usable only with its API key on the server. */
function ServerChoice({ call, path, field, icon, title, intro }: { call: (path: string, init?: RequestInit) => Promise<Record<string, unknown> | null>; path: string; field: string; icon: ReactNode; title: string; intro: string }) {
  const t = useT();
  const [model, setModel] = useState<string | null>(null);
  const [options, setOptions] = useState<VisionOption[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call(path)
      .then((body) => {
        if (!body) return;
        setModel((body[field] as string | undefined) ?? null);
        setOptions((body.options as VisionOption[] | undefined) ?? []);
      })
      .catch((caught: Error) => setError(caught.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (id: string) => {
    if (id === model || saving) return;
    setSaving(id);
    setError(null);
    try {
      const body = await call(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: id }) });
      if (body?.[field]) setModel(body[field] as string);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-semibold text-brand-navy">{t(title)}</h2>
      </div>
      <p className="mt-1 text-sm text-slate-500">{t(intro)}</p>
      {!model && !error && <LoaderCircle className="mt-4 size-5 animate-spin text-slate-400" aria-label={t("Loading…")} />}
      <div role="radiogroup" aria-label={t(title)} className="mt-4 grid gap-3 sm:grid-cols-3">
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

/** The platform's own catalogue: models added by admins are listed by "Sha2ty" with its logo, in the same catalogue
 * and planner as vendor products. Opening it signs this browser in as the Sha2ty vendor (vendor pages reused). */
function PlatformCatalog({ call }: { call: (path: string, init?: RequestInit) => Promise<Record<string, unknown> | null> }) {
  const t = useT();
  const [info, setInfo] = useState<{ vendor: { name: string; logo_url: string | null }; models: number; ready: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    call("/studio").then(
      (body) => body && setInfo(body as unknown as NonNullable<typeof info>),
      (caught: Error) => setError(caught.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enter = async (target: string) => {
    setOpening(target);
    setError(null);
    const res = await fetch("/api/auth/admin-studio", { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setOpening(null);
      setError(typeof body.error === "string" ? body.error : typeof body.detail === "string" ? body.detail : t("Could not open the Sha2ty catalogue."));
      return;
    }
    window.location.assign(target); // a full load: the pages read the new session
  };

  return (
    <section className="flex flex-wrap items-center gap-4 rounded-2xl bg-brand-navy p-5 text-white shadow-sm">
      <span className="inline-flex items-center rounded-2xl bg-white px-3 py-2">
        <Logo size={28} />
      </span>
      <div className="min-w-[min(100%,16rem)] flex-1">
        <h2 className="text-lg font-semibold">{t("Sha2ty catalogue")}</h2>
        <p className="text-sm text-white/70">
          {info ? t("{ready} published · {all} models in total, listed by Sha2ty in the catalogue and the planner.", { ready: info.ready, all: info.models }) : t("Models added by the platform, listed by Sha2ty.")}
        </p>
        {error && <p className="mt-1 text-sm text-red-300">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={opening !== null} onClick={() => void enter("/vendor/new")} className="bg-brand-amber text-brand-navy hover:bg-[#e8952a]">
          <Plus className="size-4" aria-hidden /> {t("Add a model")}
        </Button>
        <Button type="button" disabled={opening !== null} onClick={() => void enter("/vendor/generate")} className="bg-white text-brand-navy hover:bg-slate-100">
          <Sparkles className="size-4" aria-hidden /> {opening === "/vendor/generate" ? t("Opening…") : t("Generate furniture")}
        </Button>
        <Button type="button" variant="outline" disabled={opening !== null} onClick={() => void enter("/vendor")} className="border-white/30 bg-transparent text-white hover:bg-white/10">
          {opening === "/vendor" ? t("Opening…") : t("Manage Sha2ty models")}
        </Button>
      </div>
      <p className="basis-full text-xs text-white/60">{t("This browser then works as the Sha2ty vendor (upload a GLB, or a photo → 3D with Meshy, edit, publish). Sign out there to return.")}</p>
    </section>
  );
}
