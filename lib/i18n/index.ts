"use client";

import { createContext, createElement, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { Direction } from "radix-ui";
import { AR } from "./ar";

// English text is the key ("Save", "{n} reviews"). ar.ts maps it to Arabic. A missing entry stays the
// English key. Product names are data, not keys, so they are never translated. The dictionary is bundled,
// so the first render (server and client) already has every string. No async load, no post-hydration swap.
export type Locale = "ar" | "en";
export type T = (text: string, vars?: Record<string, string | number>) => string;

const LocaleContext = createContext<Locale>("ar");
let applyLocale: (locale: Locale) => void = () => {};

export function translate(locale: Locale, text: string, vars?: Record<string, string | number>): string {
  let out = locale === "ar" ? (AR[text] ?? text) : text;
  if (vars) for (const [key, value] of Object.entries(vars)) out = out.replaceAll(`{${key}}`, String(value));
  return out;
}

/** `locale` comes from the `lang` cookie, read in the root layout, so server and client start on the same language. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [value, setValue] = useState(locale);
  const [seen, setSeen] = useState(locale);
  if (locale !== seen) {
    setSeen(locale);
    setValue(locale);
  }
  // Publishes the setter for setLocale. It does not change the language; the cookie already did.
  useLayoutEffect(() => {
    applyLocale = setValue;
    return () => {
      if (applyLocale === setValue) applyLocale = () => {};
    };
  }, []);
  // Radix menus default to LTR and ignore <html dir>, so Arabic items sat on the left.
  const dir = value === "ar" ? "rtl" : "ltr";
  return createElement(LocaleContext.Provider, { value }, createElement(Direction.Provider, { dir }, children));
}

/** Writes the cookie the server reads, then updates the open page. No reload, no second language pass. */
export function setLocale(locale: Locale) {
  document.cookie = `lang=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  try {
    localStorage.setItem("lang", locale);
  } catch {
    // private mode: the cookie still persists
  }
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  applyLocale(locale);
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** `t("Save")`, `t("{n} reviews", { n })`. */
export function useT(): T {
  const locale = useLocale();
  return useCallback((text: string, vars?: Record<string, string | number>) => translate(locale, text, vars), [locale]);
}
