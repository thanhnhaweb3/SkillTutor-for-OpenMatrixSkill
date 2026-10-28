"use client";

import {
  ArrowRight, Award, BadgeCheck, BellRing, Bot, BookOpen, Briefcase, CheckCircle2, ChevronDown, ClipboardCheck, Clock,
  Hourglass, Languages, LayoutDashboard, LifeBuoy, Loader2, LogIn, MessageCircle, PlayCircle, Search, ShieldCheck
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAcAuth } from "@openmatrix/oms-ac-login/react/hooks/useAcAuth";
import { useI18n } from "../../i18n/LocaleProvider";
import { pickLang } from "@openmatrix/skilltutor/bilingual";
import { messages, type MessageKey } from "../../i18n/messages";

/** Sign-in brings the visitor back to the landing page, now showing their account and course status. */
const LEARN_URL = `/api/ac/auth/login?returnUrl=${encodeURIComponent("/")}`;
const EXPERT_URL = `/api/ac/auth/login?returnUrl=${encodeURIComponent("/dashboard/skilltutor/learners")}`;
/** Signed-in learners continue from "My courses": every enrolled course with done / next / not-started lessons. */
const CONTINUE_URL = "/dashboard/skilltutor/courses";

type JoinStatus = "guest" | "none" | "pending" | "rejected" | "enrolled" | "closed";
interface CatalogCohort { expertId: string; expertName: string; cohortId: string; cohortName: string; courseCode: string; courseTitle: string; courseDescription: string;
  lessonCount: number; minutes: number; startDate: string; skills: string[]; status: JoinStatus }
interface MeSummary { name: string; whatsapp: { linked: boolean; phone?: string };
  enrollments: { courseTitle: string; cohortName: string; percentComplete: number; completedLessonCount: number; requiredLessonCount: number; completed: boolean }[];
  certificates: { code: string; courseTitle: string }[] }

const fill = (text: string, params: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ""));

const POWERED_BY = ["Amazon Bedrock", "Bedrock AgentCore", "End User Messaging", "Amazon SES", "Amazon DynamoDB", "Amazon Cognito"];
/** Shown while the public catalogue is empty (no Expert in SKILLTUTOR_PUBLIC_EXPERT_IDS yet): one card per docs/courses manifest. */
const FALLBACK_COURSES = [
  { code: "AIVP-ADV-01", key: "course", skill: "skill", skills: 6 },
  { code: "AIDP-CS-01", key: "aidp", skill: "aidpSkill", skills: 8 }
] as const;
/** Live cohorts of a known course (by OMS course code) use the bilingual landing copy instead of the Vietnamese OMS text. */
const COURSE_COPY = new Map<string, (typeof FALLBACK_COURSES)[number]>(FALLBACK_COURSES.map((c) => [c.code, c]));
const FEATURES = [
  { key: 1, icon: Bot }, { key: 2, icon: LifeBuoy }, { key: 3, icon: BellRing },
  { key: 4, icon: BadgeCheck }, { key: 5, icon: Languages }, { key: 6, icon: ClipboardCheck }
] as const;

