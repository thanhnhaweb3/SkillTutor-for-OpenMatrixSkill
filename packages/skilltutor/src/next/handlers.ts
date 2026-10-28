import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createUserStore, loadAcConfig, readSessionToken, SESSION_COOKIE, usesPersistentUserStore, type AcUser } from "@openmatrix/oms-ac-login";
import { parseSmsEvent } from "../channels/sms";
import { parseWhatsAppEvent, parseWhatsAppStatuses } from "../channels/whatsapp";
import { verifyCertificate } from "../certificates";
import { handleInbound, handleWebMessage } from "../inbound";
import { getDailyUsage } from "../limits";
import { PHONE_CHANNELS, type Channel } from "../types";
import { createLinkCode, unlink } from "../linking";
import { runReminders, runRescue } from "../rescue";
import { getSkillTutorRuntime, type SkillTutorRuntime } from "../runtime";
import { newId } from "../store";
import { confirmSubscription, verifySnsMessage, type SnsEnvelope } from "../sns";

export type RuntimeProvider = () => Promise<SkillTutorRuntime>;
export type SessionUserResolver = (request: NextRequest) => Promise<Pick<AcUser, "id" | "name"> | null>;

export const headers = (requestId: string) => ({ "x-request-id": requestId, "cache-control": "private, no-store" });
export const rid = (r: NextRequest) => r.headers.get("x-request-id")?.trim() || `req_${randomUUID()}`;
export const fail = (code: string, status: number, requestId: string) => NextResponse.json({ error: { code, message: code, requestId } }, { status, headers: headers(requestId) });

/** Resolves the signed-in user and lets demo mode enroll them into the demo cohort. */
export async function signedIn(rt: SkillTutorRuntime, resolveUser: SessionUserResolver, request: NextRequest) {
  const user = await resolveUser(request);
  // Keep the tutor's chat language in sync with the learner's OMS profile language.
  const rawLocale = (user as { locale?: string } | null)?.locale;
  const locale = rawLocale === "en" || rawLocale === "vi" ? rawLocale : undefined;
  if (user && rt.onSessionUser) await rt.onSessionUser({ id: user.id, name: user.name, email: (user as { email?: string }).email, locale });
  if (user && locale) {
    const state = await rt.store.getState(user.id);
    if (state && state.locale !== locale) { state.locale = locale; await rt.store.putState(state); }
  }
  return user;
}

export const sessionUser: SessionUserResolver = async (request) => {
  const config = loadAcConfig();
  const payload = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret);
  if (!payload) return null;
  return usesPersistentUserStore(config) ? await createUserStore(config).findById(payload.userId) : payload.user ?? null;
};

/** Same-origin JSON check for cookie-authenticated mutations (CSRF). */
export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !!origin && origin === new URL(loadAcConfig().appUrl).origin;
}

