import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import type { SkillTutorRuntime } from "../runtime";
import { threadChannels, threadOf, type Channel, type ChatMessage, type InteractiveOptions } from "../types";
import { tr, type TutorLocale } from "../i18n";
import type { Block, Msg } from "./llm";
import { mainMenu, runTool, toolSpecs, type ToolContext } from "./tools";

export interface AgentInput { userId: string; text: string; channel: Channel }
export interface AgentOutput { reply: string; interactive?: InteractiveOptions; toolsUsed: string[] }

const MAX_STEPS = 6;
const AGENT_DEADLINE_MS = 30_000;

function systemPrompt(name: string, channel: Channel, locale: string, quiz?: { index: number }) {
  return [
    "Bạn là SkillTutor – trợ lý học tập AI của OpenMatrix Skill (OMS): nền tảng chuẩn năng lực AI, khóa học theo skill framework và chứng chỉ số.",
    `Học viên: ${name}. Kênh: ${channel}.`,
    `LOCALE: ${locale}. Luôn trả lời bằng ${locale === "en" ? "English" : "tiếng Việt"}; tool đã trả \`say\` đúng ngôn ngữ này.`,
    "Quy tắc:",
    "- Mọi dữ liệu về khóa học, bài học, tiến độ, bài kiểm tra, chứng chỉ PHẢI lấy qua tool. Không tự bịa, không tự chấm điểm.",
    "- Khi tool trả về `say`, chuyển nguyên văn cho học viên (có thể thêm 1 câu khích lệ ngắn). Nếu tool có `instruction`, làm theo nó dựa trên `material`.",
    "- Chỉ ghi hoàn thành bài (complete_lesson) khi học viên xác nhận đã học xong.",
    "- Không tiết lộ đáp án trước khi học viên trả lời.",
    "- Trả lời ngắn (< 700 ký tự), định dạng WhatsApp (*đậm*, _nghiêng_), tối đa 2 emoji.",
    "- Câu hỏi ngoài phạm vi học tập hoặc cần người thật: hướng dẫn liên hệ Expert/giảng viên của khóa.",
    "- Mã dạng OMS-XXXXXXXX là mã chứng chỉ → verify_certificate.",
    `ACTIVE_QUIZ: ${quiz ? `yes (câu ${quiz.index + 1}). Nếu học viên gửi một chữ cái A/B/C/D, gọi submit_answer.` : "no"}`
  ].join("\n");
}

/** Stored history → strictly alternating Converse messages starting with "user". */
export function historyToMessages(history: ChatMessage[]): Msg[] {
  const msgs: Msg[] = [];
  for (const h of history.filter((m) => m.channel !== "email")) {
    const role = h.direction === "in" ? "user" : "assistant";
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content.push({ text: h.text });
    else msgs.push({ role, content: [{ text: h.text }] });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

/** Plan → act (OMS / CDS tools) → observe → answer. */
export async function runAgentLocal(rt: SkillTutorRuntime, input: AgentInput): Promise<AgentOutput> {
  const s = await rt.store.getState(input.userId);
  if (!s) throw new Error(`Unknown learner ${input.userId}`);
  // Only this channel's thread: the web bot and WhatsApp/SMS keep separate conversations.
  const history = (await rt.store.listMessages(input.userId, 13, threadChannels(input.channel))).slice(0, -1); // the current inbound message is stored last
  const messages = historyToMessages(history.slice(-12));
  const current: Block = { text: input.text };
  if (messages.length && messages[messages.length - 1].role === "user") messages[messages.length - 1].content.push(current);
  else messages.push({ role: "user", content: [current] });

  const locale: TutorLocale = s.locale === "en" ? "en" : "vi";
  const ctx: ToolContext = { rt, userId: input.userId, channel: input.channel, locale };
  const system = systemPrompt(s.name, input.channel, s.locale, s.activeQuiz);
  const toolsUsed: string[] = [];
  // SkillTutor AI (web bubble) talks to Claude; the WhatsApp thread uses the rules engine unless SKILLTUTOR_PHONE_ENGINE=bedrock.
  const llm = threadOf(input.channel) === "web" || rt.config.phoneEngine === "bedrock" ? rt.llm : rt.rulesLlm;
  const started = Date.now();
  for (let step = 0; step < MAX_STEPS; step++) {
    // Stay well inside the 60 s serverless limit: stop starting new model calls after ~30 s.
    if (step > 0 && Date.now() - started > AGENT_DEADLINE_MS) break;
    const res = await llm.converse(system, messages, toolSpecs);
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b): b is Extract<Block, { toolUse: unknown }> => "toolUse" in b);
    if (res.stopReason !== "tool_use" || uses.length === 0) {
      const reply = res.content.map((b) => ("text" in b ? b.text : "")).join("\n").trim();
      return { reply: reply || tr(locale, "agent.didNotUnderstand"), interactive: ctx.interactive ?? mainMenu(locale), toolsUsed };
    }
    const results: Block[] = [];
    for (const u of uses) {
      toolsUsed.push(u.toolUse.name);
      const r = await runTool(u.toolUse.name, u.toolUse.input, ctx);
      results.push({ toolResult: { toolUseId: u.toolUse.toolUseId, content: [{ json: r }], status: r.ok ? "success" : "error" } });
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: tr(locale, "agent.tooComplex"), interactive: mainMenu(locale), toolsUsed };
}

/** AgentCore Runtime session ids must be ≥ 33 characters. */
export const runtimeSessionId = (userId: string) => `skilltutor-session-${userId}`.padEnd(40, "0");

/** In-process, or on Amazon Bedrock AgentCore Runtime (same code: agentcore/server.ts). */
export async function runAgent(rt: SkillTutorRuntime, input: AgentInput): Promise<AgentOutput> {
  if (rt.config.agentMode !== "agentcore") return runAgentLocal(rt, input);
  const client = new BedrockAgentCoreClient({ region: rt.config.region });
  const res = await client.send(new InvokeAgentRuntimeCommand({
    agentRuntimeArn: rt.config.agentRuntimeArn,
    runtimeSessionId: runtimeSessionId(input.userId),
    contentType: "application/json",
    accept: "application/json",
    payload: new TextEncoder().encode(JSON.stringify(input))
  }));
  return JSON.parse((await res.response?.transformToString()) ?? "{}") as AgentOutput;
}
