import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { MockLlm } from "../src/agent/llm";
import { buildWhatsAppPayload, parseWhatsAppEvent, parseWhatsAppStatuses } from "../src/channels/whatsapp";
import { parseSmsEvent } from "../src/channels/sms";
import { loadSkillTutorConfig } from "../src/config";
import { createLearnHandlers, createLinkHandlers, createOverviewHandler, createWebhookStatusHandler, createWhatsAppWebhookHandler } from "../src/next/handlers";
import { createWhatsAppDiagnosticsHandlers } from "../src/next/diagnostics";
import { createLinkCode } from "../src/linking";
import { handleInbound } from "../src/inbound";
import { createDemoOms } from "../src/oms/demo";
import { OmsLearningGateway } from "../src/oms/gateway";
import { createSkillTutorRuntime } from "../src/runtime";
import { stringToSign } from "../src/sns";
import { InMemorySkillTutorStore } from "../src/store";

process.env.APP_URL = "http://localhost:3000";
process.env.AC_SESSION_SECRET ??= "test-secret";

function runtime() {
  const store = new InMemorySkillTutorStore();
  const rt = createSkillTutorRuntime({
    config: { ...loadSkillTutorConfig(), enabled: true, demo: true, channelsMode: "dryrun", verifySns: false },
    gateway: new OmsLearningGateway({ ...createDemoOms(), progressEnabled: () => true }),
    store, llm: new MockLlm(), sender: { whatsapp: async () => "x", sms: async () => "x", email: async () => "x" }
  });
  return { rt, store, provider: async () => rt };
}

test("WhatsApp payloads: ≤3 options → reply buttons (20-char titles), more → list", () => {
  const b = buildWhatsAppPayload({ to: "+84901000001", text: "Q", interactive: { options: [{ id: "A", title: "A. a very long option title" }] } });
  assert.equal(b.to, "84901000001");
  const title = (b.interactive as { action: { buttons: { reply: { title: string } }[] } }).action.buttons[0].reply.title;
  assert.ok(title.length <= 20);
  const l = buildWhatsAppPayload({ to: "+1", text: "Q", interactive: { options: ["A", "B", "C", "D"].map((id) => ({ id, title: id })) } });
  assert.equal((l.interactive as { type: string }).type, "list");
  const t = buildWhatsAppPayload({ to: "+1", template: { name: "skilltutor_comeback", language: "vi", params: ["Hà", "Bài 1"] } });
  assert.equal(t.type, "template");
});

test("parses End User Messaging Social and two-way SMS events", () => {
  const entry = { changes: [{ value: { contacts: [{ wa_id: "84901", profile: { name: "Hà" } }], messages: [
    { from: "84901", id: "w1", type: "text", text: { body: "học" } },
    { from: "84901", id: "w2", type: "interactive", interactive: { button_reply: { id: "done_lesson", title: "Đã học xong" } } }] } }] };
  assert.deepEqual(parseWhatsAppEvent({ whatsAppWebhookEntry: JSON.stringify(entry) }).map((m) => [m.from, m.text, m.name]), [["+84901", "học", "Hà"], ["+84901", "done_lesson", "Hà"]]);
  assert.deepEqual(parseSmsEvent(JSON.stringify({ originationNumber: "+8490", messageBody: "hoc", inboundMessageId: "i" })), { from: "+8490", text: "hoc", messageId: "i" });
});

test("SNS string-to-sign follows the canonical key order", () => {
  assert.equal(stringToSign({ Type: "Notification", MessageId: "1", TopicArn: "arn", Message: "m", Timestamp: "t", SignatureVersion: "2", Signature: "", SigningCertURL: "" }),
    "Message\nm\nMessageId\n1\nTimestamp\nt\nTopicArn\narn\nType\nNotification\n");
});

test("WhatsApp webhook routes SNS notifications to the agent", async () => {
  const { provider, store } = runtime();
  const entry = { changes: [{ value: { messages: [{ from: "84909000555", id: "w1", type: "text", text: { body: "xin chào" } }] } }] };
  const request = new NextRequest("http://localhost:3000/api/skilltutor/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ Type: "Notification", MessageId: "1", TopicArn: "arn", Timestamp: "t", SignatureVersion: "2", Signature: "", SigningCertURL: "", Message: JSON.stringify({ whatsAppWebhookEntry: JSON.stringify(entry) }) }) });
  const res = await createWhatsAppWebhookHandler(provider)(request);
  assert.deepEqual(await res.json(), { handled: 1 });
  assert.equal(store.outbox.at(-1)?.to.phone, "+84909000555");
});

test("SNS raw message delivery is rejected with a clear code, recorded, and reported by the status URL", async () => {
  const { provider, store } = runtime();
  const entry = { changes: [{ value: { messages: [{ from: "84909000555", id: "w1", type: "text", text: { body: "LINK 123456" } }] } }] };
  // Raw delivery: SNS posts the EUM event itself, without Type/Signature.
  const request = new NextRequest("http://localhost:3000/api/skilltutor/webhooks/whatsapp", { method: "POST",
    headers: { "content-type": "text/plain; charset=UTF-8", "x-amz-sns-message-type": "Notification", "x-amz-sns-topic-arn": "arn:aws:sns:ap-southeast-2:1:SkillTutor" },
    body: JSON.stringify({ context: {}, whatsAppWebhookEntry: JSON.stringify(entry) }) });
  const res = await createWhatsAppWebhookHandler(provider)(request);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, "SNS_RAW_DELIVERY");
  assert.equal(store.outbox.length, 0, "an unverifiable message is never processed");
  assert.equal(store.events.at(-1)?.type, "webhook_rejected");
  const status = await (await createWebhookStatusHandler(provider)()).json();
  assert.equal(status.ok, false);
  assert.match(status.problems.join(" "), /Raw message delivery/);
  assert.equal(status.lastRejected.reason, "SNS_RAW_DELIVERY");
});

