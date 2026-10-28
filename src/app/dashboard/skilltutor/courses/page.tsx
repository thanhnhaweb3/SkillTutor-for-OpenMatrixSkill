"use client";

import { Award, BookOpen, CheckCircle2, Circle, Clock, Loader2, MessageCircle, MessagesSquare, PlayCircle } from "lucide-react";
import Link from "next/link";
import { pickLang } from "@openmatrix/skilltutor/bilingual";
import { useEffect, useMemo, useState } from "react";
import { apiErrorText } from "../../../../i18n/messages";
import { useT } from "../useT";

interface Lesson { id: string; index: number; title: string; moduleTitle: string; minutes: number; done: boolean }
interface Course {
  expertId: string; expertName: string; cohortId: string; cohortName: string; courseTitle: string;
  percentComplete: number; completedLessonCount: number; requiredLessonCount: number; completed: boolean; active: boolean;
  nextLessonId: string | null; certificateCode: string | null; lessons: Lesson[];
}
interface Data { courses: Course[]; whatsapp: { linked: boolean; url: string | null } }

/** "My courses": enrolled courses with every lesson marked done / up next / not started, and a way to continue. */
export default function MyCoursesPage() {
  const { t, locale } = useT();
  const [raw, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bilingual courses ("English / Tiếng Việt") show only the half for the selected UI language; re-derived on language switch.
  const data = useMemo(() => raw && { ...raw, courses: raw.courses.map((c) => ({ ...c, courseTitle: pickLang(c.courseTitle, locale), cohortName: pickLang(c.cohortName, locale),
    lessons: c.lessons.map((l) => ({ ...l, title: pickLang(l.title, locale), moduleTitle: pickLang(l.moduleTitle, locale) })) })) }, [raw, locale]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/skilltutor/courses", { cache: "no-store" })
      .then(async (r) => {
        const b: Data = await r.json(); if (!r.ok) throw new Error((b as { error?: { code?: string } }).error?.code ?? "ERROR");
        setData(b);
        // Open the tab named in the URL hash (#<cohortId>), else the course being studied now, else the first.
        const hash = decodeURIComponent(window.location.hash.slice(1));
        setSelected((b.courses.find((c) => c.cohortId === hash) ?? b.courses.find((c) => c.active) ?? b.courses[0])?.cohortId ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  function select(cohortId: string) {
    setSelected(cohortId);
    window.history.replaceState(null, "", `#${encodeURIComponent(cohortId)}`);
  }

  if (error) return <section className="mt-6 rounded-xl border border-coral/20 bg-white p-4 text-sm text-ink/70 shadow-sm sm:p-6">{apiErrorText(locale, { code: error })} <span className="font-mono text-xs text-ink/45">{error}</span></section>;
  if (!data) return <div className="mt-10 grid place-items-center"><Loader2 className="animate-spin text-lagoon" aria-label={t("courses.loading")} /></div>;

  if (data.courses.length === 0) {
    return (
      <section className="mt-6 rounded-xl border border-ink/10 bg-white p-6 text-center shadow-sm">
        <BookOpen className="mx-auto text-lagoon" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-semibold text-ink">{t("courses.emptyTitle")}</h2>
        <p className="mt-1 text-sm text-ink/60">{t("courses.emptyBody")}</p>
        <Link href="/#courses" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white">{t("courses.browse")}</Link>
      </section>
    );
  }

  const current = data.courses.find((c) => c.cohortId === selected) ?? data.courses[0];
  if (data.courses.length === 1) return <div className="mt-6"><CourseCard course={current} whatsapp={data.whatsapp} /></div>;

  // Several enrollments: one section, a tab per course.
  return (
    <div className="mt-6">
      <div role="tablist" aria-label={t("courses.tabs")} className="flex gap-1 overflow-x-auto border-b border-ink/10">
        {data.courses.map((c) => {
          const on = c.cohortId === current.cohortId;
          return (
            <button key={`${c.expertId}:${c.cohortId}`} type="button" role="tab" id={`tab-${c.cohortId}`} aria-selected={on} aria-controls={c.cohortId}
              onClick={() => select(c.cohortId)}
              className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 rounded-t-md border px-4 text-sm font-semibold ${on ? "border-ink/10 border-b-white bg-white text-ink" : "border-transparent text-ink/55 hover:text-lagoon"}`}>
              {c.certificateCode ? <Award size={14} className="text-emerald-600" aria-hidden="true" /> : <BookOpen size={14} aria-hidden="true" />}
              <span className="max-w-[16rem] truncate">{c.courseTitle}</span>
              <span className="text-xs font-normal text-ink/45">{c.percentComplete}%</span>
            </button>
          );
        })}
      </div>
      <CourseCard key={`${current.expertId}:${current.cohortId}`} course={current} whatsapp={data.whatsapp} tabbed />
    </div>
  );
}

function CourseCard({ course: c, whatsapp, tabbed }: { course: Course; whatsapp: Data["whatsapp"]; tabbed?: boolean }) {
  const { t } = useT();
  const target = `${encodeURIComponent(c.expertId)}:${encodeURIComponent(c.cohortId)}`;
  const allDone = !c.nextLessonId;
  const modules: { title: string; lessons: Lesson[] }[] = [];
  for (const l of c.lessons) {
    const last = modules[modules.length - 1];
    if (last && last.title === l.moduleTitle) last.lessons.push(l); else modules.push({ title: l.moduleTitle, lessons: [l] });
  }
  const next = c.lessons.find((l) => l.id === c.nextLessonId);

  return (
    <section id={c.cohortId} role={tabbed ? "tabpanel" : undefined} aria-labelledby={tabbed ? `tab-${c.cohortId}` : undefined} aria-label={tabbed ? undefined : c.courseTitle}
      className={`scroll-mt-24 border border-ink/10 bg-white p-4 shadow-sm sm:p-6 ${tabbed ? "rounded-b-xl rounded-tr-xl" : "rounded-xl"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {c.active && !c.completed ? <span className="rounded-full bg-lagoon/10 px-2.5 py-0.5 text-xs font-semibold text-lagoon">{t("courses.active")}</span> : null}
            {c.certificateCode ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><Award size={12} aria-hidden="true" />{t("courses.certified")}</span> : null}
          </div>
          <h2 className="mt-1 text-xl font-semibold text-ink">{c.courseTitle}</h2>
          <p className="text-sm text-ink/55">{c.expertName} · {c.cohortName}</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.percentComplete}>
              <div className="h-full rounded-full bg-lagoon" style={{ width: `${c.percentComplete}%` }} />
            </div>
            <span className="shrink-0 text-sm font-semibold text-ink/70">{t("courses.progress", { done: c.completedLessonCount, total: c.requiredLessonCount, percent: c.percentComplete })}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:w-72 lg:flex-col">
          {!allDone ? (
            <Link href={`/dashboard/skilltutor/learn?continue=${target}`} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white">
              <MessagesSquare size={16} aria-hidden="true" />{t("courses.continueWeb")}
            </Link>
          ) : !c.certificateCode ? (
            <Link href={`/dashboard/skilltutor/learn?continue=${target}&action=quiz`} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white">
              <Award size={16} aria-hidden="true" />{t("courses.takeTest")}
            </Link>
          ) : (
            <Link href={`/verify/${c.certificateCode}`} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-lagoon px-4 text-sm font-semibold text-white">
              <Award size={16} aria-hidden="true" />{t("courses.viewCertificate")}
            </Link>
          )}
          {whatsapp.linked && whatsapp.url && !c.certificateCode ? (
            <a href={`${whatsapp.url}?text=${encodeURIComponent(allDone ? "Take the test" : "Next lesson")}`} target="_blank" rel="noreferrer"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-ink/15 px-4 text-sm font-semibold text-ink/75 hover:border-lagoon/40 hover:text-lagoon">
              <MessageCircle size={16} aria-hidden="true" />{t("courses.continueWhatsApp")}
            </a>
          ) : null}
        </div>
      </div>

      {next ? (
        <p className="mt-4 rounded-md bg-lagoon/5 px-3 py-2 text-sm text-ink/75">
          <PlayCircle size={16} className="mr-1 inline text-lagoon" aria-hidden="true" />
          {t("courses.upNext", { index: next.index, title: next.title, minutes: next.minutes })}
        </p>
      ) : !c.certificateCode ? <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">{t("courses.allDone")}</p> : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {modules.map((m) => (
          <div key={m.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/50">{m.title}</h3>
            <ol className="mt-2 flex flex-col gap-1">
              {m.lessons.map((l) => {
                const isNext = l.id === c.nextLessonId;
                return (
                  <li key={l.id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${isNext ? "bg-lagoon/10 font-semibold text-ink" : l.done ? "text-ink/70" : "text-ink/55"}`}>
                    {l.done ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-label={t("courses.done")} />
                      : isNext ? <PlayCircle size={16} className="mt-0.5 shrink-0 text-lagoon" aria-label={t("courses.next")} />
                      : <Circle size={16} className="mt-0.5 shrink-0 text-ink/30" aria-label={t("courses.notStarted")} />}
                    <span className="min-w-0 flex-1">{l.index}. {l.title}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink/45"><Clock size={12} aria-hidden="true" />{l.minutes}′</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink/45">{t("courses.legend")}</p>
    </section>
  );
}
