"use client";

import { useT } from "@/lib/i18n";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Building2, Check, CircleAlert, CloudUpload, LoaderCircle, Lock, Mail, MapPin, MailCheck, UserRound, X } from "lucide-react";
import { login, recoverFromLink, requestPasswordReset, updatePassword } from "@/lib/auth/client";
import { API } from "@/lib/plan/api";
import { supabase, supabaseConfigured } from "@/lib/supabase/client";
import { uploadPublicFile } from "@/lib/vendor/storage";
import { AuthInput } from "./AuthInput";
import { MAPS_KEY, MapPicker, type Picked } from "./MapPicker";
import { safeNext } from "@/lib/plan/pendingPlan";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Password rules shown live under the field; the backend enforces the length too. */
const RULES: [string, (p: string) => boolean][] = [
  ["At least 8 characters", (p) => p.length >= 8],
  ["A letter", (p) => /[A-Za-z]/.test(p)],
  ["A number", (p) => /\d/.test(p)],
];

type Errors = Partial<Record<string, string>>;

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  // ?next=: where to go after logging in (e.g. back to the plan to finish a guest's save).
  const nextPath = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!supabaseConfigured()) return <MissingConfig />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (!EMAIL.test(email.trim())) next.email = t(t("Enter a valid email address."));
    if (!password) next.password = t(t("Enter your password."));
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    const { error: failed, user } = await login(email.trim(), password);
    setBusy(false);
    if (failed) {
      setError(/invalid login credentials/i.test(failed) ? t("That email and password don't match. Try again or reset your password.") : t(failed));
      return;
    }
    const role = (user as { user_metadata?: { role?: string } } | undefined)?.user_metadata?.role;
    router.push(safeNext(nextPath, role === "customer" ? "/" : "/vendor"));
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <AuthInput label={t("Email")} type="email" icon={Mail} value={email} onChange={setEmail} error={errors.email} placeholder={t("you@studio.com")} autoComplete="email" autoFocus />
      <AuthInput
        label={t("Password")}
        type="password"
        icon={Lock}
        value={password}
        onChange={setPassword}
        error={errors.password}
        placeholder={t("Your password")}
        autoComplete="current-password"
        aside={
          <Link href={`/vendor/reset-password${email ? `?email=${encodeURIComponent(email.trim())}` : ""}`} className="text-xs font-semibold text-brand-navy underline-offset-4 hover:text-brand-amber hover:underline">
            {t("Forgot password?")}
          </Link>
        }
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      <Submit busy={busy}>{busy ? t("Logging in…") : t("Log in")}</Submit>
      <SwitchLink text="New to sha2ty?" href={nextPath ? `/vendor/signup?next=${encodeURIComponent(nextPath)}` : "/vendor/signup"} action="Create an account" />
    </form>
  );
}