/** Public home page. Signed-in visitors see their account, course progress and can request to join cohorts here. */
export function LandingPage() {
  const { t, locale } = useI18n();
  const k = (key: string) => t(key as MessageKey);
  /** Same text in the other language, shown under course titles so cards read in both Vietnamese and English. */
  const other = locale === "en" ? "vi" : "en";
  const alt = (key: string) => messages[other][key as MessageKey];
  /** OMS text of a bilingual course ("English / Tiếng Việt") in the current / the other language. */
  const lang = (text: string) => pickLang(text, locale);
  const langAlt = (text: string) => { const o = pickLang(text, other); return o !== lang(text) ? o : null; };
  const router = useRouter();
  const { user } = useAcAuth();
  const [code, setCode] = useState("");
  const [catalog, setCatalog] = useState<CatalogCohort[] | null>(null);
  const [me, setMe] = useState<MeSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const loadCatalog = useCallback(async () => {
    const res = await fetch("/api/skilltutor/catalog", { cache: "no-store" }).catch(() => null);
    const body = res?.ok ? await res.json().catch(() => null) : null;
    setCatalog(body?.cohorts ?? []);
  }, []);
  useEffect(() => { void loadCatalog(); }, [loadCatalog, user?.id]);
  useEffect(() => {
    if (!user) { setMe(null); return; }
    void fetch("/api/skilltutor/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => setMe(null));
  }, [user?.id]);

  async function requestJoin(c: CatalogCohort) {
    setBusy(c.cohortId); setNotice(null);
    try {
      const res = await fetch("/api/skilltutor/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expertId: c.expertId, cohortId: c.cohortId }) });
      setNotice(res.ok ? { ok: true, text: k("landing.requestSent") } : { ok: false, text: k("landing.requestError") });
      await loadCatalog();
    } finally { setBusy(null); }
  }
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === "en" ? "en-GB" : "vi-VN");

  function verify(e: React.FormEvent) {
    e.preventDefault();
    const normalized = code.trim().toUpperCase();
    router.push(normalized ? `/verify/${encodeURIComponent(normalized)}` : "/verify");
  }

  return (
    <div className="bg-white text-ink">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-ink/10 bg-gradient-to-b from-brand-soft via-white to-white dark:from-brand/20 dark:via-transparent dark:to-transparent">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:px-8 lg:py-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand dark:text-[#8ab8ff] shadow-sm ring-1 ring-brand/15">
              <MessageCircle size={14} aria-hidden="true" />{k("landing.eyebrow")}
            </p>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-ink sm:text-5xl">{user ? fill(k("landing.welcome"), { name: user.name }) : k("landing.title")}</h1>
            <p className="mt-5 max-w-xl text-base text-ink/70">{user ? k("landing.welcomeSub") : k("landing.subtitle")}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={user ? CONTINUE_URL : LEARN_URL} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-brand px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-deep focus:outline-none focus:ring-4 focus:ring-brand/25">
                {user ? k("landing.ctaContinue") : k("landing.ctaJoin")}<ArrowRight size={18} aria-hidden="true" />
              </a>
              <a href="#courses" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border-2 border-brand px-6 dark:border-[#8ab8ff] text-sm font-semibold text-brand dark:text-[#8ab8ff] transition hover:bg-brand-soft focus:outline-none focus:ring-4 focus:ring-brand/25 dark:hover:bg-brand/20">
                {k("landing.ctaCourses")}
              </a>
            </div>
            <p className="mt-5 text-xs text-ink/60">
              {k("landing.haveCode")} <a href="#verify" className="font-semibold text-brand dark:text-[#8ab8ff] underline-offset-4 hover:underline">{k("landing.verifyLink")}</a>
            </p>
          </div>
          {user ? <AccountCard k={k} me={me} lang={lang} /> : <ChatMockup k={k} />}
        </div>
      </section>

      {/* Powered by */}
      <section className="bg-brand text-white" aria-label={k("landing.poweredBy")}>
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-4 py-6 sm:px-6 lg:flex-row lg:px-8">
          <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-white/70">{k("landing.poweredBy")}</p>
          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 lg:ml-6 lg:justify-start">
            {POWERED_BY.map((name) => <li key={name} className="text-sm font-semibold text-white/90">{name}</li>)}
          </ul>
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="rounded-xl border border-ink/10 bg-white p-5">
            <p className="text-3xl font-bold text-brand dark:text-[#8ab8ff]">{k(`landing.stat${n}Value`)}</p>
            <p className="mt-1 text-sm text-ink/65">{k(`landing.stat${n}Label`)}</p>
          </div>
        ))}
      </section>

      {/* Featured course */}
      <section id="courses" className="scroll-mt-20 bg-mist/60 py-12 dark:bg-transparent">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-ink">{k("landing.coursesTitle")}</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink/65">{k("landing.coursesSubtitle")}</p>

          {notice ? <p role="status" className={`mt-4 rounded-md p-3 text-sm ${notice.ok ? "bg-brand-soft text-brand dark:bg-brand/20 dark:text-[#8ab8ff]" : "bg-coral/10 text-coral"}`}>{notice.text}</p> : null}
          {catalog === null ? <Loader2 className="mt-6 animate-spin text-brand" aria-hidden="true" /> : null}
          {catalog && catalog.length > 0 ? (
            /* Two courses per row; with more than two the list scrolls inside a box that shows one row and a peek of the next. */
            <ul tabIndex={catalog.length > 2 ? 0 : undefined} aria-label={catalog.length > 2 ? k("landing.coursesTitle") : undefined}
              className={`mt-6 grid gap-5 md:grid-cols-2 ${catalog.length > 2 ? "max-h-[38rem] overflow-y-auto overscroll-contain rounded-2xl p-1 pr-3 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/25" : ""}`}>
              {catalog.map((c) => { const copy = COURSE_COPY.get(c.courseCode); return (
                <li key={c.cohortId} className="flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-sm transition hover:shadow-panel">
                  <div className="flex h-32 items-end justify-between bg-gradient-to-br from-brand via-brand-deep to-[#002b6b] p-4 text-white">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold"><Award size={12} aria-hidden="true" />{k("landing.courseCert")}</span>
                    <BookOpen className="!size-10 opacity-90" strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <p className="text-xs font-semibold text-ink/55">{c.expertName}</p>
                    <h3 className="mt-1 text-lg font-bold leading-snug text-ink">{copy ? k(`landing.${copy.key}Title`) : lang(c.courseTitle)}</h3>
                    {(() => { const second = copy ? alt(`landing.${copy.key}Title`) : langAlt(c.courseTitle);
                      return second ? <p lang={other} className="mt-0.5 text-sm italic text-ink/55">{second}</p> : null; })()}
                    {copy ? <p className="mt-2 text-sm text-ink/70">{k(`landing.${copy.key}Desc`)}</p> : null}
                    <p className="mt-1 text-xs text-ink/60">{lang(c.cohortName)} · {fill(k("landing.cohortStarts"), { date: date(c.startDate) })}</p>
                    <p className="mt-2 flex items-center gap-2 text-xs text-ink/60"><Clock size={14} aria-hidden="true" />{fill(k("landing.lessonsMinutes"), { n: c.lessonCount, m: c.minutes })}</p>
                    {(() => {
                      const skills = copy ? Array.from({ length: copy.skills }, (_, i) => k(`landing.${copy.skill}${i + 1}`)) : c.skills.map(lang);
                      return skills.length ? (
                        <ul className="mt-3 flex flex-wrap gap-1.5">
                          {skills.slice(0, 4).map((s) => <li key={s} className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand dark:bg-brand/20 dark:text-[#8ab8ff]">{s}</li>)}
                          {skills.length > 4 ? <li className="px-1 text-xs text-ink/50">+{skills.length - 4}</li> : null}
                        </ul>
                      ) : null;
                    })()}
                    <div className="mt-auto pt-4"><CohortAction c={c} k={k} busy={busy === c.cohortId} onJoin={() => void requestJoin(c)} /></div>
                  </div>
                </li>
              ); })}
            </ul>
          ) : null}

          {catalog && catalog.length === 0 ? (
            <ul className="mt-6 grid gap-5 md:grid-cols-2">
              {FALLBACK_COURSES.map((course) => (
                <li key={course.key} className="flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-sm transition hover:shadow-panel">
                  <div className="flex h-32 items-end justify-between bg-gradient-to-br from-brand via-brand-deep to-[#002b6b] p-4 text-white">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold"><Award size={12} aria-hidden="true" />{k("landing.courseCert")}</span>
                    <BookOpen className="!size-10 opacity-90" strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <p className="text-xs font-semibold text-ink/55">{k("landing.courseProvider")}</p>
                    <h3 className="mt-1 text-xl font-bold leading-snug text-ink">{k(`landing.${course.key}Title`)}</h3>
                    <p lang={locale === "en" ? "vi" : "en"} className="mt-0.5 text-sm italic text-ink/55">{alt(`landing.${course.key}Title`)}</p>
                    <p className="mt-2 text-sm text-ink/70">{k(`landing.${course.key}Desc`)}</p>
                    <p className="mt-3 flex items-center gap-2 text-xs text-ink/60"><Clock size={14} aria-hidden="true" />{k(`landing.${course.key}Meta`)}</p>
                    <p className="mt-4 text-xs font-semibold text-ink">{k("landing.courseSkills")}</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {Array.from({ length: course.skills }, (_, i) => <li key={i} className="rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand dark:text-[#8ab8ff] dark:bg-brand/20">{k(`landing.${course.skill}${i + 1}`)}</li>)}
                    </ul>
                    <div className="mt-auto pt-5">
                      <a href={user ? CONTINUE_URL : LEARN_URL} className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-brand px-5 text-sm font-semibold text-white transition hover:bg-brand-deep">
                        {user ? k("landing.ctaDashboard") : k("landing.courseEnroll")}<ArrowRight size={16} aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {catalog && catalog.length === 0 ? <p className="mt-3 text-xs text-ink/55">{k("landing.courseNote")}</p> : null}
        </div>
      </section>

      {/* How it works – same blue band as "For business" */}
      <section className="bg-brand text-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold">{k("landing.howTitle")}</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((n) => (
              <li key={n} className="rounded-xl bg-white/10 p-5">
                <span className="grid size-10 place-items-center rounded-full bg-[#ffffff] text-sm font-bold text-[#0056d2]">{n}</span>
                <h3 className="mt-4 text-lg font-semibold">{k(`landing.how${n}Title`)}</h3>
                <p className="mt-1 text-sm text-white/85">{k(`landing.how${n}Body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="bg-mist/60 py-14 dark:bg-transparent">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-ink">{k("landing.featuresTitle")}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ key, icon: Icon }) => (
              <div key={key} className="rounded-xl border border-ink/10 bg-white p-5">
                <Icon className="!size-7 text-brand dark:text-[#8ab8ff]" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-semibold text-ink">{k(`landing.f${key}Title`)}</h3>
                <p className="mt-1 text-sm text-ink/65">{k(`landing.f${key}Body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Video */}
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <h2 className="flex items-center gap-2 text-3xl font-bold text-ink"><PlayCircle className="text-brand dark:text-[#8ab8ff]" aria-hidden="true" />{k("landing.videoTitle")}</h2>
        <div className="mt-6 overflow-hidden rounded-2xl border border-ink/10 bg-black shadow-sm">
          <div className="aspect-video">
            <iframe className="h-full w-full" src="https://www.youtube-nocookie.com/embed/kFok6yoAzq4" title={k("home.introVideo")} loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
          </div>
        </div>
      </section>

      {/* For business */}
      <section className="bg-brand text-white">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/80"><Briefcase size={14} aria-hidden="true" />{k("landing.bizEyebrow")}</p>
            <h2 className="mt-3 text-3xl font-bold">{k("landing.bizTitle")}</h2>
            <p className="mt-3 text-sm text-white/85">{k("landing.bizBody")}</p>
            <a href={user ? "/dashboard/skilltutor/learners" : EXPERT_URL} className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-md bg-[#ffffff] px-6 text-sm font-semibold text-[#0056d2] transition hover:bg-brand-soft">
              {k("landing.bizCta")}<ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>
          <ul className="grid content-center gap-3">
            {[1, 2, 3].map((n) => (
              <li key={n} className="flex items-start gap-3 rounded-xl bg-white/10 p-4 text-sm">
                <BadgeCheck size={20} className="mt-1 shrink-0" aria-hidden="true" />{k(`landing.biz${n}`)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Verify */}
      <section id="verify" className="scroll-mt-20 mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-6 rounded-2xl border border-ink/10 bg-white p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold text-ink"><ShieldCheck className="text-brand dark:text-[#8ab8ff]" aria-hidden="true" />{k("landing.verifyTitle")}</h2>
            <p className="mt-2 text-sm text-ink/65">{k("landing.verifyBody")}</p>
          </div>
          <form onSubmit={verify} className="flex flex-col gap-2 sm:flex-row">
            <label className="relative flex-1">
              <span className="sr-only">{k("landing.verifyTitle")}</span>
              <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" aria-hidden="true" />
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="OMS-1A2B3C4D"
                className="min-h-12 w-full rounded-md border border-ink/20 bg-white pl-10 pr-3 font-mono text-sm uppercase text-ink focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/20" />
            </label>
            <button type="submit" className="min-h-12 rounded-md bg-brand px-6 text-sm font-semibold text-white transition hover:bg-brand-deep">{k("landing.verifySubmit")}</button>
          </form>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-mist/60 py-14 dark:bg-transparent">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-ink">{k("landing.faqTitle")}</h2>
          <div className="mt-6 divide-y divide-ink/10 rounded-xl border border-ink/10 bg-white">
            {[1, 2, 3, 4, 5].map((n) => (
              <details key={n} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-ink">
                  {k(`landing.faq${n}Q`)}<ChevronDown size={20} className="shrink-0 text-brand dark:text-[#8ab8ff] transition group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="mt-3 text-sm text-ink/70">{k(`landing.faq${n}A`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-brand text-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold sm:text-4xl">{k("landing.finalTitle")}</h2>
          <p className="mt-3 text-base text-white/85">{k("landing.finalBody")}</p>
          <a href={user ? CONTINUE_URL : LEARN_URL} className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-md bg-[#ffffff] px-8 text-sm font-semibold text-[#0056d2] shadow-sm transition hover:bg-brand-soft focus:outline-none focus:ring-4 focus:ring-white/40">
            <LogIn size={18} aria-hidden="true" />{user ? k("landing.ctaContinue") : k("landing.ctaJoin")}
          </a>
        </div>
      </section>
    </div>
  );
}

/** Phone-style preview of a SkillTutor conversation (pure HTML/CSS, no images). */
function ChatMockup({ k }: { k: (key: string) => string }) {
  return (
    <div className="mx-auto w-full max-w-sm" aria-hidden="true">
      <div className="rounded-[2rem] border border-ink/10 bg-white p-3 shadow-panel">
        <div className="overflow-hidden rounded-[1.5rem] bg-[#efeae2] dark:bg-[#0b141a]">
          <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
            <span className="grid size-9 place-items-center rounded-full bg-white/20"><Bot size={18} /></span>
            <span><span className="block text-sm font-semibold leading-5">{k("landing.chatName")}</span><span className="block text-xs leading-4 text-white/75">{k("landing.chatOnline")}</span></span>
          </div>
          <div className="space-y-3 p-4 text-xs leading-5">
            <div className="max-w-[88%] rounded-lg rounded-tl-none bg-white p-3 text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
              <p className="font-semibold">{k("landing.chatLesson")}</p>
              <p className="mt-1 opacity-80">{k("landing.chatLessonBody")}</p>
              <div className="mt-2 grid gap-1 border-t border-black/10 pt-2 text-center font-semibold text-[#027eb5] dark:border-white/10 dark:text-[#53bdeb]">
                <span>{k("landing.chatDone")}</span><span>{k("landing.chatExplain")}</span>
              </div>
            </div>
            <div className="ml-auto max-w-[60%] rounded-lg rounded-tr-none bg-[#d9fdd3] p-3 text-right text-[#111b21] shadow-sm dark:bg-[#005c4b] dark:text-[#e9edef]">{k("landing.chatUser")}</div>
            <div className="max-w-[88%] rounded-lg rounded-tl-none bg-white p-3 text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">{k("landing.chatSaved")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The enroll button of one cohort card, by the visitor's status. */
function CohortAction({ c, k, busy, onJoin }: { c: CatalogCohort; k: (key: string) => string; busy: boolean; onJoin: () => void }) {
  const primary = "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition";
  if (c.status === "guest") return <a href={LEARN_URL} className={`${primary} bg-brand text-white hover:bg-brand-deep`}><LogIn size={16} aria-hidden="true" />{k("landing.signInToEnroll")}</a>;
  if (c.status === "enrolled") return <a href={`${CONTINUE_URL}#${encodeURIComponent(c.cohortId)}`} className={`${primary} bg-brand text-white hover:bg-brand-deep`}><CheckCircle2 size={16} aria-hidden="true" />{k("landing.enrolled")}</a>;
  if (c.status === "pending") return <p className={`${primary} bg-saffron/15 text-ink`}><Hourglass size={16} aria-hidden="true" />{k("landing.requestPending")}</p>;
  if (c.status === "closed") return <p className={`${primary} bg-mist text-ink/55`}>{k("landing.closed")}</p>;
  return (
    <button type="button" disabled={busy} onClick={onJoin} className={`${primary} bg-brand text-white hover:bg-brand-deep disabled:opacity-60`}>
      {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
      {c.status === "rejected" ? k("landing.requestAgain") : k("landing.requestJoin")}
    </button>
  );
}

/** Signed-in account panel in the hero: WhatsApp link, courses with progress, certificates. */
function AccountCard({ k, me, lang }: { k: (key: string) => string; me: MeSummary | null; lang: (text: string) => string }) {
  return (
    <section className="mx-auto w-full max-w-md rounded-2xl border border-ink/10 bg-white p-5 shadow-panel" aria-label={k("landing.accountTitle")}>
      <h2 className="flex items-center gap-2 text-lg font-bold text-ink"><LayoutDashboard size={18} className="text-brand dark:text-[#8ab8ff]" aria-hidden="true" />{k("landing.accountTitle")}</h2>
      {!me ? <Loader2 className="mt-4 animate-spin text-brand" aria-hidden="true" /> : (
        <>
          <div className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-sm ${me.whatsapp.linked ? "bg-[#e7f8ee] text-[#0b6b3a] dark:bg-[#0b6b3a]/25 dark:text-[#7be0a6]" : "bg-saffron/15 text-ink"}`}>
            <span className="flex items-center gap-2"><MessageCircle size={16} aria-hidden="true" />{me.whatsapp.linked ? fill(k("landing.waLinked"), { phone: me.whatsapp.phone ?? "" }) : k("landing.waNotLinked")}</span>
            {!me.whatsapp.linked ? <a href="/settings/connections" className="font-semibold text-brand underline-offset-4 hover:underline dark:text-[#8ab8ff]">{k("landing.waLinkCta")}</a> : null}
          </div>
          <h3 className="mt-4 text-sm font-semibold text-ink">{k("landing.myCourses")}</h3>
          {me.enrollments.length === 0 ? <p className="mt-1 text-xs text-ink/60">{k("landing.noCourses")}</p> : (
            <ul className="mt-2 grid gap-3">
              {me.enrollments.slice(0, 3).map((e) => (
                <li key={`${e.courseTitle}-${e.cohortName}`}>
                  <p className="text-sm font-semibold leading-snug text-ink">{lang(e.courseTitle)}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-mist"><div className="h-2 rounded-full bg-brand" style={{ width: `${e.percentComplete}%` }} /></div>
                    <span className="text-xs text-ink/60">{e.completedLessonCount}/{e.requiredLessonCount}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 pt-3 text-sm">
            <span className="flex items-center gap-2 text-ink/70"><Award size={16} aria-hidden="true" />{fill(k("landing.certificates"), { n: me.certificates.length })}</span>
            <a href="/dashboard/skilltutor/certificates" className="font-semibold text-brand underline-offset-4 hover:underline dark:text-[#8ab8ff]">{k("landing.viewCertificates")}</a>
          </div>
          <a href="/dashboard/skilltutor" className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border-2 border-brand text-sm font-semibold text-brand transition hover:bg-brand-soft dark:border-[#8ab8ff] dark:text-[#8ab8ff] dark:hover:bg-brand/20">
            {k("landing.ctaDashboard")}<ArrowRight size={16} aria-hidden="true" />
          </a>
        </>
      )}
    </section>
  );
}
