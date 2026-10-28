import { SendWhatsAppMessageCommand, SocialMessagingClient } from "@aws-sdk/client-socialmessaging";
import type { InteractiveOptions } from "../types";

const waTo = (phone: string) => phone.replace(/^\+/, "");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export type WhatsAppPayload = Record<string, unknown>;
/** Meta limit for the body of interactive (button / list) messages; plain text allows 4096. */
export const WA_INTERACTIVE_BODY_MAX = 1024;

/** Meta Cloud API message body, forwarded by AWS End User Messaging Social. */
export function buildWhatsAppPayload(input: { to: string; text?: string; interactive?: InteractiveOptions; template?: { name: string; language: string; params: string[] }; locale?: "vi" | "en" }): WhatsAppPayload {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: waTo(input.to) };
  if (input.template) {
    const components = input.template.params.length
      ? [{ type: "body", parameters: input.template.params.map((p) => ({ type: "text", text: clip(p, 1000) })) }] : undefined;
    return { ...base, type: "template", template: { name: input.template.name, language: { code: input.template.language }, ...(components ? { components } : {}) } };
  }
  const text = input.text ?? "";
  const opts = input.interactive?.options ?? [];
  if (opts.length > 0) {
    const header = input.interactive?.header ? { header: { type: "text", text: clip(input.interactive.header, 60) } } : {};
    if (opts.length <= 3) {
      return { ...base, type: "interactive", interactive: { type: "button", ...header, body: { text: clip(text, 1024) },
        action: { buttons: opts.map((o) => ({ type: "reply", reply: { id: clip(o.id, 256), title: clip(o.title, 20) } })) } } };
    }
    return { ...base, type: "interactive", interactive: { type: "list", ...header, body: { text: clip(text, 1024) },
      action: { button: input.locale === "en" ? "Choose" : "Chọn", sections: [{ title: input.locale === "en" ? "Options" : "Lựa chọn", rows: opts.slice(0, 10).map((o) => ({ id: clip(o.id, 200), title: clip(o.title, 24) })) }] } } };
  }
  return { ...base, type: "text", text: { preview_url: true, body: clip(text, 4096) } };
}

export async function sendWhatsApp(config: { region: string; originationPhoneNumberId: string; metaApiVersion: string }, payload: WhatsAppPayload) {
  const client = new SocialMessagingClient({ region: config.region });
  const r = await client.send(new SendWhatsAppMessageCommand({
    originationPhoneNumberId: config.originationPhoneNumberId,
    metaApiVersion: config.metaApiVersion,
    message: new TextEncoder().encode(JSON.stringify(payload)),
  }));
  return r.messageId;
}

export interface InboundWhatsApp { from: string; name?: string; text: string; messageId: string; type: string }

/** Parses the event AWS End User Messaging Social publishes to SNS (`whatsAppWebhookEntry` = Meta webhook entry). */
export function parseWhatsAppEvent(snsMessage: string | Record<string, unknown>): InboundWhatsApp[] {
  const evt = typeof snsMessage === "string" ? JSON.parse(snsMessage) : snsMessage;
  const raw = evt.whatsAppWebhookEntry;
  if (!raw) return [];
  const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
  const out: InboundWhatsApp[] = [];
  for (const change of entry.changes ?? []) {
    const value = change.value ?? {};
    const contacts: { wa_id: string; profile?: { name?: string } }[] = value.contacts ?? [];
    for (const m of value.messages ?? []) {
      let text = "";
      if (m.type === "text") text = m.text?.body ?? "";
      else if (m.type === "interactive") text = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? "";
      else if (m.type === "button") text = m.button?.payload ?? m.button?.text ?? "";
      out.push({ from: `+${m.from}`, name: contacts.find((c) => c.wa_id === m.from)?.profile?.name, text, messageId: m.id, type: m.type });
    }
  }
  return out;
}

export interface WhatsAppStatus { messageId: string; status: string; recipient: string; error?: string }

/** Delivery receipts (sent / delivered / read / failed) that End User Messaging Social publishes to the same SNS topic. */
export function parseWhatsAppStatuses(snsMessage: string | Record<string, unknown>): WhatsAppStatus[] {
  const evt = typeof snsMessage === "string" ? JSON.parse(snsMessage) : snsMessage;
  const raw = evt.whatsAppWebhookEntry;
  if (!raw) return [];
  const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
  const out: WhatsAppStatus[] = [];
  for (const change of entry.changes ?? []) {
    for (const s of change.value?.statuses ?? []) {
      const e = s.errors?.[0];
      out.push({ messageId: s.id, status: s.status, recipient: `+${s.recipient_id}`,
        error: e ? `${e.code} ${e.title ?? ""}${e.error_data?.details ? ` – ${e.error_data.details}` : ""}`.trim() : undefined });
    }
  }
  return out;
}