async function snsBody(request: NextRequest, rt: SkillTutorRuntime): Promise<SnsEnvelope | NextResponse> {
  const body = (await request.json().catch(() => null)) as SnsEnvelope | null;
  if (!body || typeof body.Type !== "string") {
    // "Raw message delivery" on the SNS subscription strips the SNS envelope (Type, Signature…), so the message
    // can't be verified and is rejected. Subscription confirmations still arrive wrapped, which is why the
    // subscription shows "Confirmed" while every WhatsApp/SMS message fails. Say so loudly.
    const raw = !!body && (request.headers.get("x-amz-sns-message-type") !== null || "whatsAppWebhookEntry" in body || "originationNumber" in body);
    if (raw) {
      const topic = request.headers.get("x-amz-sns-topic-arn") ?? "unknown topic";
      console.error(`[skilltutor] webhook rejected: SNS "Raw message delivery" is enabled on the subscription of ${topic}. Disable it (SNS → Subscriptions → Edit) – raw messages carry no signature.`);
      await rt.store.addEvent({ id: newId(), at: rt.now().toISOString(), type: "webhook_rejected", userId: "system",
        data: { reason: "SNS_RAW_DELIVERY", topic, path: request.nextUrl.pathname } }).catch(() => undefined);
      return NextResponse.json({ error: { code: "SNS_RAW_DELIVERY",
        message: "SNS raw message delivery is enabled on this subscription. Turn it off (SNS → Subscriptions → Edit → Raw message delivery) so messages arrive in the signed SNS envelope." } }, { status: 400 });
    }
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (rt.config.verifySns && !(await verifySnsMessage(body))) return NextResponse.json({ error: "invalid SNS signature" }, { status: 403 });
  if (body.Type === "SubscriptionConfirmation") {
    await confirmSubscription(body);
    console.log("[skilltutor] SNS subscription confirmed for", body.TopicArn);
    return NextResponse.json({ confirmed: true });
  }
  return body;
}

const log = (...args: unknown[]) => console.log("[skilltutor]", ...args);
const mask = (phone: string) => (phone.length > 6 ? `${phone.slice(0, 4)}•••${phone.slice(-3)}` : "•••");

/** SNS HTTPS subscription for AWS End User Messaging Social (WhatsApp) events. */
export function createWhatsAppWebhookHandler(provider: RuntimeProvider = getSkillTutorRuntime) {
  return async function POST(request: NextRequest) {
    const rt = await provider();
    if (!rt.config.enabled) { log("whatsapp webhook: SKILLTUTOR_DISABLED"); return NextResponse.json({ error: "SKILLTUTOR_DISABLED" }, { status: 503 }); }
    const body = await snsBody(request, rt);
    if (body instanceof NextResponse) { log("whatsapp webhook: SNS", body.status); return body; }
    if (body.Type !== "Notification") return NextResponse.json({ ignored: body.Type });
    const messages = parseWhatsAppEvent(body.Message);
    for (const st of parseWhatsAppStatuses(body.Message)) {
      const line = `whatsapp status ${st.status} id=${st.messageId} to ${mask(st.recipient)}${st.error ? ` ERROR ${st.error}` : ""}`;
      if (st.error) console.error("[skilltutor]", line); else log(line);
      const link = await rt.store.getLinkByPhone(st.recipient).catch(() => null);
      await rt.store.addEvent({ id: newId(), at: rt.now().toISOString(), type: "wa_status", userId: link?.userId ?? "unknown", channel: "whatsapp",
        data: { messageId: st.messageId, status: st.status, to: mask(st.recipient), error: st.error } });
    }
    if (messages.length) log(`whatsapp webhook: notification with ${messages.length} message(s)`);
    let handled = 0;
    const errors: string[] = [];
    for (const m of messages) {
      if (!m.text) continue;
      try {
        const result = await handleInbound(rt, { phone: m.from, name: m.name, text: m.text, channel: "whatsapp" });
        log(`whatsapp in from ${mask(m.from)}: "${m.text.slice(0, 40)}" → ${JSON.stringify(result).slice(0, 200)}`);
        handled++;
      } catch (error) {
        const e = error as Error;
        errors.push(`${e.name}: ${e.message}`);
        console.error("[skilltutor] whatsapp inbound failed", mask(m.from), e.name, e.message);
      }
    }
    // 200 even on errors: SNS retries would re-run the agent and send duplicate replies.
    return NextResponse.json({ handled, errors: errors.length ? errors : undefined });
  };
}

/** Browser-friendly self-check: GET /api/skilltutor/webhooks/whatsapp. Shows flags only, never secrets. */
export function createWebhookStatusHandler(provider: RuntimeProvider = getSkillTutorRuntime) {
  return async function GET() {
    const rt = await provider();
    const c = rt.config;
    const problems: string[] = [];
    if (!c.enabled) problems.push("SKILLTUTOR_ENABLED is not true");
    if (c.channelsMode !== "live") problems.push("SKILLTUTOR_CHANNELS_MODE is not live – replies go to the Outbox only");
    if (!c.whatsapp.originationPhoneNumberId.startsWith("phone-number-id-")) problems.push("SKILLTUTOR_WHATSAPP_PHONE_NUMBER_ID must start with phone-number-id-");
    const apiMajor = Number(/^v(\d+)/.exec(c.whatsapp.metaApiVersion)?.[1] ?? 0);
    if (apiMajor < 21) problems.push(`SKILLTUTOR_WHATSAPP_META_API_VERSION=${c.whatsapp.metaApiVersion} is retired by Meta (v20.0 ended 2026-09-24) – use v25.0`);
    if (c.storeMode !== "dynamodb") problems.push("SKILLTUTOR_STORE is not dynamodb – on Vercel the LINK code is lost between serverless instances");
    if (!c.appUrl.startsWith("https://")) problems.push("NEXT_PUBLIC_APP_URL is not https");
    let store = "ok";
    try { await rt.store.getLinkByPhone("+0"); } catch (error) { store = `${(error as Error).name}: ${(error as Error).message}`; problems.push(`Store error: ${store}`); }
    // Recent webhook activity, so "nothing arrives" vs "arrives but rejected" is visible from this one URL.
    const events = store === "ok" ? await rt.store.listEvents(300).catch(() => []) : [];
    const rejected = events.find((e) => e.type === "webhook_rejected");
    const lastInbound = events.find((e) => e.channel === "whatsapp" && (e.type === "message_in" || e.type === "linked" || e.type === "wa_status"));
    if (rejected && (!lastInbound || rejected.at > lastInbound.at)) {
      problems.push(`Webhook is rejecting SNS messages (${String(rejected.data?.reason)}, last at ${rejected.at}) – disable "Raw message delivery" on the SNS subscription`);
    }
    return NextResponse.json({
      ok: problems.length === 0,
      problems,
      enabled: c.enabled, demo: c.demo, channelsMode: c.channelsMode, storeMode: c.storeMode, table: c.storeMode === "dynamodb" ? c.tableName : undefined,
      region: c.region, verifySns: c.verifySns, whatsappNumber: c.whatsapp.displayNumber || null,
      whatsappPhoneNumberIdSet: !!c.whatsapp.originationPhoneNumberId, metaApiVersion: c.whatsapp.metaApiVersion,
      template: { name: c.whatsapp.nudgeTemplate, vi: c.whatsapp.templateLanguage, en: c.whatsapp.templateLanguageEn }, defaultLocale: c.defaultLocale, store,
      webhook: `${c.appUrl.replace(/\/$/, "")}/api/skilltutor/webhooks/whatsapp`,
      lastWhatsAppEvent: lastInbound ? { at: lastInbound.at, type: lastInbound.type } : null,
      lastRejected: rejected ? { at: rejected.at, reason: rejected.data?.reason } : null
    }, { headers: { "cache-control": "no-store" } });
  };
}

const OPT_OUT = /^(stop|unsubscribe|huy|hủy)$/i;

/** SNS HTTPS subscription for AWS End User Messaging SMS two-way messages. */
export function createSmsWebhookHandler(provider: RuntimeProvider = getSkillTutorRuntime) {
  return async function POST(request: NextRequest) {
    const rt = await provider();
    if (!rt.config.enabled) return NextResponse.json({ error: "SKILLTUTOR_DISABLED" }, { status: 503 });
    const body = await snsBody(request, rt);
    if (body instanceof NextResponse) return body;
    const sms = body.Type === "Notification" ? parseSmsEvent(body.Message) : null;
    // Opt-out keywords are enforced by End User Messaging's opt-out list; never answer them.
    if (!sms || OPT_OUT.test(sms.text.trim())) return NextResponse.json({ handled: 0 });
    await handleInbound(rt, { phone: sms.from, text: sms.text, channel: "sms" });
    return NextResponse.json({ handled: 1 });
  };
}

/** Hourly EventBridge API destination with header x-cron-secret. `?force=1` ignores quiet hours. */
export function createRescueCronHandler(provider: RuntimeProvider = getSkillTutorRuntime) {
  return async function POST(request: NextRequest) {
    const rt = await provider();
    if (!rt.config.enabled) return NextResponse.json({ error: "SKILLTUTOR_DISABLED" }, { status: 503 });
    if (!rt.config.cronSecret || request.headers.get("x-cron-secret") !== rt.config.cronSecret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const rescue = await runRescue(rt, { ignoreQuietHours: request.nextUrl.searchParams.get("force") === "1" });
    return NextResponse.json({ ...rescue, reminders: await runReminders(rt) });
  };
}

/** Learner self-service: link status, one-time link code, unlink, own certificates. */
export function createLinkHandlers(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return {
    GET: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      const user = await signedIn(rt, resolveUser, request);
      if (!user) return fail("UNAUTHENTICATED", 401, requestId);
      const [link, certificates] = await Promise.all([rt.store.getLinkByUser(user.id), rt.store.listCertificatesByUser(user.id)]);
      return NextResponse.json({
        linked: !!link,
        phone: link ? `${link.phone.slice(0, 4)}•••${link.phone.slice(-3)}` : undefined,
        channel: link?.channel,
        whatsappNumber: rt.config.whatsapp.displayNumber || undefined,
        smsNumber: rt.config.sms.displayNumber || undefined,
        certificates: certificates.map((c) => ({ code: c.code, courseTitle: c.courseTitle, expertName: c.expertName, skills: c.skills, score: c.score, issuedAt: c.issuedAt }))
      }, { headers: headers(requestId) });
    },
    POST: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      if (!sameOrigin(request)) return fail("MISSING_PERMISSION", 403, requestId);
      const user = await signedIn(rt, resolveUser, request);
      if (!user) return fail("UNAUTHENTICATED", 401, requestId);
      return NextResponse.json(await createLinkCode(rt, user.id), { status: 201, headers: headers(requestId) });
    },
    DELETE: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      if (!sameOrigin(request)) return fail("MISSING_PERMISSION", 403, requestId);
      const user = await signedIn(rt, resolveUser, request);
      if (!user) return fail("UNAUTHENTICATED", 401, requestId);
      await unlink(rt, user.id);
      return NextResponse.json({ linked: false }, { headers: headers(requestId) });
    }
  };
}

