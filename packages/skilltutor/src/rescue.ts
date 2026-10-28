import { deliver } from "./channels";
import { emailLayout } from "./channels/email";
import { tr, type TutorLocale } from "./i18n";
import type { SkillTutorRuntime } from "./runtime";
import { newId } from "./store";
import type { OutboundMessage, TutorState } from "./types";
import { localizeGateway } from "./oms/localized";

/**
 * Drop-out Rescue: escalate across CDS channels the longer a linked learner is inactive, one rung per run.
 *   stage 1 – day 3: WhatsApp (free text inside the 24h window, else an approved template)
 *   stage 2 – day 5: SMS
 *   stage 3 – day 7: email via SES with a comeback plan
 */
export const LADDER = [
  { stage: 1 as const, afterDays: 3, channel: "whatsapp" as const },
  { stage: 2 as const, afterDays: 5, channel: "sms" as const },
  { stage: 3 as const, afterDays: 7, channel: "email" as const }
];
const DAY = 86_400_000;

export interface RescueReport {
  checked: number;
  skippedQuietHours: boolean;
  nudged: { userId: string; name: string; stage: number; channel: string; daysInactive: number; course: string }[];
}

const localHour = (now: Date, timeZone: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(now));

async function nextStep(rt: SkillTutorRuntime, s: TutorState) {
  const gateway = localizeGateway(rt.gateway, s.locale);
  const enrollments = (await gateway.listEnrollments(s.userId)).filter((e) => !e.courseCompletedAt);
  const e = enrollments.find((x) => x.cohortId === s.active?.cohortId) ?? enrollments[0];
  if (!e) return null;
  const lessons = await gateway.getLessons(e.expertId, e.courseId, e.courseVersionNumber);
  const lesson = lessons.find((l) => !e.completedLessonIds.includes(l.id));
  return { course: e.courseTitle, expertId: e.expertId, lesson: lesson?.title ?? tr(s.locale, "rescue.quizLesson"), minutes: lesson?.estimatedMinutes ?? 10, percent: e.percentComplete };
}

/** Values for the approved template's {{1}}, {{2}}… in the order of SKILLTUTOR_WHATSAPP_TEMPLATE_PARAMS. */
export function templateParams(rt: SkillTutorRuntime, s: TutorState, n: { lesson: string; course: string; minutes: number }) {
  const values: Record<string, string> = { name: s.name, lesson: n.lesson, course: n.course, minutes: String(n.minutes) };
  return rt.config.whatsapp.templateParams.map((k) => values[k] ?? "");
}

async function compose(rt: SkillTutorRuntime, s: TutorState, channel: string, days: number, n: NonNullable<Awaited<ReturnType<typeof nextStep>>>) {
  const l: TutorLocale = s.locale === "en" ? "en" : "vi";
  const p = { name: s.name, days, lesson: n.lesson, course: n.course, minutes: n.minutes, percent: n.percent };
  const fallback: Record<string, string> = { whatsapp: tr(l, "rescue.whatsapp", p), sms: tr(l, "rescue.sms", p), email: tr(l, "rescue.email", p) };
  // Nudges go out on WhatsApp/SMS/email: they follow the phone engine (rules = fixed templates, no AI cost).
  if (rt.config.llmMode !== "bedrock" || rt.config.phoneEngine !== "bedrock") return fallback[channel];
  try {
    const res = await rt.llm.converse(
      "Bạn viết tin nhắn khích lệ học viên quay lại học. Ấm áp, cụ thể, không gây áp lực, không hứa hẹn điều không có. Chỉ trả về nội dung tin nhắn.",
      [{ role: "user", content: [{ text: `Language: ${l === "en" ? "English (SMS ends with 'Opt out: STOP')" : "tiếng Việt (SMS không dấu, kết thúc bằng 'Tu choi: STOP')"}. Kênh: ${channel} (SMS < 160 ký tự). Tên: ${s.name}. Nghỉ ${days} ngày. Khóa: ${n.course} (${n.percent}%). Bài tiếp: ${n.lesson}, ${n.minutes} phút.` }] }],
      []
    );
    return res.content.map((b) => ("text" in b ? b.text : "")).join("").trim() || fallback[channel];
  } catch {
    return fallback[channel];
  }
}

