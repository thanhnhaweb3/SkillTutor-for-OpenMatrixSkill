"use client";

import { ISO_COUNTRY_CODES, type CountryDisclosure, type SupportedLocale } from "@openmatrix/oms-ac-login/client";
import { useAcAuthContext } from "@openmatrix/oms-ac-login/react/AcLoginProvider";
import { Globe2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../i18n/LocaleProvider";

type SaveState = "idle" | "saving" | "saved" | "error";

export function LearnerPreferencesPanel() {
  const { user, refresh } = useAcAuthContext();
  const { locale, setLocale, t } = useI18n();
  const [countryCode, setCountryCode] = useState("");
  const [disclosure, setDisclosure] = useState<CountryDisclosure>("unset");
  const [selectedLocale, setSelectedLocale] = useState<SupportedLocale>(locale);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const countryNames = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const countries = useMemo(() => ISO_COUNTRY_CODES.map((code) => ({ code, name: countryNames.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, locale)), [countryNames, locale]);

  useEffect(() => {
    if (!user) return;
    setCountryCode(user.countryCode ?? "");
    setDisclosure(user.countryDisclosure);
    setSelectedLocale(user.locale);
  }, [user]);

  if (!user) {
    return <section className="rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/65 shadow-sm sm:p-5">{t("profile.loginRequired")}</section>;
  }

  async function save() {
    const nextDisclosure: CountryDisclosure = disclosure === "declined" ? "declined" : countryCode ? "provided" : "unset";
    setSaveState("saving");
    const response = await fetch("/api/ac/profile", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: selectedLocale, countryDisclosure: nextDisclosure, ...(nextDisclosure === "provided" ? { countryCode } : {}) })
    });
    if (!response.ok) { setSaveState("error"); return; }
    document.cookie = `oms-locale=${selectedLocale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    document.documentElement.lang = selectedLocale;
    setLocale(selectedLocale);
    await refresh();
    setSaveState("saved");
  }

  return (
    <section className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="learner-preferences-title">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lagoon/10 text-lagoon"><Globe2 aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 id="learner-preferences-title" className="font-semibold text-ink">{t("profile.preferences")}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-ink/65">{t("profile.preferencesDescription")}</p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium text-ink">
          {t("profile.language")}
          <select className="h-11 rounded-md border border-ink/15 bg-white px-3" value={selectedLocale} onChange={(event) => setSelectedLocale(event.target.value as SupportedLocale)}>
            <option value="en">{t("locale.en")}</option>
            <option value="vi">{t("locale.vi")}</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium text-ink">
          {t("profile.country")}
          <select className="h-11 rounded-md border border-ink/15 bg-white px-3" value={disclosure === "declined" ? "__declined" : countryCode} onChange={(event) => {
            if (event.target.value === "__declined") { setDisclosure("declined"); setCountryCode(""); }
            else { setDisclosure(event.target.value ? "provided" : "unset"); setCountryCode(event.target.value); }
          }}>
            <option value="">{t("profile.countryUnset")}</option>
            <option value="__declined">{t("profile.countryDeclined")}</option>
            {countries.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" disabled={saveState === "saving"} onClick={() => void save()} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-lagoon px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {saveState === "saving" ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}
          {saveState === "saving" ? t("profile.saving") : t("profile.save")}
        </button>
        {saveState === "saved" ? <p className="text-sm text-emerald-700" role="status">{t("profile.saved")}</p> : null}
        {saveState === "error" ? <p className="text-sm text-coral" role="alert">{t("profile.saveError")}</p> : null}
      </div>
    </section>
  );
}
