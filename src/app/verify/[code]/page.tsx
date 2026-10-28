import { BadgeCheck, ShieldAlert } from "lucide-react";
import { localeFromCookie } from "../../../i18n/locale";
import { cookies } from "next/headers";
import { getSkillTutorRuntime, verifyCertificate } from "@openmatrix/skilltutor";
import { messages } from "../../../i18n/messages";
import { PrintButton } from "./PrintButton";
import { pickLang } from "@openmatrix/skilltutor/bilingual";

export const dynamic = "force-dynamic";

export default async function VerifyCertificatePage({ params }: { params: { code: string } }) {
  const code = decodeURIComponent(params.code).toUpperCase();
  const { valid, cert } = await verifyCertificate(await getSkillTutorRuntime(), code);
  const locale = localeFromCookie(cookies().get("oms-locale")?.value);
  const lang = (text: string) => pickLang(text, locale);
  const t = messages[locale];
  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-3xl px-4 py-6 sm:px-6">
      <section className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
        <p className="text-sm font-semibold text-lagoon">{t["verify.badge"]}</p>
        <h1 className="wrap-anywhere mt-1 font-mono text-2xl font-semibold text-ink">{code}</h1>
        {!cert ? (
          <p className="mt-4 flex items-center gap-2 text-coral"><ShieldAlert aria-hidden="true" /> {t["verify.notFound"]}</p>
        ) : (
          <>
            <p className={`mt-4 flex items-center gap-2 font-semibold ${valid ? "text-lagoon" : "text-coral"}`}>
              {valid ? <BadgeCheck aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
              {valid ? t["verify.valid"] : t["verify.invalid"]}
            </p>
            <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-ink/55">{t["verify.learner"]}</dt><dd className="text-ink">{cert.learnerName}</dd>
              <dt className="text-ink/55">{t["verify.course"]}</dt><dd className="text-ink">{lang(cert.courseTitle)}</dd>
              <dt className="text-ink/55">{t["verify.expert"]}</dt><dd className="text-ink">{cert.expertName}</dd>
              <dt className="text-ink/55">{t["verify.skills"]}</dt><dd className="text-ink">{cert.skills.map((s) => `${lang(s.name)} (${s.proficiency})`).join(", ")}</dd>
              <dt className="text-ink/55">{t["verify.score"]}</dt><dd className="text-ink">{Math.round(cert.score * 100)}%</dd>
              <dt className="text-ink/55">{t["verify.issued"]}</dt><dd className="text-ink">{new Date(cert.issuedAt).toLocaleDateString(locale === "en" ? "en-GB" : "vi-VN")}</dd>
              <dt className="text-ink/55">SHA-256</dt><dd className="wrap-anywhere font-mono text-xs text-ink/70">{cert.hash}</dd>
            </dl>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <PrintButton label={t["verify.print"]} />
              <a href="/verify" className="no-print text-sm font-semibold text-lagoon">{t["verify.another"]}</a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
