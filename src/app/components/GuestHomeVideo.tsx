"use client";

import { useAcAuth } from "@openmatrix/oms-ac-login/react/hooks/useAcAuth";
import { useI18n } from "../../i18n/LocaleProvider";

export function GuestHomeVideo() {
  const { status, user } = useAcAuth();
  const { t } = useI18n();

  if (status === "loading" || user) {
    return null;
  }

  return (
   <section
      className="mx-auto w-full max-w-6xl px-4 pb-6 sm:px-6 lg:px-8"
      aria-label={t("home.introVideo")}
    >
      <div className="overflow-hidden rounded-lg border border-ink/10 bg-white/80 p-3 shadow-sm sm:p-4">
        <div className="aspect-video overflow-hidden rounded-md bg-black">
          <iframe
            className="h-full w-full"
            src="https://www.youtube-nocookie.com/embed/kFok6yoAzq4"
            title={t("home.introVideo")}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </div>
    </section>
  );
}