export function SignupForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next");
  // Customers shop and plan; vendors sell straight away. ?as=vendor preselects.
  const [kind, setKind] = useState<"customer" | "vendor">(params.get("as") === "vendor" ? "vendor" : "customer");
  const vendor = kind === "vendor";
  const [coords, setCoords] = useState<Picked | null>(null);
  const [fullName, setFullName] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [logo, setLogo] = useState<File | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!supabaseConfigured()) return <MissingConfig />;

  const validate = (): Errors => {
    const next: Errors = {};
    if (!fullName.trim()) next.fullName = t("Enter your full name.");
    if (vendor && !name.trim()) next.name = t("Enter your company name.");
    if (vendor && !location.trim()) next.location = t("Enter your city and country, or pick it on the map.");
    if (!EMAIL.test(email.trim())) next.email = t("Enter a valid work email.");
    const failed = RULES.find(([, ok]) => !ok(password));
    if (failed) next.password = t("Password needs: {rule}.", { rule: t(failed[0]) });
    if (!confirm) next.confirm = t("Confirm your password.");
    else if (confirm !== password) next.confirm = t("Passwords don't match.");
    return next;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    const created = await fetch(`${API}/api/vendor/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        ...(vendor && { name: name.trim(), location: location.trim(), ...(coords && coords.address === location ? { lat: coords.lat, lng: coords.lng } : {}) }),
      }),
    }).catch(() => null);
    if (!created) {
      setBusy(false);
      setError(t("Cannot reach the server. Check your connection and try again."));
      return;
    }
    const payload = await created.json().catch(() => ({}));
    if (!created.ok) {
      setBusy(false);
      setError(typeof payload.detail === "string" ? payload.detail : t("Could not create the account. Check the fields and try again."));
      return;
    }
    const auth = await login(email.trim(), password);
    const user = auth.user as { id: string } | undefined;
    if (auth.error || !user) {
      setBusy(false);
      setError(auth.error ? t(auth.error) : t("Account created. Log in to continue."));
      return;
    }
    if (!vendor) {
      router.push(safeNext(nextPath, "/"));
      return;
    }
    // The backend created the vendor row (approved); only the logo is added here.
    if (logo) {
      try {
        const logoUrl = await uploadPublicFile(user.id, logo, "logo");
        const saved = await supabase().from("vendors").update({ logo_url: logoUrl }).eq("id", user.id);
        if (saved.error) throw saved.error;
      } catch (caught) {
        setBusy(false);
        setError(caught instanceof Error ? caught.message : t("Could not upload the logo."));
        return;
      }
    }
    setBusy(false);
    router.push("/vendor");
  };

  // Re-check a field once it has been flagged, so the error clears as soon as it is fixed.
  const live = (key: string) => (errors[key] ? validate()[key] : undefined);

  return (
    // Two columns from sm up (one on phones), 44 px fields: the whole form fits one laptop screen.
    <form onSubmit={submit} noValidate className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2 sm:gap-y-3.5">
      <fieldset className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:col-span-2">
        <legend className="sr-only">{t("Account type")}</legend>
        {(["customer", "vendor"] as const).map((option) => (
          <label
            key={option}
            className={`flex cursor-pointer flex-col items-center rounded-lg px-3 py-2 text-center transition ${kind === option ? "bg-white shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"}`}
          >
            <input type="radio" name="kind" value={option} checked={kind === option} onChange={() => setKind(option)} className="sr-only" />
            <span className="text-sm font-semibold text-brand-navy">{option === "customer" ? t("Customer") : t("Vendor")}</span>
            <span className="text-xs">{option === "customer" ? t("Plan and furnish your home") : t("Sell your products")}</span>
          </label>
        ))}
      </fieldset>
      <AuthInput dense label={t("Full name")} icon={UserRound} value={fullName} onChange={setFullName} error={live("fullName")} placeholder={t("Nour Hassan")} autoComplete="name" autoFocus />
      <AuthInput dense label={vendor ? t("Work email") : t("Email")} type="email" icon={Mail} value={email} onChange={setEmail} error={live("email")} placeholder={t("you@studio.com")} autoComplete="email" />
      {vendor && (
        <>
          <AuthInput dense label={t("Company name")} icon={Building2} value={name} onChange={setName} error={live("name")} placeholder={t("Cairo Studio")} autoComplete="organization" />
          <AuthInput
            dense
            label={t("Location")}
            icon={MapPin}
            value={location}
            onChange={setLocation}
            error={live("location")}
            placeholder={t("Cairo, Egypt")}
            autoComplete="address-level2"
            aside={
              MAPS_KEY ? (
                <MapPicker
                  value={coords}
                  onPick={(picked) => {
                    setCoords(picked);
                    setLocation(picked.address);
                  }}
                />
              ) : undefined
            }
          />
        </>
      )}
      <AuthInput
        dense
        label={t("Password")}
        type="password"
        icon={Lock}
        value={password}
        onChange={setPassword}
        error={live("password")}
        placeholder={t("Create a password")}
        autoComplete="new-password"
        hint={
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {RULES.map(([text, ok]) => (
              <li key={text} className={`flex items-center gap-1 transition-colors ${ok(password) ? "text-emerald-600" : "text-slate-400"}`}>
                <Check className="size-3" aria-hidden />
                {t(text)}
              </li>
            ))}
          </ul>
        }
      />
      <AuthInput dense label={t("Confirm password")} type="password" icon={Lock} value={confirm} onChange={setConfirm} error={live("confirm")} placeholder={t("Repeat your password")} autoComplete="new-password" className="self-start" />
      {vendor && (
        <div className="sm:col-span-2">
          <LogoDrop file={logo} onFile={setLogo} compact />
        </div>
      )}
      {error && (
        <div className="sm:col-span-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="space-y-3 pt-1 sm:col-span-2">
        <Submit busy={busy} dense>
          {busy ? t("Creating account…") : vendor ? t("Request vendor account") : t("Create account")}
        </Submit>
        <SwitchLink text="Already have an account?" href={nextPath ? `/vendor/login?next=${encodeURIComponent(nextPath)}` : "/vendor/login"} action="Log in" />
      </div>
    </form>
  );
}

/**
 * Password reset with Supabase Auth: request mode sends the reset email; the email link brings the
 * user back here with a recovery session, and update mode sets the new password.
 */
export function ResetPasswordForm() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [sent, setSent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The emailed reset link carries a recovery session in the URL fragment; the server turns it
    // into httpOnly cookies, then this form sets the new password.
    void recoverFromLink().then((ok) => ok && setRecovering(true));
  }, []);

  if (!supabaseConfigured()) return <MissingConfig />;

  const request = async (event: FormEvent) => {
    event.preventDefault();
    if (!EMAIL.test(email.trim())) {
      setErrors({ email: t("Enter a valid email address.") });
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    const { error: failed } = await requestPasswordReset(email.trim(), `${window.location.origin}/vendor/reset-password`);
    setBusy(false);
    if (failed) setError(t(failed));
    else setSent(true);
  };

  const update = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    const failedRule = RULES.find(([, ok]) => !ok(password));
    if (failedRule) next.password = t("Password needs: {rule}.", { rule: t(failedRule[0]) });
    if (confirm !== password) next.confirm = t("Passwords don't match.");
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    const { error: failed } = await updatePassword(password);
    setBusy(false);
    if (failed) setError(t(failed));
    else router.push("/vendor");
  };

  if (recovering) {
    return (
      <form onSubmit={update} noValidate className="space-y-5">
        <AuthInput label={t("New password")} type="password" icon={Lock} value={password} onChange={setPassword} error={errors.password} autoComplete="new-password" autoFocus />
        <AuthInput label={t(t("Confirm new password"))} type="password" icon={Lock} value={confirm} onChange={setConfirm} error={errors.confirm} autoComplete="new-password" />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Submit busy={busy}>{busy ? t("Saving…") : t("Set new password")}</Submit>
      </form>
    );
  }
  if (sent) {
    return (
      <div className="space-y-5">
        <p className="flex gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-800">
          <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {t("If an account exists for")} <b>{email.trim()}</b>{t(", a reset link is on its way. Open it on this device to choose a new password.")}
          </span>
        </p>
        <SwitchLink text="Remembered it?" href="/vendor/login" action="Back to log in" />
      </div>
    );
  }
  return (
    <form onSubmit={request} noValidate className="space-y-5">
      <AuthInput label={t("Email")} type="email" icon={Mail} value={email} onChange={setEmail} error={errors.email} placeholder={t("you@studio.com")} autoComplete="email" autoFocus />
      {error && <ErrorNote>{error}</ErrorNote>}
      <Submit busy={busy}>{busy ? t("Sending…") : t("Send reset link")}</Submit>
      <SwitchLink text="Remembered it?" href="/vendor/login" action="Back to log in" />
    </form>
  );
}

function SwitchLink({ text, href, action }: { text: string; href: string; action: string }) {
  const t = useT();
  return (
    <p className="text-center text-sm text-slate-500">
      {t(text)}{" "}
      <Link href={href} className="font-semibold text-brand-navy underline-offset-4 hover:text-brand-amber hover:underline">
        {t(action)}
      </Link>
    </p>
  );
}

/** Logo drop zone: drag an image in, or click to choose one. Optional. */
function LogoDrop({ file, onFile, compact = false }: { file: File | null; onFile: (file: File | null) => void; compact?: boolean }) {
  const t = useT();
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    // Object URL for the chosen file; revoked when it changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const take = (next: File | undefined) => next?.type.startsWith("image/") && onFile(next);

  return (
    <div className="space-y-1.5">
      <span className="block text-[13px] font-semibold text-slate-700">
        {t("Logo")} <span className="font-normal text-slate-400">{t("(optional)")}</span>
      </span>
      {file && preview ? (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="size-11 rounded-lg bg-white object-contain ring-1 ring-slate-200" />
          <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{file.name}</span>
          <button type="button" aria-label={t("Remove logo")} onClick={() => onFile(null)} className="flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-red-600">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            take(e.dataTransfer.files[0]);
          }}
          className={`flex cursor-pointer items-center rounded-xl border-2 border-dashed transition-colors ${compact ? "h-12 gap-3 px-3 text-start sm:h-14" : "flex-col gap-1.5 px-4 py-4 text-center"} ${
            over ? "border-brand-amber bg-brand-amber-soft" : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
          }`}
        >
          <span className={`flex size-9 items-center justify-center rounded-full ${over ? "bg-white text-brand-amber" : "bg-white text-slate-400 ring-1 ring-slate-200"}`}>
            <CloudUpload className="size-4" aria-hidden />
          </span>
          <span className={compact ? "min-w-0 flex-1 leading-tight" : "contents"}>
            <span className="block text-sm text-slate-600">
              <span className="font-semibold text-brand-navy">{t("Click to upload")}</span> {t("or drag and drop")}
            </span>
            <span className="block text-xs text-slate-400">{t("PNG, JPG, SVG or WebP")}</span>
          </span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => take(e.target.files?.[0])} />
        </label>
      )}
    </div>
  );
}

function Submit({ busy, children, dense = false }: { busy: boolean; children: ReactNode; dense?: boolean }) {
  const t = useT();
  return (
    <button
      type="submit"
      disabled={busy}
      className={`group flex ${dense ? "h-12" : "h-[52px]"} w-full items-center justify-center gap-2 rounded-xl bg-brand-navy text-[15px] font-semibold text-white shadow-sm shadow-slate-900/20 transition hover:bg-brand-navy-hover hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-amber/40 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-70`}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
      {children}
      {!busy && <ArrowRight className="rtl:-scale-x-100 size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />}
    </button>
  );
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-red-700">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function MissingConfig() {
  const t = useT();
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      {t("Add")} <code>{t("NEXT_PUBLIC_SUPABASE_ANON_KEY")}</code> from the Supabase project API settings to{" "}
      <code>{t("frontend/.env.local")}</code>{t(", then restart the Next.js server.")}
    </p>
  );
}

/** Login heading: explains the redirect when the plan builder sent a guest here to save. */
export function LoginIntro({ part }: { part: "title" | "subtitle" }) {
  const t = useT();
  const saving = useSearchParams().get("next")?.startsWith("/plan");
  if (part === "title") return <>{saving ? t("Log in to save your plan") : t("Welcome back")}</>;
  return <>{saving ? t("Your design is kept. After logging in you'll name it and it will be saved.") : t("Log in to manage your catalogue and floor plans.")}</>;
}
