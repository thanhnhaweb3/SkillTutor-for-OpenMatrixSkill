"use client";

import type { SupportedLocale } from "@openmatrix/oms-ac-login";
import { createContext, useContext, useMemo, useState } from "react";
import { messages, type MessageKey } from "./messages";

interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: MessageKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ initialLocale, children }: { initialLocale: SupportedLocale; children: React.ReactNode }) {
  const [locale, setLocale] = useState(initialLocale);
  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t: (key) => messages[locale][key] }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useI18n must be used inside LocaleProvider");
  return context;
}
