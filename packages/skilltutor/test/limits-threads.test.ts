import assert from "node:assert/strict";
import test from "node:test";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { anthropicRequestBody, BedrockAnthropicLlm, fromAnthropicContent, MockLlm, toAnthropicMessages, type Llm, type Msg } from "../src/agent/llm";
import { loadSkillTutorConfig } from "../src/config";
import { handleInbound, handleWebMessage } from "../src/inbound";
import { dayKey } from "../src/limits";
import { createLinkCode } from "../src/linking";
import { createDemoOms } from "../src/oms/demo";
import { OmsLearningGateway } from "../src/oms/gateway";
import { createSkillTutorRuntime } from "../src/runtime";
import { InMemorySkillTutorStore } from "../src/store";

const NOW = new Date("2026-10-16T03:00:00.000Z");
const PHONE = "+84909000111";
const USER = { id: "user-demo" };

/** MockLlm that also records which history the agent sent to the model. */
class SpyLlm implements Llm {
  readonly calls: Msg[][] = [];
  private readonly inner = new MockLlm();
  converse(system: string, messages: Msg[], tools: Parameters<Llm["converse"]>[2]) { this.calls.push(structuredClone(messages)); return this.inner.converse(system, messages, tools); }
}

function setup(limits = { web: 10, whatsapp: 10, sms: 10, simulator: 0 }, now = () => NOW, ai: Llm = new SpyLlm()) {
  const store = new InMemorySkillTutorStore();
  const llm = ai as SpyLlm;
  const rules = new SpyLlm();
  const rt = createSkillTutorRuntime({
    config: { ...loadSkillTutorConfig(), enabled: true, demo: true, channelsMode: "dryrun", llmMode: "mock", agentMode: "local", appUrl: "https://oms.test", dailyLimits: limits, timeZone: "Asia/Ho_Chi_Minh" },
    gateway: new OmsLearningGateway({ ...createDemoOms(), progressEnabled: () => true, now }),
    store, llm, rulesLlm: rules, sender: { whatsapp: async () => "x", sms: async () => "x", email: async () => "x" }, now
  });
  return { rt, store, llm, rules };
}
const texts = (msgs: Msg[]) => msgs.flatMap((m) => m.content.map((b) => ("text" in b ? b.text : ""))).join(" | ");

test("SkillTutor AI (Claude) and the WhatsApp thread keep separate conversations and engines", async () => {
  const { rt, store, llm, rules } = setup();
  const code = await createLinkCode(rt, USER.id);
  await handleInbound(rt, { phone: PHONE, text: `LINK ${code.code}`, channel: "whatsapp" });
  await handleInbound(rt, { phone: PHONE, text: "tiến độ whatsapp-secret", channel: "whatsapp" });
  await handleWebMessage(rt, USER, "tiến độ web-secret");

  assert.equal(llm.calls.length > 0, true, "the AI bubble calls Claude");
  assert.equal(rules.calls.every((c) => !/web-secret/.test(texts(c))), true, "the rules engine never sees the AI chat");
  const aiCall = llm.calls[llm.calls.length - 1];
  assert.match(texts(aiCall), /web-secret/);
  assert.doesNotMatch(texts(aiCall), /whatsapp-secret/, "Claude never sees WhatsApp messages");
  assert.equal(llm.calls.some((c) => /whatsapp-secret/.test(texts(c))), false, "WhatsApp never goes to Claude (rules engine)");

  // "Learn on the web" continues the WhatsApp thread with the rules engine.
  const before = llm.calls.length;
  await handleWebMessage(rt, USER, "tiến độ from-browser", "app");
  assert.equal(llm.calls.length, before, "no Bedrock call for Learn on the web");
  assert.match(texts(rules.calls[rules.calls.length - 1]), /whatsapp-secret/, "browser turn sees the WhatsApp history");
  const phoneThread = await store.listMessages(USER.id, 100, ["whatsapp", "sms", "simulator", "app"]);
  assert.ok(phoneThread.some((m) => m.channel === "app") && phoneThread.some((m) => m.channel === "whatsapp"));
  assert.ok((await store.listMessages(USER.id, 100, ["web"])).every((m) => m.channel === "web"));
});

test("Learn on the web shares the WhatsApp quota", async () => {
  const { rt } = setup({ web: 10, whatsapp: 3, sms: 3, simulator: 0 });
  const code = await createLinkCode(rt, USER.id);
  await handleInbound(rt, { phone: PHONE, text: `LINK ${code.code}`, channel: "whatsapp" });
  await handleInbound(rt, { phone: PHONE, text: "tiến độ", channel: "whatsapp" });
  assert.equal((await handleWebMessage(rt, USER, "tiến độ", "app")).usage?.remaining, 1);
  await handleInbound(rt, { phone: PHONE, text: "tiến độ", channel: "whatsapp" });
  assert.equal((await handleWebMessage(rt, USER, "tiến độ", "app")).limited, true);
  assert.equal((await handleWebMessage(rt, USER, "tiến độ")).usage?.remaining, 9, "the AI bubble has its own quota");
});