export const STAFF_ROLES = new Set(["platform_admin", "expert_admin", "curriculum_manager", "instructor", "reviewer", "auditor"]);
const DAY = 86_400_000;

/** Operator overview for Expert staff (report:read + a non-learner role), scoped to the active Expert. */
export function createOverviewHandler(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return async function GET(request: NextRequest) {
    const requestId = rid(request);
    const rt = await provider();
    if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
    const user = await signedIn(rt, resolveUser, request);
    if (!user) return fail("UNAUTHENTICATED", 401, requestId);
    const context = await rt.gateway.resolveContext({ id: user.id, displayName: user.name }, request.nextUrl.searchParams.get("expertId")?.trim() || undefined);
    if (!context) return fail("NOT_MEMBER", 403, requestId);
    if (!context.permissions.includes("report:read") || !context.roles.some((r) => STAFF_ROLES.has(r))) return fail("MISSING_PERMISSION", 403, requestId);

    const states = [];
    for (const s of await rt.store.listStates()) if (await rt.gateway.isMember(context.expertId, s.userId)) states.push(s);
    const members = new Set(states.map((s) => s.userId));
    const events = (await rt.store.listEvents(2000)).filter((e) => e.expertId === context.expertId || (!e.expertId && members.has(e.userId)));
    const count = (t: string) => events.filter((e) => e.type === t).length;
    const nudged = new Set(events.filter((e) => e.type === "nudge_sent").map((e) => e.userId));
    const reactivated = new Set(events.filter((e) => e.type === "reactivated").map((e) => e.userId));
    const now = rt.now().getTime();
    return NextResponse.json({
      expertId: context.expertId,
      mode: { llm: rt.config.llmMode, agent: rt.config.agentMode, channels: rt.config.channelsMode, store: rt.config.storeMode },
      totals: {
        linkedLearners: states.filter((s) => s.phone).length,
        active7d: states.filter((s) => now - new Date(s.lastActiveAt).getTime() < 7 * DAY).length,
        lessonsDelivered: count("lesson_delivered"),
        lessonsCompleted: count("lesson_completed"),
        quizPassed: count("quiz_passed"),
        quizFailed: count("quiz_failed"),
        certificates: count("certificate_issued"),
        nudges: count("nudge_sent"),
        reactivationRate: nudged.size ? Math.round(([...reactivated].filter((u) => nudged.has(u)).length / nudged.size) * 100) : 0
      },
      byChannel: (["whatsapp", "sms", "email"] as const).map((channel) => ({
        channel,
        messages: events.filter((e) => e.type === "message_out" && e.channel === channel).length,
        nudges: events.filter((e) => e.type === "nudge_sent" && e.channel === channel).length
      })),
      learners: states.sort((a, b) => a.lastActiveAt.localeCompare(b.lastActiveAt)).map((s) => ({
        name: s.name, linked: !!s.phone, preferredChannel: s.preferredChannel, daysInactive: Math.floor((now - new Date(s.lastActiveAt).getTime()) / DAY),
        rescueStage: s.rescue.stage, inQuiz: !!s.activeQuiz
      })),
      recent: events.slice(0, 15).map((e) => ({ at: e.at, type: e.type, channel: e.channel }))
    }, { headers: headers(requestId) });
  };
}

