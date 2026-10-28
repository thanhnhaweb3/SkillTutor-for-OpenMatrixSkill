import type { SkillTutorRuntime } from "./runtime";
import type { MessagingChannel } from "./types";

/** Daily AI-message quota, counted separately per channel and per learner. */
export interface DailyUsage {
  channel: MessagingChannel;
  day: string;
  used: number;
  /** 0 = unlimited */
  limit: number;
  remaining: number | null;
  timeZone: string;
}

/** Calendar day (YYYY-MM-DD) in the configured time zone. */
export function dayKey(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "GMT+7" for Asia/Ho_Chi_Minh (no underscores, so chat formatting can't mangle it). */
export function zoneLabel(timeZone: string, at = new Date()) {
  try {
    return new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch { return timeZone; }
}

/** "Learn on the web" continues the WhatsApp conversation, so it shares the WhatsApp quota. */
const quotaChannel = (channel: MessagingChannel): Exclude<MessagingChannel, "app"> => (channel === "app" ? "whatsapp" : channel);

export const dailyLimit = (rt: SkillTutorRuntime, channel: MessagingChannel) => Math.max(0, Math.floor(rt.config.dailyLimits[quotaChannel(channel)] ?? 0));

const view = (rt: SkillTutorRuntime, channel: MessagingChannel, day: string, used: number): DailyUsage => {
  const limit = dailyLimit(rt, channel);
  return { channel, day, used: Math.min(used, limit || used), limit, remaining: limit ? Math.max(0, limit - used) : null, timeZone: rt.config.timeZone };
};

export async function getDailyUsage(rt: SkillTutorRuntime, userId: string, channel: MessagingChannel): Promise<DailyUsage> {
  const day = dayKey(rt.now(), rt.config.timeZone);
  if (!dailyLimit(rt, channel)) return view(rt, channel, day, 0);
  const used = await rt.store.getUsage(userId, `${day}#${quotaChannel(channel)}`).catch((error) => {
    console.error("skilltutor_usage_read_failed", { userId, channel, error: String(error) });
    return 0;
  });
  return view(rt, channel, day, used);
}

/**
 * Counts one message to the AI agent. `allowed` is false once the learner is over today's quota;
 * `firstRefusal` is true only for the first message over it (so phone channels reply once, not every time).
 */
export async function consumeDailyMessage(rt: SkillTutorRuntime, userId: string, channel: MessagingChannel) {
  const limit = dailyLimit(rt, channel);
  const day = dayKey(rt.now(), rt.config.timeZone);
  if (!limit) return { allowed: true, firstRefusal: false, usage: view(rt, channel, day, 0) };
  const expires = new Date(rt.now().getTime() + 3 * 24 * 3600_000); // DynamoDB TTL cleans old counters
  let count: number;
  try {
    count = await rt.store.incrementUsage(userId, `${day}#${quotaChannel(channel)}`, expires);
  } catch (error) {
    // Fail open: a counter outage (e.g. missing dynamodb:UpdateItem) must not break the chat.
    console.error("skilltutor_usage_write_failed", { userId, channel, error: String(error) });
    return { allowed: true, firstRefusal: false, usage: view(rt, channel, day, 0) };
  }
  return { allowed: count <= limit, firstRefusal: count === limit + 1, usage: view(rt, channel, day, count) };
}

/** Gives a message back when the AI failed to answer it. */
export async function refundDailyMessage(rt: SkillTutorRuntime, userId: string, channel: MessagingChannel) {
  if (!dailyLimit(rt, channel)) return;
  const day = dayKey(rt.now(), rt.config.timeZone);
  await rt.store.incrementUsage(userId, `${day}#${quotaChannel(channel)}`, new Date(rt.now().getTime() + 3 * 24 * 3600_000), -1).catch(() => undefined);
}