test("when Claude fails the learner gets a clear reply, the message is not charged", async () => {
  const failing: Llm = { converse: async () => { throw Object.assign(new Error("Model access is denied"), { name: "AccessDeniedException" }); } };
  const { rt } = setup(undefined, () => NOW, failing);
  const r = await handleWebMessage(rt, USER, "giải thích prompt là gì");
  assert.equal(r.error, "AccessDeniedException");
  assert.match(r.reply ?? "", /AccessDeniedException/);
  assert.equal(r.usage?.remaining, 10, "refunded");
});

test("10 AI messages per user per day, counted separately per channel; resets the next day", async () => {
  let now = NOW;
  const { rt, store } = setup(undefined, () => now);
  for (let i = 1; i <= 10; i++) {
    const r = await handleWebMessage(rt, USER, "tiến độ");
    assert.equal(r.limited, undefined, `message ${i} is allowed`);
    assert.equal(r.usage?.remaining, 10 - i);
  }
  const over = await handleWebMessage(rt, USER, "tiến độ");
  assert.equal(over.limited, true);
  assert.match(over.reply ?? "", /10/);
  assert.equal(over.usage?.remaining, 0);

  // WhatsApp has its own 10.
  const code = await createLinkCode(rt, USER.id);
  await handleInbound(rt, { phone: PHONE, text: `LINK ${code.code}`, channel: "whatsapp" });
  const wa = await handleInbound(rt, { phone: PHONE, text: "tiến độ", channel: "whatsapp" });
  assert.equal(wa.limited, undefined);
  assert.equal(wa.usage?.remaining, 9);

  // Phones get the "limit reached" notice once, not on every extra message.
  for (let i = 0; i < 9; i++) await handleInbound(rt, { phone: PHONE, text: "tiến độ", channel: "whatsapp" });
  const before = store.outbox.length;
  assert.equal((await handleInbound(rt, { phone: PHONE, text: "tiến độ", channel: "whatsapp" })).limited, true);
  assert.equal(store.outbox.length, before + 1);
  assert.equal((await handleInbound(rt, { phone: PHONE, text: "tiến độ", channel: "whatsapp" })).limited, true);
  assert.equal(store.outbox.length, before + 1, "no second notice the same day");

  now = new Date(NOW.getTime() + 24 * 3600_000);
  assert.equal((await handleWebMessage(rt, USER, "tiến độ")).usage?.remaining, 9, "new day, new quota");
});

test("quiz answers and course switches don't use the quota; limit 0 = unlimited", async () => {
  const { rt } = setup({ web: 1, whatsapp: 1, sms: 1, simulator: 0 });
  const s = (await rt.store.getState(USER.id)) ?? (await handleWebMessage(rt, USER, "xin chào"), await rt.store.getState(USER.id))!;
  s.activeQuiz = { courseVersionId: "x", expertId: "x", cohortId: "x", index: 0, correct: 0, answers: [], startedAt: NOW.toISOString() } as never;
  await rt.store.putState(s);
  const a = await handleWebMessage(rt, USER, "B");
  assert.notEqual(a.limited, true);
  assert.deepEqual(a.toolsUsed, ["submit_answer"]);

  const sim = setup({ web: 1, whatsapp: 1, sms: 1, simulator: 0 });
  const code = await createLinkCode(sim.rt, USER.id);
  await handleInbound(sim.rt, { phone: PHONE, text: `LINK ${code.code}`, channel: "simulator" });
  for (let i = 0; i < 5; i++) assert.notEqual((await handleInbound(sim.rt, { phone: PHONE, text: "tiến độ", channel: "simulator" })).limited, true);
});

test("dayKey follows the configured time zone", () => {
  assert.equal(dayKey(new Date("2026-10-16T16:59:00Z"), "Asia/Ho_Chi_Minh"), "2026-10-16");
  assert.equal(dayKey(new Date("2026-10-16T17:00:00Z"), "Asia/Ho_Chi_Minh"), "2026-10-17");
});

