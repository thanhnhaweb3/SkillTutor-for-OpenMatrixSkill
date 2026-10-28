import { BadgeCheck } from "lucide-react";
import { localeFromCookie } from "../../i18n/locale";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { messages } from "../../i18n/messages";

export const dynamic = "force-dynamic";

/** Public entry point: /verify?code=OMS-XXXXXXXX → /verify/OMS-XXXXXXXX */
export default function VerifyIndex({ searchParams }: { searchParams: { code?: string } }) {
  const code = searchParams.code?.trim().toUpperCase();
  if (code) redirect(`/verify/${encodeURIComponent(code)}`);
  const t = messages[localeFromCookie(cookies().get("oms-locale")?.value)];
  return (
    <main className="mx-auto min-h-[calc(100vh-4rem)] w-full max-w-3xl px-4 py-6 sm:px-6">
      <section className="rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
        <p className="text-sm font-semibold text-lagoon">{t["verify.badge"]}</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{t["verifyForm.title"]}</h1>
        <p className="mt-2 text-sm text-ink/60">{t["verifyForm.description"]}</p>
        <form method="get" className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input name="code" required pattern="[Oo][Mm][Ss]-[0-9A-Fa-f]{8}" placeholder="OMS-1A2B3C4D" aria-label={t["verifyForm.title"]} className="min-h-11 flex-1 rounded-md border border-ink/15 px-3 font-mono text-sm uppercase" />
          <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white"><BadgeCheck size={16} aria-hidden="true" />{t["verifyForm.submit"]}</button>
        </form>
      </section>
    </main>
  );
}
