"use client";

import { useAcAuthContext } from "@openmatrix/oms-ac-login/react/AcLoginProvider";
import { useEffect } from "react";
import { useI18n } from "./LocaleProvider";

export function LocaleProfileSync() {
  const { user } = useAcAuthContext();
  const { locale, setLocale } = useI18n();
  useEffect(() => {
    if (!user || user.locale === locale) return;
    document.cookie = `oms-locale=${user.locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    document.documentElement.lang = user.locale;
    setLocale(user.locale);
  }, [locale, setLocale, user]);
  return null;
}
