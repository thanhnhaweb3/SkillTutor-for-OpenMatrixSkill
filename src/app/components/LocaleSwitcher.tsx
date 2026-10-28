"use client";

import type { SupportedLocale } from "@openmatrix/oms-ac-login";
import { useAcAuthContext } from "@openmatrix/oms-ac-login/react/AcLoginProvider";
import { Languages } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../i18n/LocaleProvider";

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const { user, refresh } = useAcAuthContext();
  const [busy, setBusy] = useState(false);

  async function change(next: SupportedLocale) {
    if (next === locale || busy) return;
    setBusy(true);
    try {
      if (user) {
        const response = await fetch("/api/ac/profile", {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ locale: next, countryDisclosure: user.countryDisclosure, ...(user.countryDisclosure === "provided" ? { countryCode: user.countryCode } : {}) })
        });
        if (!response.ok) return;
        await refresh();
      }
      document.cookie = `oms-locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      document.documentElement.lang = next;
      setLocale(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="inline-flex min-h-10 items-center gap-2 rounded-md border border-ink/15 bg-white px-2 py-2 text-sm text-ink shadow-sm">
      <Languages size={16} aria-hidden="true" />
      <span className="sr-only">{t("nav.language")}</span>
      <select className="bg-transparent text-sm font-semibold outline-none" aria-label={t("nav.language")} value={locale} disabled={busy} onChange={(event) => void change(event.target.value as SupportedLocale)}>
        <option value="en">EN</option>
        <option value="vi">VI</option>
      </select>
    </label>
  );
}
