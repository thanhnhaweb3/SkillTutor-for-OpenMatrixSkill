import assert from "node:assert/strict";
import test from "node:test";
import { MockLlm } from "../src/agent/llm";
import { certificateHash, verifyCertificate } from "../src/certificates";
import { loadSkillTutorConfig } from "../src/config";
import { handleInbound, handleWebMessage } from "../src/inbound";
import { createLinkCode } from "../src/linking";
import { createDemoOms, DEMO_COHORT_ID, DEMO_EXPERT_ID } from "../src/oms/demo";
import { OmsLearningGateway } from "../src/oms/gateway";
import { rulesQuiz } from "../src/oms/quiz";
import { lessonsOf } from "../src/oms/gateway";
import { demoCourseVersion } from "../src/oms/demo";
import { runReminders, runRescue } from "../src/rescue";
import { createSkillTutorRuntime, seedDemoTutor } from "../src/runtime";
import { InMemorySkillTutorStore } from "../src/store";

const NOW = new Date("2026-10-16T03:00:00.000Z"); // 10:00 in Vietnam
const JANE_PHONE = "+84909000111";

function setup(opts: { progressEnabled?: boolean } = {}) {
  const oms = createDemoOms();
  const store = new InMemorySkillTutorStore();
  const rt = createSkillTutorRuntime({
    config: { ...loadSkillTutorConfig(), enabled: true, demo: true, channelsMode: "dryrun", llmMode: "mock", agentMode: "local", appUrl: "https://oms.test" },
    gateway: new OmsLearningGateway({ ...oms, progressEnabled: () => opts.progressEnabled ?? true, now: () => NOW }),
    store,
    llm: new MockLlm(),
    sender: { whatsapp: async () => "x", sms: async () => "x", email: async () => "x" },
    now: () => NOW
  });
  return { rt, oms, store };
}

async function linkJane(ctx: ReturnType<typeof setup>) {
  const code = await createLinkCode(ctx.rt, "user-demo");
  return handleInbound(ctx.rt, { phone: JANE_PHONE, text: `LINK ${code.code}`, channel: "whatsapp" });
}
const say = (ctx: ReturnType<typeof setup>, text: string) => handleInbound(ctx.rt, { phone: JANE_PHONE, text, channel: "whatsapp" });
const lastOut = (store: InMemorySkillTutorStore) => store.outbox[store.outbox.length - 1];

test("unlinked numbers get onboarding; LINK code binds the phone to the OMS user once", async () => {
  const ctx = setup();
  await say(ctx, "xin chào");
  assert.match(lastOut(ctx.store).text, /dashboard\/skilltutor/);
  assert.match(lastOut(ctx.store).text, /Link WhatsApp/, "onboarding is bilingual");

  const code = await createLinkCode(ctx.rt, "user-demo");
  const r = await handleInbound(ctx.rt, { phone: JANE_PHONE, text: `link ${code.code}`, channel: "whatsapp" });
  assert.equal(r.linked, true);
  assert.equal((await ctx.store.getLinkByPhone(JANE_PHONE))?.userId, "user-demo");
  assert.match(lastOut(ctx.store).text, /AI Prompting cho người đi làm/);

  const replay = await handleInbound(ctx.rt, { phone: "+84909000999", text: `LINK ${code.code}`, channel: "whatsapp" });
  assert.equal(replay.linked, false, "codes are single-use");
});

test("expired link codes are rejected", async () => {
  const ctx = setup();
  const code = await createLinkCode(ctx.rt, "user-demo");
  const later = createSkillTutorRuntime({ ...ctx.rt, now: () => new Date(NOW.getTime() + 16 * 60_000) });
  const r = await handleInbound(later, { phone: JANE_PHONE, text: `LINK ${code.code}`, channel: "whatsapp" });
  assert.equal(r.linked, false);
});

test("lessons come from the OMS CourseVersion and completion is written through DeliveryService with an audit event", async () => {
  const ctx = setup();
  await linkJane(ctx);
  const lesson = await say(ctx, "next_lesson");
  assert.deepEqual(lesson.toolsUsed, ["get_next_lesson"]);
  assert.match(lesson.reply ?? "", /Bài 1\/4: Cấu trúc một prompt tốt/);
  assert.deepEqual(lesson.interactive?.options.map((o) => o.id), ["done_lesson", "explain", "progress"]);

  const done = await say(ctx, "done_lesson");
  assert.match(done.reply ?? "", /tiến độ 25%/);
  const progress = await ctx.oms.delivery.getSelfProgress(DEMO_EXPERT_ID, DEMO_COHORT_ID, "user-demo");
  assert.deepEqual(progress?.completedLessonIds, ["lesson-prompt-structure"]);
  assert.equal(ctx.oms.delivery.audits.at(-1)?.action, "progress:lesson_complete");
  assert.equal(ctx.oms.delivery.audits.at(-1)?.actorUserId, "user-demo");
});

