import type { SkillTutorRuntime } from "../runtime";
import { newId } from "../store";
import type { OutboundMessage } from "../types";
import { sendEmail } from "./email";
import { sendSms } from "./sms";
import { tr } from "../i18n";
import { buildWhatsAppPayload, sendWhatsApp, WA_INTERACTIVE_BODY_MAX, type WhatsAppPayload } from "./whatsapp";

/** Live senders – replaceable in tests. */
export interface ChannelSender {
  whatsapp(payload: WhatsAppPayload): Promise<string | undefined>;
  sms(to: string, body: string): Promise<string | undefined>;
  email(to: string, subject: string, html: string, text: string): Promise<string | undefined>;
}

export function awsChannelSender(config: SkillTutorRuntime["config"]): ChannelSender {
  return {
    whatsapp: (payload) => sendWhatsApp({ region: config.region, ...config.whatsapp }, payload),
    sms: (to, body) => sendSms({ region: config.region, ...config.sms }, to, body),
    email: (to, subject, html, text) => sendEmail({ region: config.region, ...config.email }, to, subject, html, text),
  };
}

/** Single delivery point: records history + analytics, then calls AWS CDS (live) or the outbox (dry run / simulator). */
export async function deliver(rt: SkillTutorRuntime, userId: string, out: OutboundMessage) {
  const at = rt.now().toISOString();
  await rt.store.appendMessage({ userId, at, direction: "out", channel: out.channel, text: out.text, interactive: out.interactive });
  await rt.store.addEvent({ id: newId(), at, type: "message_out", userId, channel: out.channel, data: out.template ? { template: out.template.name } : undefined });
  // In-app web chat: the conversation history above is the delivery.
  if (out.channel === "web" || out.channel === "app") return { id: newId(), mode: "web" as const };
  if (rt.config.channelsMode === "dryrun" || out.channel === "simulator") {
    const id = newId();
    await rt.store.pushOutbox({ ...out, id, at, userId });
    return { id, mode: "dryrun" as const };
  }
  if (out.channel === "whatsapp") {
    if (!out.to.phone) throw new Error("WhatsApp requires a phone number");
    return { id: await sendWhatsAppLogged(rt, userId, out), mode: "live" as const };
  }
  if (out.channel === "sms") {
    if (!out.to.phone) throw new Error("SMS requires a phone number");
    return { id: await rt.sender.sms(out.to.phone, out.text), mode: "live" as const };
  }
  if (!out.to.email) throw new Error("Email requires an address");
  return { id: await rt.sender.email(out.to.email, out.subject ?? "OpenMatrix Skill", out.html ?? out.text, out.text), mode: "live" as const };
}

const maskPhone = (p: string) => (p.length > 6 ? `${p.slice(0, 4)}•••${p.slice(-3)}` : "•••");

/**
 * Sends one WhatsApp message (or two, when an interactive body is longer than Meta's 1024-character limit:
 * the full text first, then the buttons under a short prompt), logging and recording every result so
 * delivery problems show up in Vercel logs and in the SkillTutor diagnostics panel.
 */
async function sendWhatsAppLogged(rt: SkillTutorRuntime, userId: string, out: OutboundMessage) {
  const to = out.to.phone!;
  const payloads: WhatsAppPayload[] = [];
  if (!out.template && out.interactive?.options.length && out.text.length > WA_INTERACTIVE_BODY_MAX) {
    payloads.push(buildWhatsAppPayload({ to, text: out.text, locale: out.locale }));
    payloads.push(buildWhatsAppPayload({ to, text: tr(out.locale ?? "vi", "wa.next"), interactive: out.interactive, locale: out.locale }));
  } else {
    payloads.push(buildWhatsAppPayload({ to, text: out.text, interactive: out.interactive, template: out.template, locale: out.locale }));
  }
  let last: string | undefined;
  for (const payload of payloads) {
    const kind = String(payload.type);
    try {
      last = await rt.sender.whatsapp(payload);
      console.log(`[skilltutor] whatsapp ${kind} accepted id=${last} to=${maskPhone(to)}`);
      await rt.store.addEvent({ id: newId(), at: rt.now().toISOString(), type: "wa_sent", userId, channel: "whatsapp", data: { messageId: last, kind, to: maskPhone(to) } });
    } catch (error) {
      const e = error as Error & { $metadata?: { httpStatusCode?: number } };
      const detail = `${e.name}: ${e.message}`.slice(0, 500);
      console.error(`[skilltutor] whatsapp ${kind} FAILED to=${maskPhone(to)} http=${e.$metadata?.httpStatusCode ?? "-"} ${detail}`);
      await rt.store.addEvent({ id: newId(), at: rt.now().toISOString(), type: "wa_failed", userId, channel: "whatsapp", data: { kind, to: maskPhone(to), error: detail, http: e.$metadata?.httpStatusCode } });
      throw error;
    }
  }
  return last;
}
