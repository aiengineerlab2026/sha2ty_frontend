"use client";

import { useT } from "@/lib/i18n";
import { useId, useState, type ComponentType, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon?: ComponentType<{ className?: string }>;
  /** Shown in red under the field and announced to screen readers; also marks the field invalid. */
  error?: string | null;
  hint?: ReactNode;
  /** Right side of the label row (e.g. "Forgot password?"). */
  aside?: ReactNode;
  /** 44 px instead of 52 px, for long forms that must fit one screen (sign-up). */
  dense?: boolean;
};

/** Auth form field: top label, leading icon, 52 px tall, amber focus ring, error state, password reveal. */
export function AuthInput({ label, value, onChange, icon: Icon, error, hint, aside, dense = false, type = "text", id, className = "", ...rest }: Props) {
  const t = useT();
  const auto = useId();
  const inputId = id ?? auto;
  const [shown, setShown] = useState(false);
  const password = type === "password";
  const describedBy = [error ? `${inputId}-error` : null, hint ? `${inputId}-hint` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`${dense ? "space-y-1.5" : "space-y-2"} ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="text-[13px] font-semibold text-slate-700">
          {label}
        </label>
        {aside}
      </div>
      <div className="group relative">
        {Icon && (
          <span
            className={`pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 transition-colors ${error ? "text-red-500" : "text-slate-400 group-focus-within:text-brand-navy"}`}
            aria-hidden
          >
            <Icon className="size-[18px]" />
          </span>
        )}
        <input
          id={inputId}
          type={password && shown ? "text" : type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${dense ? "h-11 text-sm" : "h-[52px] text-[15px]"} w-full rounded-xl border bg-slate-50/80 text-slate-900 shadow-[inset_0_1px_1px_rgba(15,23,42,0.04)] outline-none transition duration-150 placeholder:text-slate-400 ${
            Icon ? "ps-11" : "ps-4"
          } ${password ? "pe-12" : "pe-4"} ${
            error
              ? "border-red-300 bg-red-50/40 focus:border-red-400 focus:ring-4 focus:ring-red-500/10"
              : "border-slate-200 hover:border-slate-300 hover:bg-white focus:border-brand-amber focus:bg-white focus:ring-4 focus:ring-brand-amber/20"
          } disabled:cursor-not-allowed disabled:opacity-60`}
          {...rest}
        />
        {password && (
          <button
            type="button"
            aria-label={shown ? t("Hide password") : t("Show password")}
            aria-pressed={shown}
            onClick={() => setShown((v) => !v)}
            className="absolute end-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-amber/40"
          >
            {shown ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <div id={`${inputId}-hint`} className="text-xs text-slate-500">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
