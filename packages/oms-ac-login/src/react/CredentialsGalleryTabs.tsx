"use client";

import { Award, BadgeCheck, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useAcAuth } from "./hooks/useAcAuth";
import type { SupportedLocale } from "../core/types";
import { localize } from "./i18n";

interface Credential {
  id: string;
  issuer: string;
  title: string;
  status: string;
  issuedAt: string;
  subject?: string;
}

export function CredentialsGalleryTabs({ locale = "vi" }: { locale?: SupportedLocale }) {
  const { status } = useAcAuth();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (status !== "authenticated") return;
    setLoading(true);
    const response = await fetch("/api/ac/credentials/unified", { credentials: "include" });
    if (response.ok) {
      const data = (await response.json()) as { credentials: Credential[] };
      setCredentials(data.credentials);
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (status !== "authenticated") return null;

  const dateFormatter = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });

  return (
    <section className="rounded-lg border border-ink/10 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lagoon">
            OpenMatrix Skill Credentials
          </p>
          <h2 className="mt-1 text-xl font-semibold text-ink">
            {localize(locale, "Chứng chỉ OpenMatrix Skill hợp nhất", "Unified OpenMatrix Skill credentials")}
          </h2>
        </div>
        <button
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-ink/15 bg-white text-ink transition hover:border-lagoon/40 hover:text-lagoon focus:outline-none focus:ring-2 focus:ring-lagoon/20 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          onClick={refresh}
          aria-label={localize(locale, "Làm mới chứng chỉ", "Refresh credentials")}
          disabled={loading}
        >
          <RefreshCcw className={loading ? "animate-spin" : ""} size={17} aria-hidden="true" />
        </button>
      </div>

      {credentials.length === 0 ? (
        <div className="grid gap-3 rounded-lg border border-dashed border-ink/15 bg-mist p-4 text-center sm:p-5">
          <div className="mx-auto grid size-11 place-items-center rounded-md bg-white text-lagoon shadow-sm">
            <BadgeCheck size={21} aria-hidden="true" />
          </div>
          <div>
            <p className="font-semibold text-ink">
              {loading
                ? localize(locale, "Đang đồng bộ chứng chỉ", "Syncing credentials")
                : localize(locale, "Chưa có chứng chỉ", "No credentials yet")}
            </p>
            <p className="mt-1 text-sm leading-6 text-ink/65">
              {loading
                ? localize(locale, "Gallery sẽ cập nhật ngay khi dữ liệu hợp nhất sẵn sàng.", "The gallery will update when unified data is ready.")
                : localize(locale, "Kết nối Open Campus hoặc MetaMask để hiển thị credential OMS tại đây.", "Connect Open Campus or MetaMask to show OMS credentials here.")}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {credentials.map((credential) => (
            <article
              key={credential.id}
              className="rounded-lg border border-ink/10 bg-mist p-4 transition hover:border-saffron/30"
            >
              <div className="mb-3 flex min-w-0 items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-md bg-saffron/15 text-saffron">
                  <Award size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-ink">{credential.title}</h3>
                  <p className="truncate text-sm text-ink/65">{credential.issuer}</p>
                </div>
              </div>
              <p className="text-xs uppercase tracking-[0.14em] text-ink/50">
                {credential.status} · {dateFormatter.format(new Date(credential.issuedAt))}
              </p>
              {credential.subject ? (
                <p className="mt-2 break-all text-sm text-ink/70">{credential.subject}</p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
