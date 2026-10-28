"use client";

import { Award, Copy, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { apiErrorText } from "../../../../i18n/messages";
import { useT } from "../useT";
import { pickLang } from "@openmatrix/skilltutor/bilingual";

interface Cert { code: string; courseTitle: string; expertName: string; skills: { name: string; proficiency: string }[]; score: number; issuedAt: string }

export default function CertificatesPage() {
  const { t, locale } = useT();
  const lang = (text: string) => pickLang(text, locale);
  const [certs, setCerts] = useState<Cert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/skilltutor/link", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) { setError(body.error?.code ?? "ERROR"); return; }
      setCerts(body.certificates ?? []);
    })().catch(() => setError("INTERNAL_ERROR"));
  }, []);

  async function copy(code: string) {
    await navigator.clipboard?.writeText(`${location.origin}/verify/${code}`).catch(() => undefined);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <section className="mt-6 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold text-ink">{t("certs.title")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink/60">{t("certs.description")}</p>
      {error ? <p className="mt-4 text-sm text-coral">{apiErrorText(locale, { code: error })}</p> : null}
      {!certs && !error ? <Loader2 className="mt-4 animate-spin text-lagoon" aria-hidden="true" /> : null}
      {certs && certs.length === 0 ? <p className="mt-4 rounded-lg bg-mist/40 p-4 text-sm text-ink/60">{t("certs.empty")}</p> : null}
      {certs && certs.length > 0 ? (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {certs.map((c) => (
            <li key={c.code} className="flex flex-col gap-2 rounded-xl border border-lagoon/20 bg-lagoon/[.04] p-4">
              <div className="flex items-start gap-3">
                <Award className="mt-1 shrink-0 text-lagoon" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{lang(c.courseTitle)}</p>
                  <p className="text-sm text-ink/60">{c.expertName} · {new Date(c.issuedAt).toLocaleDateString(locale === "en" ? "en-GB" : "vi-VN")} · {Math.round(c.score * 100)}%</p>
                  <p className="mt-1 text-sm text-ink/70">{c.skills.map((s) => `${lang(s.name)} (${s.proficiency})`).join(", ")}</p>
                  <p className="mt-1 font-mono text-xs text-ink/50">{c.code}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`/verify/${c.code}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-lagoon px-3 text-sm font-semibold text-white"><ExternalLink size={16} aria-hidden="true" />{t("certs.view")}</a>
                <button type="button" onClick={() => void copy(c.code)} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-ink/15 px-3 text-sm font-semibold text-ink/70"><Copy size={16} aria-hidden="true" />{copied === c.code ? t("certs.copied") : t("certs.copy")}</button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
