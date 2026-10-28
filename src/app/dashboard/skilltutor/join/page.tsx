"use client";

import { BookOpen, CheckCircle2, Clock, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { apiErrorText } from "../../../../i18n/messages";
import { useT } from "../useT";
import { pickLang } from "@openmatrix/skilltutor/bilingual";

interface JoinView { expertId: string; expertName: string; cohortId: string; cohortName: string; courseTitle: string; lessonCount: number; startDate: string; status: "none" | "pending" | "enrolled" | "rejected" | "closed" }

function JoinCard() {
  const { t, locale } = useT();
  const lang = (text: string) => pickLang(text, locale);
  const params = useSearchParams();
  const e = params.get("e") ?? "", c = params.get("c") ?? "";
  const [view, setView] = useState<JoinView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/skilltutor/join?e=${encodeURIComponent(e)}&c=${encodeURIComponent(c)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error?.code ?? "INTERNAL_ERROR"); return; }
      setView(body);
    })().catch(() => setError("INTERNAL_ERROR"));
  }, [e, c]);

  async function request(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/skilltutor/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expertId: e, cohortId: c, note }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error?.code ?? "INTERNAL_ERROR"); return; }
      setView(body);
    } finally { setBusy(false); }
  }

  if (error === "UNAUTHENTICATED") return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-ink/70">{t("join.signIn")}</p>
      <Link href="/login" className="inline-flex min-h-11 items-center rounded-md bg-lagoon px-4 text-sm font-semibold text-white">{t("join.signInButton")}</Link>
    </div>
  );
  if (error === "OUTSIDE_EXPERT") return <p className="text-sm text-coral">{t("join.notFound")}</p>;
  if (error) return <p className="text-sm text-coral">{apiErrorText(locale, { code: error })}</p>;
  if (!view) return <Loader2 className="animate-spin text-lagoon" aria-hidden="true" />;

  return (
    <div>
      <p className="text-sm font-semibold text-lagoon">{view.expertName}</p>
      <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold text-ink"><BookOpen size={20} aria-hidden="true" />{lang(view.courseTitle)}</h2>
      <p className="mt-1 text-sm text-ink/60">{lang(view.cohortName)} · {t("join.meta", { count: view.lessonCount, date: new Date(view.startDate).toLocaleDateString(locale === "en" ? "en-GB" : "vi-VN") })}</p>

      {view.status === "enrolled" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="flex items-center gap-2 text-sm text-lagoon"><CheckCircle2 size={16} aria-hidden="true" />{t("join.status.enrolled")}</p>
          <Link href="/dashboard/skilltutor/learn" className="inline-flex min-h-11 items-center rounded-md bg-lagoon px-4 text-sm font-semibold text-white">{t("join.goLearn")}</Link>
        </div>
      ) : null}
      {view.status === "pending" ? <p className="mt-4 flex items-center gap-2 text-sm text-ink/70"><Clock size={16} aria-hidden="true" />{t("join.status.pending")}</p> : null}
      {view.status === "closed" ? <p className="mt-4 text-sm text-coral">{t("join.status.closed")}</p> : null}
      {view.status === "none" || view.status === "rejected" ? (
        <form onSubmit={request} className="mt-4 grid gap-2">
          {view.status === "rejected" ? <p className="text-sm text-coral">{t("join.status.rejected")}</p> : null}
          <textarea value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={300} rows={2} placeholder={t("join.notePlaceholder")} aria-label={t("join.notePlaceholder")} className="rounded-md border border-ink/15 p-3 text-sm" />
          <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white disabled:opacity-60 sm:w-fit">
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}{t("join.submit")}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export default function JoinPage() {
  const { t } = useT();
  return (
    <section className="mt-6 rounded-xl border border-ink/10 bg-white p-4 shadow-sm sm:p-6">
      <h1 className="sr-only">{t("join.title")}</h1>
      <Suspense fallback={<Loader2 className="animate-spin text-lagoon" aria-hidden="true" />}><JoinCard /></Suspense>
    </section>
  );
}
