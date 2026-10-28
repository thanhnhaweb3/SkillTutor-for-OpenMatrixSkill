"use client";

import { BadgeCheck, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useT } from "../useT";
import { pickLang } from "@openmatrix/skilltutor/bilingual";

interface Result {
  valid: boolean;
  certificate: { code: string; learnerName: string; expertName: string; courseTitle: string; skills: { name: string; proficiency: string }[]; score: number; issuedAt: string; hash: string };
}

export default function VerifyTab() {
  const { t, locale } = useT();
  const lang = (text: string) => pickLang(text, locale);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | "notFound" | "invalidCode" | null>(null);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!/^OMS-[0-9A-F]{8}$/.test(normalized)) { setResult("invalidCode"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/skilltutor/certificates/${encodeURIComponent(normalized)}`, { cache: "no-store" });
      setResult(res.ok ? ((await res.json()) as Result) : "notFound");
    } finally { setBusy(false); }
  }

  const cert = result && typeof result === "object" ? result.certificate : null;
  return (
    <section className="mt-6 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold text-ink">{t("verifyForm.title")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink/60">{t("verifyForm.description")}</p>
      <form onSubmit={verify} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="OMS-1A2B3C4D" aria-label={t("verifyForm.title")} className="min-h-11 flex-1 rounded-md border border-ink/15 px-3 font-mono text-sm uppercase" />
        <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white">
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <BadgeCheck size={16} aria-hidden="true" />}{t("verifyForm.submit")}
        </button>
      </form>

      {result === "invalidCode" ? <p className="mt-4 text-sm text-coral">{t("verifyForm.invalidCode")}</p> : null}
      {result === "notFound" ? <p className="mt-4 flex items-center gap-2 text-coral"><ShieldAlert aria-hidden="true" />{t("verify.notFound")}</p> : null}
      {cert && typeof result === "object" && result ? (
        <div className="mt-4 rounded-lg border border-ink/10 p-4">
          <p className={`flex items-center gap-2 font-semibold ${result.valid ? "text-lagoon" : "text-coral"}`}>
            {result.valid ? <BadgeCheck aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}{result.valid ? t("verify.valid") : t("verify.invalid")}
          </p>
          <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-ink/55">{t("verify.learner")}</dt><dd className="text-ink">{cert.learnerName}</dd>
            <dt className="text-ink/55">{t("verify.course")}</dt><dd className="text-ink">{lang(cert.courseTitle)}</dd>
            <dt className="text-ink/55">{t("verify.expert")}</dt><dd className="text-ink">{cert.expertName}</dd>
            <dt className="text-ink/55">{t("verify.skills")}</dt><dd className="text-ink">{cert.skills.map((s) => `${lang(s.name)} (${s.proficiency})`).join(", ")}</dd>
            <dt className="text-ink/55">{t("verify.score")}</dt><dd className="text-ink">{Math.round(cert.score * 100)}%</dd>
            <dt className="text-ink/55">{t("verify.issued")}</dt><dd className="text-ink">{new Date(cert.issuedAt).toLocaleDateString(locale === "en" ? "en-GB" : "vi-VN")}</dd>
            <dt className="text-ink/55">SHA-256</dt><dd className="break-all font-mono text-xs text-ink/70">{cert.hash}</dd>
          </dl>
          <a href={`/verify/${cert.code}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-lagoon"><ExternalLink size={16} aria-hidden="true" />{t("verifyForm.publicLink")}</a>
        </div>
      ) : null}
    </section>
  );
}
