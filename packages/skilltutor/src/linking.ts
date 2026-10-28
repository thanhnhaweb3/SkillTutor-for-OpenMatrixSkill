import { randomInt } from "node:crypto";
import type { SkillTutorRuntime } from "./runtime";
import { newId } from "./store";
import type { MessagingChannel, TutorState } from "./types";

export const LINK_COMMAND = /^\s*(?:link|liên kết|lien ket)\s+(\d{6})\s*$/i;

/** Learner (logged in on the web) asks for a one-time code to send from WhatsApp/SMS. */
export async function createLinkCode(rt: SkillTutorRuntime, userId: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(rt.now().getTime() + rt.config.linkCodeTtlMinutes * 60_000).toISOString();
  await rt.store.putLinkCode({ code, userId, expiresAt });
  const wa = rt.config.whatsapp.displayNumber.replace(/\D/g, "");
  return {
    code,
    expiresAt,
    message: `LINK ${code}`,
    whatsappUrl: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`LINK ${code}`)}` : undefined,
    whatsappNumber: rt.config.whatsapp.displayNumber || undefined,
    smsNumber: rt.config.sms.displayNumber || undefined
  };
}

export async function ensureTutorState(rt: SkillTutorRuntime, userId: string, phone?: string): Promise<TutorState | null> {
  const existing = await rt.store.getState(userId);
  if (existing) {
    if (phone && existing.phone !== phone) { existing.phone = phone; await rt.store.putState(existing); }
    return existing;
  }
  const user = await rt.gateway.getUser(userId);
  if (!user) return null;
  const state: TutorState = { userId, name: user.name, email: user.email, locale: user.locale, phone, preferredChannel: "whatsapp",
    lastActiveAt: rt.now().toISOString(), rescue: { stage: 0, nudgedSinceActive: false } };
  await rt.store.putState(state);
  return state;
}

/**
 * Handles `LINK 123456` sent from a phone. Because the message comes from that number, possession of the
 * phone is proven; the code proves possession of the OMS session that generated it.
 */
export async function redeemLinkCode(rt: SkillTutorRuntime, phone: string, code: string, channel: MessagingChannel) {
  const entry = await rt.store.takeLinkCode(code);
  if (!entry || new Date(entry.expiresAt).getTime() < rt.now().getTime()) return { ok: false as const, reason: "INVALID_OR_EXPIRED" as const };
  const holder = await rt.store.getLinkByPhone(phone);
  if (holder && holder.userId !== entry.userId) await rt.store.deleteLink(holder.userId);
  await rt.store.putLink({ phone, userId: entry.userId, channel, linkedAt: rt.now().toISOString() });
  const state = await ensureTutorState(rt, entry.userId, phone);
  if (!state) return { ok: false as const, reason: "USER_NOT_FOUND" as const };
  if (channel !== "simulator") state.preferredChannel = channel;
  await rt.store.putState(state);
  await rt.store.addEvent({ id: newId(), at: rt.now().toISOString(), type: "linked", userId: entry.userId, channel });
  return { ok: true as const, state };
}

export async function unlink(rt: SkillTutorRuntime, userId: string) {
  await rt.store.deleteLink(userId);
  const s = await rt.store.getState(userId);
  if (s) { s.phone = undefined; await rt.store.putState(s); }
}