export async function runRescue(rt: SkillTutorRuntime, opts: { ignoreQuietHours?: boolean } = {}): Promise<RescueReport> {
  const now = rt.now();
  const report: RescueReport = { checked: 0, skippedQuietHours: false, nudged: [] };
  const hour = localHour(now, rt.config.timeZone);
  if (!opts.ignoreQuietHours && (hour < 8 || hour >= 21)) return { ...report, skippedQuietHours: true };

  for (const s of await rt.store.listStates()) {
    if (!s.phone && !s.email) continue;
    report.checked++;
    const days = Math.floor((now.getTime() - new Date(s.lastActiveAt).getTime()) / DAY);
    // Web-only learners (no linked phone) skip the WhatsApp/SMS rungs and get the day-7 email.
    const target = s.phone ? LADDER[s.rescue.stage] : s.rescue.stage < 3 ? LADDER[2] : undefined;
    if (!target || days < target.afterDays) continue;
    const n = await nextStep(rt, s);
    if (!n) continue; // nothing left to learn
    const text = await compose(rt, s, target.channel, days, n);

    let out: OutboundMessage | null = null;
    if (target.channel === "whatsapp") {
      const inWindow = s.lastWhatsAppInboundAt && now.getTime() - new Date(s.lastWhatsAppInboundAt).getTime() < DAY;
      out = inWindow
        ? { channel: "whatsapp", to: { phone: s.phone! }, text, locale: s.locale, interactive: { options: [{ id: "next_lesson", title: tr(s.locale, "menu.learnNow") }] } }
        : { channel: "whatsapp", to: { phone: s.phone! }, text, template: { name: rt.config.whatsapp.nudgeTemplate, language: s.locale === "en" ? rt.config.whatsapp.templateLanguageEn : rt.config.whatsapp.templateLanguage, params: templateParams(rt, s, n) } };
    } else if (target.channel === "sms") {
      out = { channel: "sms", to: { phone: s.phone! }, text };
    } else if (s.email) {
      out = { channel: "email", to: { email: s.email }, subject: tr(s.locale, "rescue.emailSubject", { name: s.name, lesson: n.lesson }), text,
        html: emailLayout(tr(s.locale, "rescue.emailTitle", { name: s.name, course: n.course }), [text], { label: tr(s.locale, "rescue.cta"), url: `${rt.config.appUrl.replace(/\/$/, "")}/dashboard/skilltutor/learn` }, s.locale === "en" ? "en" : "vi") };
    }

    s.rescue = { stage: target.stage, lastNudgeAt: now.toISOString(), nudgedSinceActive: true };
    await rt.store.putState(s);
    if (!out) continue;
    await deliver(rt, s.userId, out);
    await rt.store.addEvent({ id: newId(), at: now.toISOString(), type: "nudge_sent", userId: s.userId, expertId: n.expertId, channel: target.channel, data: { stage: target.stage, daysInactive: days } });
    report.nudged.push({ userId: s.userId, name: s.name, stage: target.stage, channel: target.channel, daysInactive: days, course: n.course });
  }
  return report;
}

const localDate = (now: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export interface ReminderReport { checked: number; sent: { userId: string; name: string; channel: string; time: string }[] }

/**
 * Daily study reminders chosen by learners ("nhắc 20:30" / "remind me at 20:30").
 * Runs from the same hourly cron as the rescue job; sends at most once per local day,
 * and skips learners who already studied today.
 */
export async function runReminders(rt: SkillTutorRuntime): Promise<ReminderReport> {
  const now = rt.now();
  const tz = rt.config.timeZone;
  const hour = localHour(now, tz);
  const today = localDate(now, tz);
  const report: ReminderReport = { checked: 0, sent: [] };
  for (const s of await rt.store.listStates()) {
    if (!s.reminderTime || (!s.phone && !s.email)) continue;
    report.checked++;
    if (Number(s.reminderTime.slice(0, 2)) !== hour || s.lastReminderOn === today) continue;
    if (localDate(new Date(s.lastActiveAt), tz) === today) continue; // already studied today
    const n = await nextStep(rt, s);
    if (!n) continue;
    const l: TutorLocale = s.locale === "en" ? "en" : "vi";
    const text = tr(l, "reminder.message", { name: s.name, lesson: n.lesson, minutes: n.minutes });
    let out: OutboundMessage;
    if (s.phone) {
      const inWindow = s.lastWhatsAppInboundAt && now.getTime() - new Date(s.lastWhatsAppInboundAt).getTime() < DAY;
      out = inWindow
        ? { channel: "whatsapp", to: { phone: s.phone }, text, locale: l, interactive: { options: [{ id: "next_lesson", title: tr(l, "menu.learnNow") }] } }
        : { channel: "whatsapp", to: { phone: s.phone }, text, locale: l, template: { name: rt.config.whatsapp.nudgeTemplate, language: l === "en" ? rt.config.whatsapp.templateLanguageEn : rt.config.whatsapp.templateLanguage, params: templateParams(rt, s, n) } };
    } else {
      out = { channel: "email", to: { email: s.email }, subject: tr(l, "reminder.emailSubject", { lesson: n.lesson }), text,
        html: emailLayout(tr(l, "reminder.emailSubject", { lesson: n.lesson }), [text], { label: tr(l, "rescue.cta"), url: `${rt.config.appUrl.replace(/\/$/, "")}/dashboard/skilltutor/learn` }, l) };
    }
    s.lastReminderOn = today;
    await rt.store.putState(s);
    await deliver(rt, s.userId, out);
    await rt.store.addEvent({ id: newId(), at: now.toISOString(), type: "reminder_sent", userId: s.userId, expertId: n.expertId, channel: out.channel });
    report.sent.push({ userId: s.userId, name: s.name, channel: out.channel, time: s.reminderTime });
  }
  return report;
}