test("Anthropic Messages API body: alternating roles, tool_use/tool_result, top_p replaces temperature, prompt cache", () => {
  const msgs: Msg[] = [
    { role: "user", content: [{ text: "học" }] },
    { role: "assistant", content: [{ text: "" }, { toolUse: { toolUseId: "t1", name: "get_next_lesson", input: {} } }] },
    { role: "user", content: [{ toolResult: { toolUseId: "t1", content: [{ json: { ok: true, say: "Bài 1" } }], status: "success" } }] },
    { role: "user", content: [{ text: "tiếp" }] }
  ];
  const a = toAnthropicMessages(msgs);
  assert.deepEqual(a.map((m) => m.role), ["user", "assistant", "user"]);
  assert.deepEqual(a[1].content, [{ type: "tool_use", id: "t1", name: "get_next_lesson", input: {} }], "empty text blocks are dropped");
  assert.deepEqual(a[2].content[0], { type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ ok: true, say: "Bài 1" }) });

  const params = { region: "ap-southeast-2", modelId: "m", maxTokens: 500, temperature: 0.3 };
  const body = anthropicRequestBody(params, "sys", msgs, [{ name: "get_next_lesson", description: "d", inputSchema: { type: "object", properties: {} } }]);
  assert.equal(body.anthropic_version, "bedrock-2023-05-31");
  assert.equal(body.max_tokens, 500);
  assert.equal((body as Record<string, unknown>).temperature, 0.3);
  assert.deepEqual(body.tools, [{ name: "get_next_lesson", description: "d", input_schema: { type: "object", properties: {} } }]);

  const tuned = anthropicRequestBody({ ...params, topP: 0.9, topK: 40, stopSequences: ["###"], promptCache: true }, "sys", msgs, [], { maxTokens: 4000 }) as Record<string, unknown>;
  assert.equal(tuned.temperature, undefined, "Claude 4.5 rejects temperature with top_p");
  assert.deepEqual([tuned.top_p, tuned.top_k, tuned.stop_sequences, tuned.max_tokens], [0.9, 40, ["###"], 4000]);
  assert.deepEqual((tuned.system as { cache_control?: unknown }[])[0].cache_control, { type: "ephemeral" });

  assert.deepEqual(fromAnthropicContent([{ type: "text", text: "hi" }, { type: "tool_use", id: "x", name: "n", input: { a: 1 } }, { type: "thinking" }]),
    [{ text: "hi" }, { toolUse: { toolUseId: "x", name: "n", input: { a: 1 } } }]);
});

test("BedrockAnthropicLlm calls InvokeModel with the Anthropic body and maps the response", async () => {
  const original = BedrockRuntimeClient.prototype.send;
  let sent: { modelId?: string; contentType?: string; body?: string } = {};
  BedrockRuntimeClient.prototype.send = (async (command: { input: typeof sent }) => {
    sent = command.input;
    return { body: new TextEncoder().encode(JSON.stringify({
      content: [{ type: "tool_use", id: "toolu_1", name: "get_my_learning", input: {} }], stop_reason: "tool_use", usage: { input_tokens: 120, output_tokens: 15 }
    })) };
  }) as never;
  try {
    const llm = new BedrockAnthropicLlm({ region: "ap-southeast-2", modelId: "global.anthropic.claude-haiku-4-5-20251001-v1:0", maxTokens: 800, temperature: 0.3, timeoutMs: 5000 });
    const res = await llm.converse("sys", [{ role: "user", content: [{ text: "tiến độ" }] }], [{ name: "get_my_learning", description: "d", inputSchema: { type: "object" } }]);
    assert.equal(sent.modelId, "global.anthropic.claude-haiku-4-5-20251001-v1:0");
    assert.equal(sent.contentType, "application/json");
    assert.equal(JSON.parse(sent.body!).anthropic_version, "bedrock-2023-05-31");
    assert.equal(res.stopReason, "tool_use");
    assert.deepEqual(res.content, [{ toolUse: { toolUseId: "toolu_1", name: "get_my_learning", input: {} } }]);
    assert.deepEqual(res.usage, { inputTokens: 120, outputTokens: 15, cacheReadTokens: undefined, cacheWriteTokens: undefined });
  } finally { BedrockRuntimeClient.prototype.send = original; }
});

test("My courses: lessons marked done / next, active course, and a readable course switch in the history", async () => {
  const { rt, store } = setup({ web: 10, whatsapp: 0, sms: 0, simulator: 0 });
  const { createMyCoursesHandler } = await import("../src/next/catalog");
  const { NextRequest } = await import("next/server");
  const mine = async () => (await createMyCoursesHandler(async () => rt, async () => ({ id: USER.id, name: "Jane" }))(new NextRequest("http://localhost:3000/api/skilltutor/courses"))).json();

  const before = await mine();
  assert.equal(before.courses.length, 1);
  const c0 = before.courses[0];
  assert.equal(c0.lessons.length, 4);
  assert.ok(c0.lessons.every((l: { done: boolean }) => !l.done));
  assert.equal(c0.nextLessonId, c0.lessons[0].id);

  // "Continue on the web": switch to the course, get the next lesson, finish it.
  await handleWebMessage(rt, USER, `course:${c0.expertId}:${c0.cohortId}`, "app");
  await handleWebMessage(rt, USER, "next_lesson", "app");
  await handleWebMessage(rt, USER, "done_lesson", "app");

  const after = (await mine()).courses[0];
  assert.deepEqual(after.lessons.map((l: { done: boolean }) => l.done), [true, false, false, false]);
  assert.equal(after.nextLessonId, after.lessons[1].id);
  assert.equal(after.completedLessonCount, 1);
  assert.equal(after.active, true);
  assert.equal(after.certificateCode, null);
  const history = await store.listMessages(USER.id, 20, ["app"]);
  assert.ok(history.some((m) => m.direction === "in" && /Switch course|Chuyển khóa học/.test(m.text)), "course ids are not shown raw");
  assert.ok(!history.some((m) => m.text.startsWith("course:")));
});
