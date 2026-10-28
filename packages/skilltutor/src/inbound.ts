import { runAgent } from "./agent/agent";
import { runTool } from "./agent/tools";
import { deliver } from "./channels";
import { detectLanguageCommand, tr, type TutorLocale } from "./i18n";
import { ensureTutorState, LINK_COMMAND, redeemLinkCode } from "./linking";
import type { SkillTutorRuntime } from "./runtime";
import { newId } from "./store";
import type { InteractiveOptions, MessagingChannel, TutorState } from "./types";
import { consumeDailyMessage, getDailyUsage, refundDailyMessage, zoneLabel, type DailyUsage } from "./limits";

const QUICK_IDS = ["next_lesson", "done_lesson", "explain", "start_quiz", "progress"] as const;

/** Quick-reply ids → natural language (in the learner's language) the agent understands. */
function quickReply(text: string, locale: TutorLocale) {
  return (QUICK_IDS as readonly string[]).includes(text) ? tr(locale, `quick.${text}` as Parameters<typeof tr>[1]) : text;
}

/** Best guess for people we don't know yet (unlinked numbers). */
export function guessLocale(text: string): TutorLocale {
  return /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]|\b(xin chào|chào|hoc|xac minh)\b/i.test(text) ? "vi" : "en";
}

function renderForSms(text: string, locale: TutorLocale, interactive?: InteractiveOptions) {
  const opts = interactive?.options ?? [];
  if (opts.length && opts.every((o) => /^[A-D]$/.test(o.id))) return `${text}\n${tr(locale, "smsReply", { options: opts.map((o) => o.id).join("/") })}`;
  return text;
}

async function reply(rt: SkillTutorRuntime, userId: string, phone: string, channel: MessagingChannel, text: string, interactive?: InteractiveOptions, locale: TutorLocale = "vi") {
  await deliver(rt, userId, {
    channel, to: { phone }, locale,
    text: channel === "sms" ? renderForSms(text, locale, interactive) : text,
    interactive: channel === "sms" ? undefined : interactive
  });
}

export interface InboundResult {
  linked: boolean;
  userId?: string;
  verified?: boolean;
  reply?: string;
  interactive?: InteractiveOptions;
  toolsUsed?: string[];
  /** Today's AI-message quota on this channel (after this message). */
  usage?: DailyUsage;
  /** true when the message was refused because the daily quota is used up. */
  limited?: boolean;
  /** Set when the AI could not answer (e.g. AccessDeniedException); `reply` then explains it. */
  error?: string;
}

