import { issueCertificate, verifyCertificate, verifyUrl } from "../certificates";
import { deliver } from "../channels";
import { emailLayout } from "../channels/email";
import { tr, type TutorLocale } from "../i18n";
import { pickLang } from "../bilingual";
import { lessonsOf, type EnrollmentView, type LessonView } from "../oms/gateway";
import { localizeGateway } from "../oms/localized";
import { getOrCreateQuiz, quizKey } from "../oms/quiz";
import type { SkillTutorRuntime } from "../runtime";
import { newId } from "../store";
import type { CertificateSkill, Channel, InteractiveOptions, QuizQuestion, TutorState } from "../types";

export interface ToolContext {
  rt: SkillTutorRuntime;
  userId: string;
  channel: Channel;
  /** Learner language; tools answer in it. Defaults to Vietnamese. */
  locale?: TutorLocale;
  interactive?: InteractiveOptions;
}
export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }
/** `say` is the text the agent relays to the learner (verbatim for questions and results). */
export type ToolResult = { ok: boolean; say: string } & Record<string, unknown>;
type ToolFn = (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

/** OMS data in the learner's language (bilingual courses show only their half). */
const gw = (ctx: ToolContext) => localizeGateway(ctx.rt.gateway, ctx.locale);
const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required });

export const mainMenu = (l?: TutorLocale): InteractiveOptions => ({ options: [
  { id: "next_lesson", title: tr(l, "menu.next") },
  { id: "start_quiz", title: tr(l, "menu.quiz") },
  { id: "progress", title: tr(l, "menu.progress") }
] });
/** Kept for backwards compatibility (Vietnamese main menu). */
export const MAIN_MENU = mainMenu("vi");
const lessonMenu = (l?: TutorLocale): InteractiveOptions => ({ options: [
  { id: "done_lesson", title: tr(l, "menu.done") },
  { id: "explain", title: tr(l, "menu.explain") },
  { id: "progress", title: tr(l, "menu.progress") }
] });
const quizButtons = (q: QuizQuestion): InteractiveOptions => ({ options: q.options.map((o) => ({ id: o.id, title: `${o.id}. ${o.text}` })) });
const questionText = (l: TutorLocale | undefined, i: number, total: number, q: QuizQuestion) =>
  `${tr(l, "quiz.question", { n: i + 1, total, prompt: q.prompt })}\n${q.options.map((o) => `${o.id}) ${o.text}`).join("\n")}`;
const event = (ctx: ToolContext, type: Parameters<SkillTutorRuntime["store"]["addEvent"]>[0]["type"], expertId?: string, data?: Record<string, unknown>) =>
  ctx.rt.store.addEvent({ id: newId(), at: ctx.rt.now().toISOString(), type, userId: ctx.userId, expertId, channel: ctx.channel, data });
const dateFmt = (iso: string, l?: TutorLocale) => new Date(iso).toLocaleDateString(l === "en" ? "en-GB" : "vi-VN");
const skillList = (skills: CertificateSkill[]) => skills.map((k) => `${k.name} (${k.proficiency})`).join(", ");

async function state(ctx: ToolContext): Promise<TutorState> {
  const s = await ctx.rt.store.getState(ctx.userId);
  if (!s) throw new Error(`No tutor state for ${ctx.userId}`);
  return s;
}

/** The enrollment SkillTutor is working on: the selected one, else the first unfinished one. */
async function activeEnrollment(ctx: ToolContext, s: TutorState): Promise<EnrollmentView | null> {
  const all = await gw(ctx).listEnrollments(ctx.userId);
  const chosen = all.find((e) => e.expertId === s.active?.expertId && e.cohortId === s.active?.cohortId) ?? all.find((e) => !e.courseCompletedAt) ?? all[0] ?? null;
  if (chosen && (s.active?.cohortId !== chosen.cohortId || s.active?.expertId !== chosen.expertId)) {
    s.active = { expertId: chosen.expertId, cohortId: chosen.cohortId };
    await ctx.rt.store.putState(s);
  }
  return chosen;
}

