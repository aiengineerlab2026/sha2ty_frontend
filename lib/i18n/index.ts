"use client";

import { useEffect } from "react";
import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { AR } from "./ar";

// The English text is the key ("Save", "{n} reviews"); ar.ts maps it to Arabic and a missing entry
// shows the English. Plain `{name}` placeholders, no key nesting (keys contain "." and ":").
export type Locale = "ar" | "en";
const KEY = "lang";

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { ar: { translation: AR }, en: { translation: {} } },
    // Arabic is the default, and what the server renders; a saved "en" switches after hydration.
    lng: "ar",
    fallbackLng: false,
    initAsync: false,
    keySeparator: false,
    nsSeparator: false,
    returnEmptyString: false,
    interpolation: { escapeValue: false, prefix: "{", suffix: "}" },
    react: { useSuspense: false },
  });
}

function applyDocument(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
}

export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    // private mode: the choice lasts for this page only
  }
  applyDocument(locale);
  void i18n.changeLanguage(locale);
}

/** Mounted once in the root layout: restores a saved English choice after hydration. */
export function LocaleBoot() {
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      // storage blocked: stay on Arabic
    }
    if (saved === "en") setLocale("en");
  }, []);
  return null;
}

export function useLocale(): Locale {
  return useTranslation().i18n.language === "en" ? "en" : "ar";
}

export type T = (text: string, vars?: Record<string, string | number>) => string;

/** `t("Save")`, `t("{n} reviews", { n })`. */
export function useT(): T {
  return useTranslation().t as unknown as T;
}