/** Entry point for every inbound message (WhatsApp, SMS, simulator). */
export async function handleInbound(rt: SkillTutorRuntime, input: { phone: string; text: string; channel: MessagingChannel; name?: string }): Promise<InboundResult> {
  const now = rt.now().toISOString();
  const text = input.text.trim();

  // 1) Account linking: "LINK 123456"
  const link = text.match(LINK_COMMAND);
  if (link) {
    const r = await redeemLinkCode(rt, input.phone, link[1], input.channel);
    if (!r.ok) {
      await reply(rt, `phone:${input.phone}`, input.phone, input.channel, `${tr("vi", "link.invalid")}\n\n${tr("en", "link.invalid")}`);
      return { linked: false };
    }
    await rt.store.appendMessage({ userId: r.state.userId, at: now, direction: "in", channel: input.channel, text });
    const l: TutorLocale = r.state.locale === "en" ? "en" : "vi";
    const welcome = await runTool("get_my_learning", {}, { rt, userId: r.state.userId, channel: input.channel, locale: l });
    await reply(rt, r.state.userId, input.phone, input.channel, `${tr(l, "link.ok", { name: r.state.name })}\n\n${welcome.say}`,
      { options: [{ id: "next_lesson", title: tr(l, "menu.next") }, { id: "progress", title: tr(l, "menu.progress") }] }, l);
    return { linked: true, userId: r.state.userId };
  }

  // 2) Unlinked numbers: employers may still verify certificates; everyone else gets onboarding.
  const binding = await rt.store.getLinkByPhone(input.phone);
  if (!binding) {
    const pseudo = `phone:${input.phone}`;
    const cert = text.match(/OMS-[0-9A-F]{8}/i);
    if (cert) {
      const l = guessLocale(text);
      const r = await runTool("verify_certificate", { code: cert[0].toUpperCase() }, { rt, userId: pseudo, channel: input.channel, locale: l });
      await reply(rt, pseudo, input.phone, input.channel, r.say, undefined, l);
      return { linked: false, verified: true };
    }
    const url = `${rt.config.appUrl.replace(/\/$/, "")}/dashboard/skilltutor`;
    const via = input.channel === "sms" ? "SMS" : "WhatsApp";
    const vi = `Xin chào${input.name ? ` ${input.name}` : ""}! Đây là SkillTutor của OpenMatrix Skill.\nĐể học qua ${via}, đăng nhập ${url}, bấm "Liên kết WhatsApp" và gửi mã LINK cho số này.\nNhà tuyển dụng: gửi mã chứng chỉ OMS-XXXXXXXX để xác minh.`;
    const en = `Hi${input.name ? ` ${input.name}` : ""}! This is SkillTutor by OpenMatrix Skill.\nTo learn via ${via}, sign in at ${url}, tap "Link WhatsApp" and send the LINK code to this number.\nEmployers: send a certificate code OMS-XXXXXXXX to verify it.`;
    await reply(rt, pseudo, input.phone, input.channel, guessLocale(text) === "en" ? `${en}\n\n${vi}` : `${vi}\n\n${en}`);
    return { linked: false };
  }

  // 3) Linked learner → shared conversation flow.
  const s = await rt.store.getState(binding.userId);
  if (!s) return { linked: false };
  return converse(rt, s, text, input.channel, input.phone);
}

/**
 * One conversational turn for a known learner on any channel (WhatsApp, SMS, simulator or in-app web chat):
 * engagement bookkeeping, language switch, quick replies, agent, reply.
 */