/** Staff-only demo trigger for the rescue job (same-origin), so the dashboard can show the ladder. */
export function createRescueRunHandler(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return async function POST(request: NextRequest) {
    const requestId = rid(request);
    const rt = await provider();
    if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
    if (!sameOrigin(request)) return fail("MISSING_PERMISSION", 403, requestId);
    const user = await signedIn(rt, resolveUser, request);
    if (!user) return fail("UNAUTHENTICATED", 401, requestId);
    const context = await rt.gateway.resolveContext({ id: user.id, displayName: user.name });
    if (!context || !context.roles.some((r) => r === "expert_admin" || r === "platform_admin" || r === "instructor")) return fail("MISSING_PERMISSION", 403, requestId);
    return NextResponse.json(await runRescue(rt, { ignoreQuietHours: true }), { headers: headers(requestId) });
  };
}

/** Dry-run simulator: chat as a phone number without WhatsApp. Only when channels are in dry-run. */
export function createSimulatorHandlers(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  const guard = async (request: NextRequest, requestId: string) => {
    const rt = await provider();
    if (!rt.config.enabled || rt.config.channelsMode !== "dryrun") return { error: fail("SIMULATOR_DISABLED", 503, requestId) };
    if (!(await signedIn(rt, resolveUser, request))) return { error: fail("UNAUTHENTICATED", 401, requestId) };
    return { rt };
  };
  return {
    GET: async (request: NextRequest) => {
      const requestId = rid(request);
      const g = await guard(request, requestId);
      if (!g.rt) return g.error;
      const phone = request.nextUrl.searchParams.get("phone")?.trim() ?? "";
      const link = phone ? await g.rt.store.getLinkByPhone(phone) : null;
      const key = link?.userId ?? `phone:${phone}`;
      const [messages, outbox] = await Promise.all([g.rt.store.listMessages(key, 100, PHONE_CHANNELS), g.rt.store.listOutbox(60)]);
      return NextResponse.json({ linkedUserId: link?.userId, messages, outbox: outbox.reverse() }, { headers: headers(requestId) });
    },
    POST: async (request: NextRequest) => {
      const requestId = rid(request);
      const g = await guard(request, requestId);
      if (!g.rt) return g.error;
      if (!sameOrigin(request)) return fail("MISSING_PERMISSION", 403, requestId);
      const body = (await request.json().catch(() => null)) as { phone?: string; text?: string; channel?: string } | null;
      const phone = body?.phone?.trim() ?? "";
      if (!/^\+\d{8,15}$/.test(phone) || !body?.text?.trim()) return fail("VALIDATION_ERROR", 422, requestId);
      const result = await handleInbound(g.rt, { phone, text: body.text.slice(0, 1000), channel: body.channel === "sms" ? "sms" : "simulator" });
      return NextResponse.json(result, { headers: headers(requestId) });
    }
  };
}

