"use client";

import { AcLoginPage } from "@openmatrix/oms-ac-login/react/AcLoginPage";
import { useI18n } from "../../i18n/LocaleProvider";

export function LoginPageContent() {
  const { locale } = useI18n();
  return <AcLoginPage locale={locale} />;
}