export async function converse(rt: SkillTutorRuntime, s: TutorState, rawText: string, channel: MessagingChannel, phone?: string): Promise<InboundResult> {
  const now = rt.now().toISOString();
  const text = rawText.trim();
  if (s.rescue.nudgedSinceActive) {
    await rt.store.addEvent({ id: newId(), at: now, type: "reactivated", userId: s.userId, channel, data: { afterStage: s.rescue.stage } });
  }
  s.lastActiveAt = now;
  s.rescue = { stage: 0, nudgedSinceActive: false };
  if (phone) s.phone = phone;
  if (channel === "whatsapp" || channel === "simulator") s.lastWhatsAppInboundAt = now;
  if (channel === "whatsapp" || channel === "sms") s.preferredChannel = channel;
  await rt.store.putState(s);

  const send = async (msg: string, interactive?: InteractiveOptions, l: TutorLocale = "vi") => {
    if (channel === "web" || channel === "app") await deliver(rt, s.userId, { channel, to: {}, text: msg, interactive, locale: l });
    else await reply(rt, s.userId, phone ?? s.phone ?? "", channel, msg, interactive, l);
  };

  // Explicit language switch ("English" / "Tiếng Việt").
  const switchTo = detectLanguageCommand(text);
  if (switchTo) {
    s.locale = switchTo;
    await rt.store.putState(s);
    await rt.store.appendMessage({ userId: s.userId, at: now, direction: "in", channel, text });
    const r = await runTool("get_my_learning", {}, { rt, userId: s.userId, channel, locale: switchTo });
    const msg = `${tr(switchTo, "lang.switched")}\n\n${r.say}`;
    const menu = { options: [{ id: "next_lesson", title: tr(switchTo, "menu.next") }, { id: "start_quiz", title: tr(switchTo, "menu.quiz") }, { id: "progress", title: tr(switchTo, "menu.progress") }] };
    await send(msg, menu, switchTo);
    return { linked: true, userId: s.userId, reply: msg, interactive: menu, toolsUsed: ["get_my_learning"] };
  }
  const locale: TutorLocale = s.locale === "en" ? "en" : "vi";
  // Course-picker ids (course:<expert>:<cohort>) are stored as a readable line, like a tapped button.
  const normalized = /^course:[^:]+:.+$/.test(text) ? tr(locale, "quick.course") : quickReply(text, locale);
  const record = async () => {
    await rt.store.appendMessage({ userId: s.userId, at: now, direction: "in", channel, text: normalized });
    await rt.store.addEvent({ id: newId(), at: now, type: "message_in", userId: s.userId, channel });
  };
  const direct = async (tool: string, input: Record<string, unknown>) => {
    const ctx = { rt, userId: s.userId, channel, locale } as Parameters<typeof runTool>[2];
    const r = await runTool(tool, input, ctx);
    return { reply: r.say, interactive: ctx.interactive, toolsUsed: [tool] };
  };

  // Deterministic turns that don't need the AI (and don't count towards the daily quota):
  // course switch buttons and quiz answers A–D while a test is running.
  const course = text.match(/^course:([^:]+):(.+)$/);
  const answer = s.activeQuiz ? text.match(/^\s*([A-Da-d])\s*[.)]?\s*$/) : null;
  if (course || answer) {
    await record();
    const out = course ? await direct("switch_course", { cohort_id: course[2] }) : await direct("submit_answer", { answer: answer![1].toUpperCase() });
    await send(out.reply, out.interactive, locale);
    return { linked: true, userId: s.userId, ...out, usage: await getDailyUsage(rt, s.userId, channel) };
  }

  // Everything else goes to Claude: N messages per learner per day, per channel.
  const quota = await consumeDailyMessage(rt, s.userId, channel);
  await record();
  if (!quota.allowed) {
    const where = channel === "web" ? "SkillTutor AI" : channel === "sms" ? "SMS" : "WhatsApp";
    const msg = tr(locale, "limit.reached", { limit: quota.usage.limit, channel: where, tz: zoneLabel(rt.config.timeZone, rt.now()) });
    await rt.store.addEvent({ id: newId(), at: now, type: "daily_limit", userId: s.userId, channel, data: { limit: quota.usage.limit } });
    // Web shows the notice every time; phones get it once a day (no paid message per extra attempt).
    if (channel === "web" || channel === "app" || quota.firstRefusal) await send(msg, undefined, locale);
    return { linked: true, userId: s.userId, reply: msg, limited: true, usage: quota.usage, toolsUsed: [] };
  }

  let out: Awaited<ReturnType<typeof runAgent>> & { error?: string };
  try {
    out = await runAgent(rt, { userId: s.userId, text: normalized, channel });
  } catch (error) {
    // Bedrock/AgentCore unavailable, denied or timed out: answer with a clear message instead of failing the request.
    const e = error as Error & { name?: string; $metadata?: { httpStatusCode?: number } };
    const code = e.name && e.name !== "Error" ? e.name : "AGENT_ERROR";
    console.error("skilltutor_agent_failed", { userId: s.userId, channel, code, status: e.$metadata?.httpStatusCode, message: e.message });
    await rt.store.addEvent({ id: newId(), at: now, type: "agent_error", userId: s.userId, channel, data: { code } }).catch(() => undefined);
    await refundDailyMessage(rt, s.userId, channel);
    out = { reply: tr(locale, "agent.unavailable", { code }), toolsUsed: [], error: code };
  }
  await send(out.reply, out.interactive, locale);
  const usage = out.error ? await getDailyUsage(rt, s.userId, channel) : quota.usage;
  return { linked: true, userId: s.userId, ...out, usage };
}

/**
 * In-browser chat for a signed-in OMS user (no phone needed):
 * `web` = SkillTutor AI bubble (Claude), `app` = "Learn on the web", which continues the WhatsApp conversation.
 */
export async function handleWebMessage(rt: SkillTutorRuntime, user: { id: string }, text: string, channel: "web" | "app" = "web"): Promise<InboundResult> {
  const s = await ensureTutorState(rt, user.id);
  if (!s) return { linked: false };
  return converse(rt, s, text, channel);
}