/** Public certificate verification (employers). */
export function createCertificateVerifyHandler(provider: RuntimeProvider = getSkillTutorRuntime) {
  return async function GET(request: NextRequest, route: { params: { code: string } }) {
    const requestId = rid(request);
    const rt = await provider();
    const { valid, cert } = await verifyCertificate(rt, decodeURIComponent(route.params.code));
    if (!cert) return fail("NOT_FOUND", 404, requestId);
    return NextResponse.json({ valid, certificate: { code: cert.code, learnerName: cert.learnerName, expertName: cert.expertName, courseTitle: cert.courseTitle,
      skills: cert.skills, score: cert.score, issuedAt: cert.issuedAt, hash: cert.hash } }, { headers: { ...headers(requestId), "cache-control": "public, max-age=60" } });
  };
}

function chatHandlers(channel: "web" | "app", provider: RuntimeProvider, resolveUser: SessionUserResolver) {
  const thread = channel === "web" ? (["web"] as Channel[]) : PHONE_CHANNELS;
  return {
    GET: async (request: NextRequest) => {
      const requestId = rid(request);
      try {
        const rt = await provider();
        if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
        const user = await signedIn(rt, resolveUser, request);
        if (!user) return fail("UNAUTHENTICATED", 401, requestId);
        const [messages, state, usage, link] = await Promise.all([
          rt.store.listMessages(user.id, 100, thread), rt.store.getState(user.id), getDailyUsage(rt, user.id, channel), rt.store.getLinkByUser(user.id)
        ]);
        return NextResponse.json({
          messages, reminderTime: state?.reminderTime, locale: state?.locale, usage,
          engine: channel === "web" || rt.config.phoneEngine === "bedrock" ? rt.config.llmMode : "rules",
          whatsapp: { linked: !!link, channel: link?.channel }
        }, { headers: headers(requestId) });
      } catch (error) {
        console.error("skilltutor_chat_get_failed", { channel, requestId, error: String(error) });
        return fail("INTERNAL_ERROR", 500, requestId);
      }
    },
    POST: async (request: NextRequest) => {
      const requestId = rid(request);
      try {
        const rt = await provider();
        if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
        if (!sameOrigin(request)) return fail("MISSING_PERMISSION", 403, requestId);
        const user = await signedIn(rt, resolveUser, request);
        if (!user) return fail("UNAUTHENTICATED", 401, requestId);
        const body = (await request.json().catch(() => null)) as { text?: string } | null;
        const text = body?.text?.trim() ?? "";
        if (!text || text.length > 1000) return fail("VALIDATION_ERROR", 422, requestId);
        const result = await handleWebMessage(rt, user, text, channel);
        if (!result.linked) return fail("NOT_MEMBER", 403, requestId);
        return NextResponse.json({ reply: result.reply, interactive: result.interactive, usage: result.usage, limited: !!result.limited, error: result.error },
          { headers: headers(requestId) });
      } catch (error) {
        const e = error as Error;
        console.error("skilltutor_chat_post_failed", { channel, requestId, name: e?.name, message: e?.message });
        return fail("INTERNAL_ERROR", 500, requestId);
      }
    }
  };
}

/** "Learn on the web": the learner's WhatsApp/SMS conversation, continued in the browser (rules engine, WhatsApp quota). */
export function createLearnHandlers(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return chatHandlers("app", provider, resolveUser);
}

/** SkillTutor AI floating chat: its own conversation, answered by Claude on Amazon Bedrock. */
export function createAssistantChatHandlers(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return chatHandlers("web", provider, resolveUser);
}