function lessonMessage(l: TutorLocale | undefined, e: EnrollmentView, lesson: LessonView) {
  const outcomes = lesson.outcomes.map((o) => `• ${o.statement}`).join("\n");
  return `${tr(l, "lesson.header", { course: e.courseTitle, index: lesson.index, total: lesson.total, title: lesson.title, minutes: lesson.estimatedMinutes })}\n_${lesson.moduleTitle}_\n\n${lesson.summary}` +
    `${outcomes ? `\n\n${tr(l, "lesson.outcomes")}\n${outcomes}` : ""}\n\n${tr(l, "lesson.footer")}`;
}

const handlers: Record<string, ToolFn> = {
  async get_my_learning(_input, ctx) {
    const l = ctx.locale;
    const s = await state(ctx);
    const all = await gw(ctx).listEnrollments(ctx.userId);
    if (all.length === 0) return { ok: true, say: tr(l, "noCourse") };
    const active = await activeEnrollment(ctx, s);
    ctx.interactive = all.length > 1
      ? { header: tr(l, "menu.chooseCourse"), options: all.slice(0, 10).map((e) => ({ id: `course:${e.expertId}:${e.cohortId}`, title: e.courseTitle })) }
      : mainMenu(l);
    const lines = all.map((e) => tr(l, "progress.line", { marker: e.cohortId === active?.cohortId ? "▶" : "•", course: e.courseTitle, expert: e.expertName,
      done: e.completedLessonCount, total: e.requiredLessonCount, percent: e.percentComplete, done_mark: e.courseCompletedAt ? " ✅" : "" }));
    return { ok: true, enrollments: all.map((e) => ({ cohortId: e.cohortId, course: e.courseTitle, percent: e.percentComplete })), say: `${tr(l, "progress.title", { name: s.name })}\n${lines.join("\n")}` };
  },

  async switch_course(input, ctx) {
    const l = ctx.locale;
    const s = await state(ctx);
    const target = (await gw(ctx).listEnrollments(ctx.userId)).find((e) => e.cohortId === input.cohort_id);
    if (!target) return { ok: false, say: tr(l, "switch.notFound") };
    s.active = { expertId: target.expertId, cohortId: target.cohortId };
    s.currentLessonId = undefined;
    await ctx.rt.store.putState(s);
    ctx.interactive = mainMenu(l);
    return { ok: true, say: tr(l, "switch.ok", { course: target.courseTitle, percent: target.percentComplete }) };
  },

  async get_next_lesson(_input, ctx) {
    const l = ctx.locale;
    const s = await state(ctx);
    const e = await activeEnrollment(ctx, s);
    if (!e) return { ok: true, say: tr(l, "noCourse") };
    const lessons = await gw(ctx).getLessons(e.expertId, e.courseId, e.courseVersionNumber);
    const next = lessons.find((x) => !e.completedLessonIds.includes(x.id));
    if (!next) {
      ctx.interactive = { options: [{ id: "start_quiz", title: tr(l, "menu.quiz") }] };
      return { ok: true, allDone: true, say: tr(l, "lesson.allDone", { course: e.courseTitle }) };
    }
    s.currentLessonId = next.id;
    await ctx.rt.store.putState(s);
    await event(ctx, "lesson_delivered", e.expertId, { lessonId: next.id });
    ctx.interactive = lessonMenu(l);
    return { ok: true, lesson: { id: next.id, title: next.title }, say: lessonMessage(l, e, next) };
  },

  async explain_lesson(input, ctx) {
    const l = ctx.locale;
    const s = await state(ctx);
    const e = await activeEnrollment(ctx, s);
    if (!e || !s.currentLessonId) return { ok: false, say: tr(l, "explain.none") };
    const lesson = (await gw(ctx).getLessons(e.expertId, e.courseId, e.courseVersionNumber)).find((x) => x.id === s.currentLessonId);
    if (!lesson) return { ok: false, say: tr(l, "explain.notFound") };
    ctx.interactive = lessonMenu(l);
    return {
      ok: true,
      material: { title: lesson.title, summary: lesson.summary, outcomes: lesson.outcomes.map((o) => o.statement), learnerQuestion: input.question },
      say: `💡 *${lesson.title}*\n${lesson.summary}\n\n${tr(l, "explain.tip")}`,
      instruction: `Explain the lesson material in 3-5 short sentences with one concrete workplace example, in ${l === "en" ? "English" : "Vietnamese"}. Stay within the material.`
    };
  },

  async complete_lesson(input, ctx) {
    const l = ctx.locale;
    const s = await state(ctx);
    const e = await activeEnrollment(ctx, s);
    const lessonId = typeof input.lesson_id === "string" && input.lesson_id ? input.lesson_id : s.currentLessonId;
    if (!e || !lessonId) return { ok: false, say: tr(l, "complete.unknown") };
    const r = await gw(ctx).completeLesson({ userId: ctx.userId, userName: s.name, expertId: e.expertId, cohortId: e.cohortId, lessonId });
    if (!r.recorded) {
      const why = tr(l, r.reason === "PROGRESS_DISABLED" ? "complete.disabled" : r.reason === "NOT_ENROLLED" ? "complete.notEnrolled" : "complete.busy");
      return { ok: false, say: tr(l, "complete.failed", { why }) };
    }
    s.currentLessonId = undefined;
    await ctx.rt.store.putState(s);
    if (!r.replayed) await event(ctx, "lesson_completed", e.expertId, { lessonId, percent: r.percentComplete });
    if (r.courseCompleted) {
      ctx.interactive = { options: [{ id: "start_quiz", title: tr(l, "menu.quiz") }, { id: "progress", title: tr(l, "menu.progress") }] };
      return { ok: true, percentComplete: 100, say: tr(l, "complete.course", { course: e.courseTitle }) };
    }
    ctx.interactive = mainMenu(l);
    return { ok: true, percentComplete: r.percentComplete, say: tr(l, "complete.ok", { percent: r.percentComplete ?? 0 }) };
  },

  async start_assessment(_input, ctx) {
    const l = ctx.locale;
    const s = await state(ctx);
    const e = await activeEnrollment(ctx, s);
    if (!e) return { ok: true, say: tr(l, "noCourse") };
    if (!e.courseCompletedAt) {
      ctx.interactive = { options: [{ id: "next_lesson", title: tr(l, "menu.next") }] };
      return { ok: false, say: tr(l, "quiz.notReady", { course: e.courseTitle, done: e.completedLessonCount, total: e.requiredLessonCount }) };
    }
    const existing = (await ctx.rt.store.listCertificatesByUser(ctx.userId)).find((c) => c.courseVersionId === e.courseVersionId);
    if (existing) return { ok: true, say: tr(l, "quiz.already", { code: existing.code, url: verifyUrl(ctx.rt, existing.code) }) };
    const version = await gw(ctx).getCourseVersion(e.expertId, e.courseId, e.courseVersionNumber);
    const quiz = version ? await getOrCreateQuiz(ctx.rt, version, l ?? "vi") : null;
    if (!quiz) return { ok: false, say: tr(l, "quiz.noOutcomes") };
    s.activeQuiz = { expertId: e.expertId, cohortId: e.cohortId, courseVersionId: e.courseVersionId, quizKey: quizKey(e.courseVersionId, l ?? "vi"), index: 0, correct: 0, startedAt: ctx.rt.now().toISOString() };
    await ctx.rt.store.putState(s);
    await event(ctx, "quiz_started", e.expertId, { courseVersionId: e.courseVersionId, generatedBy: quiz.generatedBy, locale: l ?? "vi" });
    ctx.interactive = quizButtons(quiz.questions[0]);
    return { ok: true, say: `${tr(l, "quiz.intro", { course: e.courseTitle, count: quiz.questions.length, pass: Math.round(ctx.rt.config.passScore * 100) })}\n\n${questionText(l, 0, quiz.questions.length, quiz.questions[0])}` };
  },

  async submit_answer(input, ctx) {
    const l = ctx.locale;
    const s = await state(ctx);
    const q = s.activeQuiz;
    if (!q) return { ok: false, say: tr(l, "quiz.notStarted") };
    const quiz = await ctx.rt.store.getQuizSet(q.quizKey ?? q.courseVersionId);
    if (!quiz) return { ok: false, say: tr(l, "quiz.missing") };
    const current = quiz.questions[q.index];
    const answer = String(input.answer ?? "").trim().toUpperCase().charAt(0);
    if (!current.options.some((o) => o.id === answer)) {
      ctx.interactive = quizButtons(current);
      return { ok: false, say: `${tr(l, "quiz.pick", { options: current.options.map((o) => o.id).join("/") })}\n\n${questionText(l, q.index, quiz.questions.length, current)}` };
    }
    const correct = answer === current.correctOptionId;
    if (correct) q.correct += 1;
    const feedback = correct ? tr(l, "quiz.correct", { explanation: current.explanation }) : tr(l, "quiz.wrong", { answer: current.correctOptionId, explanation: current.explanation });
    q.index += 1;
    if (q.index < quiz.questions.length) {
      s.activeQuiz = q;
      await ctx.rt.store.putState(s);
      const next = quiz.questions[q.index];
      ctx.interactive = quizButtons(next);
      return { ok: true, correct, say: `${feedback}\n\n${questionText(l, q.index, quiz.questions.length, next)}` };
    }

    s.activeQuiz = undefined;
    await ctx.rt.store.putState(s);
    const total = quiz.questions.length, score = q.correct / total, pct = Math.round(score * 100);
    if (score < ctx.rt.config.passScore) {
      await event(ctx, "quiz_failed", q.expertId, { score });
      ctx.interactive = { options: [{ id: "explain", title: tr(l, "menu.review") }, { id: "start_quiz", title: tr(l, "menu.retry") }] };
      return { ok: true, passed: false, score, say: `${feedback}\n\n${tr(l, "quiz.failed", { correct: q.correct, total, percent: pct })}` };
    }
    await event(ctx, "quiz_passed", q.expertId, { score });
    // The certificate keeps the course's original (possibly bilingual) text; /verify shows it in the viewer's language.
    const e = (await ctx.rt.gateway.listEnrollments(ctx.userId)).find((x) => x.cohortId === q.cohortId && x.expertId === q.expertId);
    const version = e ? await ctx.rt.gateway.getCourseVersion(e.expertId, e.courseId, e.courseVersionNumber) : null;
    if (!e || !version) return { ok: false, say: tr(l, "quiz.noCourse") };
    const best = new Map<string, string>();
    for (const lesson of lessonsOf(version)) for (const o of lesson.outcomes) if (!best.has(o.skillId) || o.targetProficiencyCode > best.get(o.skillId)!) best.set(o.skillId, o.targetProficiencyCode);
    const names = await ctx.rt.gateway.skillNames(e.expertId, [...best.keys()]);
    const skills: CertificateSkill[] = [...best].map(([skillId, proficiency]) => ({ skillId, name: names[skillId] ?? skillId, proficiency }));
    const cert = await issueCertificate(ctx.rt, { userId: ctx.userId, learnerName: s.name, expertId: e.expertId, expertName: e.expertName, courseId: e.courseId,
      courseTitle: e.courseTitle, courseVersionId: e.courseVersionId, skills, score });
    const url = verifyUrl(ctx.rt, cert.code);
    const p = { name: s.name, course: pickLang(e.courseTitle, l), expert: e.expertName, percent: pct,
      skills: skillList(skills.map((k) => ({ ...k, name: pickLang(k.name, l) }))), code: cert.code, url, hash: cert.hash.slice(0, 32) };
    if (s.email) {
      await deliver(ctx.rt, ctx.userId, {
        channel: "email", to: { email: s.email }, subject: tr(l, "cert.subject", p), text: tr(l, "cert.text", p),
        html: emailLayout(tr(l, "cert.title", p), [tr(l, "cert.p1", p), tr(l, "cert.p2", p), tr(l, "cert.p3", p), tr(l, "cert.p4", p)], { label: tr(l, "cert.cta"), url }, l)
      });
    }
    ctx.interactive = mainMenu(l);
    return { ok: true, passed: true, score, certificate: { code: cert.code, url },
      say: `${feedback}\n\n${tr(l, "quiz.passed", { ...p, correct: q.correct, total })}${s.email ? `\n${tr(l, "quiz.emailed")}` : ""}` };
  },

  async send_progress_email(_input, ctx) {
    const l = ctx.locale;
    const s = await state(ctx);
    if (!s.email) return { ok: false, say: tr(l, "email.noEmail") };
    const all = await gw(ctx).listEnrollments(ctx.userId);
    const lines = all.map((e) => tr(l, "email.progressLine", { course: e.courseTitle, expert: e.expertName, done: e.completedLessonCount, total: e.requiredLessonCount, percent: e.percentComplete }));
    const certs = await ctx.rt.store.listCertificatesByUser(ctx.userId);
    await deliver(ctx.rt, ctx.userId, { channel: "email", to: { email: s.email }, subject: tr(l, "email.progressSubject"), text: lines.join("\n"),
      html: emailLayout(tr(l, "email.progressTitle", { name: s.name }), [...(lines.length ? lines : [tr(l, "email.noCourses")]),
        ...(certs.length ? [tr(l, "email.certList", { codes: certs.map((c) => c.code).join(", ") })] : []), tr(l, "email.continue")],
        { label: tr(l, "email.open"), url: `${ctx.rt.config.appUrl.replace(/\/$/, "")}/dashboard/skilltutor` }, l) });
    return { ok: true, say: tr(l, "email.sent", { email: s.email }) };
  },

  async set_study_reminder(input, ctx) {
    const l = ctx.locale;
    const s = await state(ctx);
    const raw = String(input.time ?? "").trim().toLowerCase();
    if (/^(off|none|tắt|tat|cancel|hủy|huy)$/.test(raw)) {
      s.reminderTime = undefined;
      await ctx.rt.store.putState(s);
      return { ok: true, say: tr(l, "reminder.off") };
    }
    const m = raw.match(/^([01]?\d|2[0-3])[:h.]?([0-5]\d)?$/);
    if (!m) return { ok: false, say: tr(l, "reminder.invalid") };
    const time = `${m[1].padStart(2, "0")}:${m[2] ?? "00"}`;
    s.reminderTime = time;
    await ctx.rt.store.putState(s);
    await event(ctx, "reminder_set", undefined, { time });
    ctx.interactive = mainMenu(l);
    return { ok: true, reminderTime: time, say: tr(l, "reminder.set", { time, tz: ctx.rt.config.timeZone }) };
  },

  async verify_certificate(input, ctx) {
    const l = ctx.locale;
    const code = String(input.code ?? "");
    const r = await verifyCertificate(ctx.rt, code);
    if (!r.cert) return { ok: true, valid: false, say: tr(l, "verify.notFound", { code }) };
    return { ok: true, valid: r.valid, say: r.valid
      ? tr(l, "verify.valid", { name: r.cert.learnerName, course: r.cert.courseTitle, expert: r.cert.expertName, percent: Math.round(r.cert.score * 100), date: dateFmt(r.cert.issuedAt, l), skills: skillList(r.cert.skills) })
      : tr(l, "verify.invalid", { code }) };
  }
};