test("progress is not written when the Expert has not enabled the OMS progress flag", async () => {
  const ctx = setup({ progressEnabled: false });
  await linkJane(ctx);
  await say(ctx, "next_lesson");
  const done = await say(ctx, "done_lesson");
  assert.match(done.reply ?? "", /chưa bật ghi tiến độ/);
  assert.equal(ctx.oms.delivery.audits.length, 0);
});

test("full path: finish course → quiz from learning outcomes → hashed skill certificate emailed and verifiable", async () => {
  const ctx = setup();
  await linkJane(ctx);
  const early = await say(ctx, "start_quiz");
  assert.match(early.reply ?? "", /hoàn thành tất cả bài học/);

  for (let i = 0; i < 4; i++) { await say(ctx, "next_lesson"); await say(ctx, "done_lesson"); }
  const progress = await ctx.oms.delivery.getSelfProgress(DEMO_EXPERT_ID, DEMO_COHORT_ID, "user-demo");
  assert.ok(progress?.courseCompletedAt);
  assert.equal(ctx.oms.delivery.audits.at(-1)?.action, "progress:course_complete");

  const start = await say(ctx, "start_quiz");
  assert.match(start.reply ?? "", /Câu 1\/4/);
  const quiz = (await ctx.store.getQuizSet("cv-ai-prompting-1#vi"))!;
  let last;
  for (const q of quiz.questions) last = await say(ctx, q.correctOptionId);
  assert.match(last?.reply ?? "", /Chứng chỉ/);
  const code = (last?.reply ?? "").match(/OMS-[0-9A-F]{8}/)![0];

  const { valid, cert } = await verifyCertificate(ctx.rt, code);
  assert.equal(valid, true);
  assert.deepEqual(cert?.skills.map((s) => s.name).sort(), ["AI Agents Fundamentals", "AI Output Verification", "Prompt Design"]);
  assert.ok(ctx.store.outbox.some((o) => o.channel === "email" && o.to.email === "jane@ctw.edu.vn" && o.subject?.includes(code)));

  const tampered = { ...cert!, score: 0.1 };
  const { hash, ...rest } = tampered;
  assert.notEqual(certificateHash(rest), hash, "editing a certificate breaks its hash");

  const employer = await handleInbound(ctx.rt, { phone: "+84987654321", text: `Xác minh ${code}`, channel: "sms" });
  assert.equal(employer.verified, true);
  assert.match(lastOut(ctx.store).text, /hợp lệ/);
});

test("rules-based quiz uses each lesson's outcome as the correct answer", () => {
  const qs = rulesQuiz(lessonsOf(demoCourseVersion()));
  assert.equal(qs.length, 4);
  for (const q of qs) assert.equal(q.options.length, 3);
  assert.equal(qs[0].options.find((o) => o.id === qs[0].correctOptionId)?.text, "Viết prompt có đủ vai trò, nhiệm vụ, ngữ cảnh và định dạng");
});

test("Drop-out Rescue escalates WhatsApp template → SMS → email for linked learners and tracks reactivation", async () => {
  const ctx = setup();
  await seedDemoTutor(ctx.rt);
  const r1 = await runRescue(ctx.rt);
  assert.deepEqual(r1.nudged.map((n) => [n.userId, n.channel]), [["user-demo-bao", "whatsapp"], ["user-demo-ha", "whatsapp"]]);
  assert.equal(lastOut(ctx.store).template?.name, "skilltutor_comeback");
  assert.match(ctx.store.outbox.find((o) => o.userId === "user-demo-bao")!.template!.params[1], /Few-shot/, "nudge names the learner's real next OMS lesson");

  assert.deepEqual((await runRescue(ctx.rt)).nudged.map((n) => n.channel), ["sms"]);
  assert.deepEqual((await runRescue(ctx.rt)).nudged.map((n) => n.channel), ["email"]);
  assert.equal((await runRescue(ctx.rt)).nudged.length, 0);

  await handleInbound(ctx.rt, { phone: "+84901000003", text: "học", channel: "whatsapp" });
  assert.ok(ctx.store.events.some((e) => e.type === "reactivated" && e.userId === "user-demo-ha"));
  assert.equal((await ctx.store.getState("user-demo-ha"))?.rescue.stage, 0);
});

test("rescue respects quiet hours in Asia/Ho_Chi_Minh", async () => {
  const ctx = setup();
  const night = createSkillTutorRuntime({ ...ctx.rt, now: () => new Date("2026-10-16T15:30:00.000Z") }); // 22:30 local
  assert.equal((await runRescue(night)).skippedQuietHours, true);
});

