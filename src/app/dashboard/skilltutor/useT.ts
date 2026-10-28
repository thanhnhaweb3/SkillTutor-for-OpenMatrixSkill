"use client";

import { useI18n } from "../../../i18n/LocaleProvider";
import type { MessageKey } from "../../../i18n/messages";

/** t() with {placeholders}. */
export function useT() {
  const { t, locale } = useI18n();
  return { locale, t: (key: MessageKey, params: Record<string, string | number> = {}) => t(key).replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? "")) };
}