test("link endpoints require a session and same-origin mutations", async () => {
  const { provider } = runtime();
  const anon = createLinkHandlers(provider, async () => null);
  assert.equal((await anon.GET(new NextRequest("http://localhost:3000/api/skilltutor/link"))).status, 401);
  const jane = createLinkHandlers(provider, async () => ({ id: "user-demo", name: "Jane Doe" }));
  const crossSite = await jane.POST(new NextRequest("http://localhost:3000/api/skilltutor/link", { method: "POST", headers: { origin: "https://evil.example" } }));
  assert.equal(crossSite.status, 403);
  const ok = await jane.POST(new NextRequest("http://localhost:3000/api/skilltutor/link", { method: "POST", headers: { origin: "http://localhost:3000" } }));
  assert.equal(ok.status, 201);
  assert.match((await ok.json()).code, /^\d{6}$/);
});

test("operator overview is limited to Expert staff", async () => {
  const { provider } = runtime();
  const learnerOnly = await createOverviewHandler(provider, async () => ({ id: "user-demo-bao", name: "Bảo" }))(new NextRequest("http://localhost:3000/api/skilltutor/overview"));
  assert.equal(learnerOnly.status, 403);
  const instructor = await createOverviewHandler(provider, async () => ({ id: "user-demo", name: "Jane" }))(new NextRequest("http://localhost:3000/api/skilltutor/overview"));
  assert.equal(instructor.status, 200);
  assert.equal((await instructor.json()).expertId, "expert-demo");
});

test("demo mode enrolls any signed-in account (e.g. a Cognito user) into the demo cohort", async () => {
  const rt = createSkillTutorRuntime({ config: { ...loadSkillTutorConfig(), enabled: true, demo: true }, store: new InMemorySkillTutorStore(), llm: new MockLlm() });
  const cognitoUser = async () => ({ id: "user-cognito-1", name: "Cognito User" });
  const res = await createOverviewHandler(async () => rt, cognitoUser)(new NextRequest("http://localhost:3000/api/skilltutor/overview"));
  assert.equal(res.status, 200);
  assert.deepEqual((await rt.gateway.listEnrollments("user-cognito-1")).map((e) => e.cohortId), ["cohort-demo-oct"]);
});

test("web learn API: session + same-origin required, returns the agent reply", async () => {
  const { provider } = runtime();
  const anon = createLearnHandlers(provider, async () => null);
  assert.equal((await anon.GET(new NextRequest("http://localhost:3000/api/skilltutor/learn"))).status, 401);
  const jane = createLearnHandlers(provider, async () => ({ id: "user-demo", name: "Jane Doe" }));
  const cross = await jane.POST(new NextRequest("http://localhost:3000/api/skilltutor/learn", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ text: "học" }) }));
  assert.equal(cross.status, 403);
  const ok = await jane.POST(new NextRequest("http://localhost:3000/api/skilltutor/learn", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ text: "học" }) }));
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).reply, /Bài 1\/4/);
  const history = await (await jane.GET(new NextRequest("http://localhost:3000/api/skilltutor/learn"))).json();
  assert.equal(history.messages.length, 2);
});

test("parses WhatsApp delivery receipts including Meta error codes", () => {
  const entry = { changes: [{ value: { statuses: [
    { id: "m1", status: "delivered", recipient_id: "84901" },
    { id: "m2", status: "failed", recipient_id: "84901", errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "24h window" } }] }] } }] };
  const st = parseWhatsAppStatuses({ whatsAppWebhookEntry: JSON.stringify(entry) });
  assert.deepEqual(st.map((s) => [s.status, s.error ?? null]), [["delivered", null], ["failed", "131047 Re-engagement message – 24h window"]]);
});