test("English learners: language switch, English lesson UI, English quiz and certificate email", async () => {
  const ctx = setup();
  await linkJane(ctx);
  const sw = await say(ctx, "English");
  assert.match(sw.reply ?? "", /Switched to English/);
  assert.equal((await ctx.store.getState("user-demo"))?.locale, "en");

  const lesson = await say(ctx, "next_lesson");
  assert.match(lesson.reply ?? "", /Lesson 1\/4/);
  assert.deepEqual(lesson.interactive?.options.map((o) => o.title), ["Done ✓", "Explain more", "My progress"]);
  const done = await say(ctx, "done_lesson");
  assert.match(done.reply ?? "", /Recorded in OMS – progress 25%/);
  for (let i = 0; i < 3; i++) { await say(ctx, "next_lesson"); await say(ctx, "done_lesson"); }

  const start = await say(ctx, "start_quiz");
  assert.match(start.reply ?? "", /Question 1\/4/);
  const quiz = (await ctx.store.getQuizSet("cv-ai-prompting-1#en"))!;
  assert.match(quiz.questions[0].prompt, /^After the lesson/);
  let last;
  for (const q of quiz.questions) last = await say(ctx, q.correctOptionId);
  assert.match(last?.reply ?? "", /certificate has been issued/);
  const email = ctx.store.outbox.find((o) => o.channel === "email");
  assert.match(email?.subject ?? "", /certificate/);
  assert.match(email?.html ?? "", /lang="en"/);

  const back = await say(ctx, "Tiếng Việt");
  assert.match(back.reply ?? "", /Đã chuyển sang tiếng Việt/);
});

test("rescue nudges speak the learner's language", async () => {
  const ctx = setup();
  await seedDemoTutor(ctx.rt);
  const ha = (await ctx.store.getState("user-demo-ha"))!;
  ha.locale = "en";
  ha.lastWhatsAppInboundAt = new Date(NOW.getTime() - 3_600_000).toISOString(); // inside the 24h window → free text
  await ctx.store.putState(ha);
  await runRescue(ctx.rt);
  const toHa = ctx.store.outbox.find((o) => o.userId === "user-demo-ha");
  assert.match(toHa?.text ?? "", /^Hi Lê Thu Hà/);
  assert.equal(toHa?.interactive?.options[0].title, "Study now");
});

test("web chat: a signed-in learner studies and records OMS progress without any phone", async () => {
  const ctx = setup();
  const r = await handleWebMessage(ctx.rt, { id: "user-demo" }, "next_lesson");
  assert.equal(r.linked, true);
  assert.match(r.reply ?? "", /Bài 1\/4/);
  const done = await handleWebMessage(ctx.rt, { id: "user-demo" }, "done_lesson");
  assert.match(done.reply ?? "", /25%/);
  assert.equal(ctx.store.outbox.length, 0, "web replies are not sent through CDS");
  const history = await ctx.store.listMessages("user-demo");
  assert.ok(history.every((m) => m.channel === "web"));
  assert.equal((await ctx.store.getState("user-demo"))?.phone, undefined);
});

test("daily study reminder: set by chat, sent once at the chosen local hour, skipped if already studied", async () => {
  const ctx = setup();
  await linkJane(ctx);
  const set = await say(ctx, "nhắc mình lúc 10:30");
  assert.match(set.reply ?? "", /10:30/);
  assert.equal((await ctx.store.getState("user-demo"))?.reminderTime, "10:30");

  // NOW = 10:00 local; Jane was active today → skipped
  assert.equal((await runReminders(ctx.rt)).sent.length, 0);
  // Next day 10:05 local, not active since → sent once
  const nextDay = createSkillTutorRuntime({ ...ctx.rt, now: () => new Date("2026-10-17T03:05:00.000Z") });
  const first = await runReminders(nextDay);
  assert.deepEqual(first.sent.map((x) => x.channel), ["whatsapp"]);
  assert.match(lastOut(ctx.store).text, /đến giờ học/);
  assert.equal((await runReminders(nextDay)).sent.length, 0, "only once per day");

  const off = await say(ctx, "tắt nhắc");
  assert.match(off.reply ?? "", /tắt nhắc học/);
  assert.equal((await ctx.store.getState("user-demo"))?.reminderTime, undefined);
});

test("web-only learners skip WhatsApp/SMS rungs and get the day-7 email", async () => {
  const ctx = setup();
  await handleWebMessage(ctx.rt, { id: "user-demo" }, "hello");
  const later = createSkillTutorRuntime({ ...ctx.rt, now: () => new Date(NOW.getTime() + 8 * 86_400_000) });
  const r = await runRescue(later);
  assert.deepEqual(r.nudged.filter((n) => n.userId === "user-demo").map((n) => n.channel), ["email"]);
});
