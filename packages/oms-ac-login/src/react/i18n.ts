import type { SupportedLocale } from "../core/types";

export function localize(locale: SupportedLocale, vi: string, en: string) {
  return locale === "en" ? en : vi;
}