test("live WhatsApp: long interactive text is split (full text, then buttons) and every send is recorded", async () => {
  const sent: Record<string, unknown>[] = [];
  const store = new InMemorySkillTutorStore();
  const rt = createSkillTutorRuntime({
    config: { ...loadSkillTutorConfig(), enabled: true, demo: true, channelsMode: "live" },
    gateway: new OmsLearningGateway({ ...createDemoOms(), progressEnabled: () => true }), store, llm: new MockLlm(),
    sender: { whatsapp: async (p) => { sent.push(p); return `wamid-${sent.length}`; }, sms: async () => "x", email: async () => "x" }
  });
  const { deliver } = await import("../src/channels");
  await deliver(rt, "user-demo", { channel: "whatsapp", to: { phone: "+84901000001" }, text: "x".repeat(1500), locale: "en", interactive: { options: [{ id: "done_lesson", title: "Done" }] } });
  assert.deepEqual(sent.map((p) => p.type), ["text", "interactive"]);
  assert.equal(((sent[0].text as { body: string }).body).length, 1500, "lesson text is not truncated");
  assert.match(((sent[1].interactive as { body: { text: string } }).body.text), /What would you like to do next/);
  assert.deepEqual(store.events.filter((e) => e.type === "wa_sent").map((e) => e.data?.messageId), ["wamid-1", "wamid-2"]);

  const failing = createSkillTutorRuntime({ ...rt, sender: { ...rt.sender, whatsapp: async () => { throw Object.assign(new Error("Invalid metaApiVersion"), { name: "ValidationException", $metadata: { httpStatusCode: 400 } }); } } });
  await assert.rejects(deliver(failing, "user-demo", { channel: "whatsapp", to: { phone: "+84901000001" }, text: "hi" }), /Invalid metaApiVersion/);
  const failed = store.events.find((e) => e.type === "wa_failed");
  assert.equal(failed?.data?.http, 400);
  assert.match(String(failed?.data?.error), /ValidationException: Invalid metaApiVersion/);
});

test("SNS delivery receipts are stored for the diagnostics log; default Meta API version is a supported one", async () => {
  const { provider, store } = runtime();
  const entry = { changes: [{ value: { statuses: [{ id: "wamid-9", status: "failed", recipient_id: "84909000555", errors: [{ code: 131047, title: "Re-engagement message" }] }] } }] };
  const request = new NextRequest("http://localhost:3000/api/skilltutor/webhooks/whatsapp", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ Type: "Notification", MessageId: "2", TopicArn: "arn", Timestamp: "t", SignatureVersion: "2", Signature: "", SigningCertURL: "", Message: JSON.stringify({ whatsAppWebhookEntry: JSON.stringify(entry) }) }) });
  await createWhatsAppWebhookHandler(provider)(request);
  const ev = store.events.find((e) => e.type === "wa_status");
  assert.deepEqual([ev?.data?.status, ev?.data?.error], ["failed", "131047 Re-engagement message"]);
  const major = Number(/^v(\d+)/.exec(loadSkillTutorConfig().whatsapp.metaApiVersion)?.[1]);
  assert.ok(major >= 21, "v20.0 was retired by Meta on 2026-09-24");
});

test("diagnostics: staff send a test message to their own linked WhatsApp and see AWS errors verbatim", async () => {
  const { rt, provider } = runtime();
  const jane = async () => ({ id: "user-demo", name: "Jane Doe" });
  const diag = createWhatsAppDiagnosticsHandlers(provider, jane);
  const post = () => diag.POST(new NextRequest("http://localhost:3000/api/skilltutor/admin/whatsapp", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: "{}" }));
  assert.equal((await post()).status, 409, "not linked yet");
  const code = await createLinkCode(rt, "user-demo");
  await handleInbound(rt, { phone: "+84909000111", text: `LINK ${code.code}`, channel: "whatsapp" });
  assert.deepEqual(await (await post()).json(), { ok: true, mode: "dryrun", messageId: (await rt.store.listOutbox()).at(-1)?.id });

  rt.config.channelsMode = "live";
  rt.sender.whatsapp = async () => { throw Object.assign(new Error("Access denied"), { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } }); };
  const failed = await (await post()).json();
  assert.deepEqual(failed, { ok: false, error: { name: "AccessDeniedException", message: "Access denied", http: 403 } });
  const view = await (await diag.GET(new NextRequest("http://localhost:3000/api/skilltutor/admin/whatsapp"))).json();
  assert.equal(view.me.linked, true);
  assert.equal(view.events[0].type, "wa_failed");

  const learner = createWhatsAppDiagnosticsHandlers(provider, async () => ({ id: "user-demo-bao", name: "Bảo" }));
  assert.equal((await learner.GET(new NextRequest("http://localhost:3000/api/skilltutor/admin/whatsapp"))).status, 403);
});

test("template variables follow SKILLTUTOR_WHATSAPP_TEMPLATE_PARAMS; a template without variables sends no components", async () => {
  const { templateParams } = await import("../src/rescue");
  const { rt } = runtime();
  rt.config.whatsapp.templateParams = ["lesson", "minutes"];
  assert.deepEqual(templateParams(rt, { name: "Nhã" } as never, { lesson: "Bài 1", course: "AI", minutes: 6 }), ["Bài 1", "6"]);
  const none = buildWhatsAppPayload({ to: "+1", template: { name: "skilltutorreminder", language: "en", params: [] } });
  assert.deepEqual(none.template, { name: "skilltutorreminder", language: { code: "en" } });
});