export const toolSpecs: ToolSpec[] = [
  { name: "get_my_learning", description: "List the learner's OMS enrollments (courses, cohorts) and progress. Use for greetings, 'progress', 'tiến độ', 'my courses'.", inputSchema: obj() },
  { name: "switch_course", description: "Switch the active course/cohort.", inputSchema: obj({ cohort_id: { type: "string" } }, ["cohort_id"]) },
  { name: "get_next_lesson", description: "Deliver the next uncompleted lesson of the active course (title, summary, outcomes).", inputSchema: obj() },
  { name: "explain_lesson", description: "Get the current lesson material to explain it further or answer the learner's question about it.", inputSchema: obj({ question: { type: "string" } }) },
  { name: "complete_lesson", description: "Record the current lesson as completed in OMS (DeliveryService). Use only when the learner says they finished it.", inputSchema: obj({ lesson_id: { type: "string" } }) },
  { name: "start_assessment", description: "Start the certification quiz for the active course (requires 100% course progress).", inputSchema: obj() },
  { name: "submit_answer", description: "Grade the learner's answer (option letter) in the active quiz. Issues and emails the certificate on pass.", inputSchema: obj({ answer: { type: "string" } }, ["answer"]) },
  { name: "send_progress_email", description: "Email the learner a progress report via Amazon SES.", inputSchema: obj() },
  { name: "set_study_reminder", description: "Set (\"HH:MM\", 24h, tutor time zone) or turn off (\"off\") the learner's daily study reminder.", inputSchema: obj({ time: { type: "string" } }, ["time"]) },
  { name: "verify_certificate", description: "Verify an OpenMatrix Skill certificate code (OMS-XXXXXXXX), e.g. for employers.", inputSchema: obj({ code: { type: "string" } }, ["code"]) }
];

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const fn = handlers[name];
  if (!fn) return { ok: false, say: `Unknown tool ${name}` };
  try {
    return await fn(input ?? {}, ctx);
  } catch (error) {
    console.error("skilltutor_tool_failed", { name, error });
    return { ok: false, say: tr(ctx.locale, "error.generic") };
  }
}
