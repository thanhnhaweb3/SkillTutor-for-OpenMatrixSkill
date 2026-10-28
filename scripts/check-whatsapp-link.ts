/**
 * Explains why a WhatsApp (re)link did or did not work, straight from DynamoDB.
 * Prints masked phone numbers only – safe to paste into a support chat.
 *
 *   npm run check:whatsapp-link -- you@example.com            (OMS account email or user id)
 *   npm run check:whatsapp-link -- you@example.com +84901234567  (also inspect what that phone sent)
 */
import { createUserStore, loadAcConfig } from "../packages/oms-ac-login/src";
import { loadSkillTutorConfig } from "../packages/skilltutor/src/config";
import { dayKey } from "../packages/skilltutor/src/limits";
import { DynamoDbSkillTutorStore } from "../packages/skilltutor/src/store";

const [who, phoneArg] = process.argv.slice(2).filter((a) => !/^(email|phone)$/i.test(a));
if (!who) { console.error("Usage: npm run check:whatsapp-link -- <email|userId> [+phone]"); process.exit(1); }

const mask = (p?: string) => (p ? `${p.slice(0, 4)}•••${p.slice(-3)}` : "-");
const config = loadSkillTutorConfig();
const store = new DynamoDbSkillTutorStore({ region: config.region, tableName: config.tableName });
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: config.timeZone }) : "-");

async function main() {
  console.log(`SkillTutor WhatsApp link check · table ${config.tableName} (${config.region}) · channels ${config.channelsMode}`);
  if (config.storeMode !== "dynamodb") console.log("⚠ SKILLTUTOR_STORE is not dynamodb in this .env – links on Vercel live in DynamoDB.");

  const users = createUserStore(loadAcConfig());
  const user = who.includes("@") ? await users.findByEmail(who.toLowerCase()) : await users.findById(who);
  if (!user) { console.log(`✗ No OMS account for ${who}`); return; }
  console.log(`\nAccount   ${user.name} · ${user.id}`);

  const [link, state, events, messages] = await Promise.all([
    store.getLinkByUser(user.id), store.getState(user.id), store.listEvents(1000), store.listMessages(user.id, 20, ["whatsapp", "sms", "simulator", "app"])
  ]);
  console.log(`Link      ${link ? `✓ ${link.channel} ${mask(link.phone)} since ${fmt(link.linkedAt)}` : "✗ not linked"}`);
  if (link) {
    const back = await store.getLinkByPhone(link.phone);
    console.log(`Phone→user ${back?.userId === user.id ? "✓ consistent" : `✗ PHONE# record points to ${back?.userId ?? "nothing"} (half-deleted link)`}`);
  }
  console.log(`State     ${state ? `phone ${mask(state.phone)} · preferred ${state.preferredChannel} · last WhatsApp in ${fmt(state.lastWhatsAppInboundAt)} · active ${fmt(state.lastActiveAt)}` : "✗ no tutor state yet"}`);
  const day = dayKey(new Date(), config.timeZone);
  console.log(`Quota     today ${day}: WhatsApp ${await store.getUsage(user.id, `${day}#whatsapp`)}/${config.dailyLimits.whatsapp || "∞"} · AI web ${await store.getUsage(user.id, `${day}#web`)}/${config.dailyLimits.web || "∞"}`);

  const mine = events.filter((e) => e.userId === user.id).slice(0, 25);
  console.log(`\nLast events for this account (newest first):`);
  for (const e of mine) console.log(`  ${fmt(e.at)}  ${e.type.padEnd(14)} ${e.channel ?? ""} ${e.data ? JSON.stringify(e.data).slice(0, 120) : ""}`);
  if (!mine.length) console.log("  (none)");

  console.log(`\nLast messages in the WhatsApp thread:`);
  for (const m of messages.slice(-12)) console.log(`  ${fmt(m.at)}  ${m.direction === "in" ? "→ in " : "← out"} ${m.channel.padEnd(9)} ${m.text.replace(/\s+/g, " ").slice(0, 70)}`);
  if (!messages.length) console.log("  (none)");

  const phone = phoneArg ?? link?.phone ?? state?.phone;
  if (phone) {
    const holder = await store.getLinkByPhone(phone);
    console.log(`\nPhone ${mask(phone)} is linked to: ${holder ? `${holder.userId}${holder.userId === user.id ? " (this account)" : " (ANOTHER account)"}` : "nobody"}`);
    const pseudo = await store.listMessages(`phone:${phone}`, 8);
    if (pseudo.length) {
      console.log("What the bot answered this phone while it was NOT linked (onboarding / invalid code):");
      for (const m of pseudo) console.log(`  ${fmt(m.at)}  ${m.direction === "in" ? "→ in " : "← out"} ${m.text.replace(/\s+/g, " ").slice(0, 90)}`);
    }
    const statuses = events.filter((e) => e.type === "wa_status" || e.type === "wa_failed").filter((e) => (e.data?.to as string | undefined) === mask(phone)).slice(0, 8);
    if (statuses.length) {
      console.log("WhatsApp delivery receipts to this phone:");
      for (const e of statuses) console.log(`  ${fmt(e.at)}  ${String(e.data?.status ?? e.type)} ${e.data?.error ? `ERROR ${e.data.error}` : ""}`);
    }
  }

  // Is WhatsApp → SNS → webhook delivering anything at all (any user)?
  const waIn = events.filter((e) => e.channel === "whatsapp" && (e.type === "message_in" || e.type === "linked"));
  const waAny = events.filter((e) => e.channel === "whatsapp");
  console.log(`\nWhatsApp activity (all users, last ${events.length} events): inbound ${waIn.length}, any ${waAny.length}`);
  console.log(`  last inbound from WhatsApp: ${waIn[0] ? fmt(waIn[0].at) : "NONE – no WhatsApp message has reached the webhook"}`);
  console.log(`  last WhatsApp event of any kind: ${waAny[0] ? `${fmt(waAny[0].at)} (${waAny[0].type})` : "none"}`);

  const rejected = events.filter((e) => e.type === "webhook_rejected");
  if (rejected.length) {
    console.log(`\n✗ The webhook REJECTED ${rejected.length} SNS message(s); last at ${fmt(rejected[0].at)} (${String(rejected[0].data?.reason)}).`);
    if (rejected[0].data?.reason === "SNS_RAW_DELIVERY")
      console.log("  → SNS → Subscriptions → (the HTTPS subscription) → Edit → turn OFF \"Enable raw message delivery\" → Save. Then send LINK again.");
  }

  const failures = events.filter((e) => e.type === "wa_failed" || (e.type === "wa_status" && e.data?.error)).slice(0, 5);
  if (failures.length) {
    console.log("\nRecent WhatsApp send failures (all users):");
    for (const e of failures) console.log(`  ${fmt(e.at)}  ${String(e.data?.error ?? e.data?.status ?? "")}`.slice(0, 200));
  }
}

main().catch((error: Error) => { console.error(`✗ ${error.name}: ${error.message}`); process.exit(1); });
