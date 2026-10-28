import { DEFAULT_LOCALE, type SupportedLocale } from "@openmatrix/oms-ac-login";

/** Locale from the oms-locale cookie; English when the visitor has not chosen a language. */
export function localeFromCookie(value: string | undefined): SupportedLocale {
  return value === "vi" || value === "en" ? value : DEFAULT_LOCALE;
}
