"use client";

import { ConnectedAccountsPanel } from "@openmatrix/oms-ac-login/react/ConnectedAccountsPanel";
import { CredentialsGalleryTabs } from "@openmatrix/oms-ac-login/react/CredentialsGalleryTabs";
import { ShieldCheck } from "lucide-react";
import { useI18n } from "../../../i18n/LocaleProvider";
import { LearnerPreferencesPanel } from "./LearnerPreferencesPanel";
import { SkillTutorPanel } from "./SkillTutorPanel";

export default function ConnectionsPage() {
  const { t, locale } = useI18n();
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-lagoon/10 px-3 py-2 text-sm font-semibold text-lagoon">
              <ShieldCheck size={16} aria-hidden="true" />
              {t("profile.badge")}
            </div>
            <h1 className="text-3xl font-semibold text-ink sm:text-4xl">
              {t("profile.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/70">
              {t("profile.description")}
            </p>
          </div>
        </div>
      </header>

      <LearnerPreferencesPanel />
      <SkillTutorPanel />
      <ConnectedAccountsPanel locale={locale} />
      <CredentialsGalleryTabs locale={locale} />
    </main>
  );
}
