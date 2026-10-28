import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand, type Message, type Tool } from "@aws-sdk/client-bedrock-runtime";
import { tr } from "../i18n";
import type { ToolSpec } from "./tools";

export type Block =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
  | { toolResult: { toolUseId: string; content: { json: Record<string, unknown> }[]; status?: "success" | "error" } };

export interface Msg {
  role: "user" | "assistant";
  content: Block[];
}

export interface LlmUsage { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }

export interface LlmResponse {
  content: Block[];
  stopReason: string;
  usage?: LlmUsage;
}

/** Per-call overrides (e.g. the quiz generator needs a longer answer). */
export interface LlmCallOptions { maxTokens?: number; temperature?: number }

export interface Llm {
  converse(system: string, messages: Msg[], tools: ToolSpec[], options?: LlmCallOptions): Promise<LlmResponse>;
}

/** Inference parameters shared by both Bedrock clients (see SKILLTUTOR_BEDROCK_* in the config). */
export interface BedrockParams {
  region: string;
  modelId: string;
  anthropicVersion?: string;
  maxTokens: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  timeoutMs?: number;
  maxAttempts?: number;
  promptCache?: boolean;
}

const runtimeClient = (p: BedrockParams) => new BedrockRuntimeClient({ region: p.region, maxAttempts: p.maxAttempts ?? 3 });
const callSignal = (p: BedrockParams) => (p.timeoutMs ? { abortSignal: AbortSignal.timeout(p.timeoutMs) } : {});

/** Amazon Bedrock Converse API with native tool use. */
export class BedrockLlm implements Llm {
  private readonly client: BedrockRuntimeClient;
  private readonly params: BedrockParams;
  constructor(params: BedrockParams);
  constructor(region: string, modelId: string);
  constructor(a: BedrockParams | string, modelId?: string) {
    this.params = typeof a === "string" ? { region: a, modelId: modelId!, maxTokens: 800, temperature: 0.3 } : a;
    this.client = runtimeClient(this.params);
  }

  async converse(system: string, messages: Msg[], tools: ToolSpec[], options: LlmCallOptions = {}): Promise<LlmResponse> {
    const p = this.params;
    const temperature = options.temperature ?? p.temperature;
    const res = await this.client.send(
      new ConverseCommand({
        modelId: p.modelId,
        system: [{ text: system }],
        messages: messages as unknown as Message[],
        toolConfig: tools.length === 0 ? undefined : {
          tools: tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema } } })) as unknown as Tool[],
        },
        inferenceConfig: {
          maxTokens: options.maxTokens ?? p.maxTokens,
          ...(p.topP !== undefined ? { topP: p.topP } : temperature !== undefined ? { temperature } : {}),
          ...(p.stopSequences?.length ? { stopSequences: p.stopSequences } : {})
        },
        ...(p.topK !== undefined ? { additionalModelRequestFields: { top_k: p.topK } } : {}),
      }),
      callSignal(p),
    );
    return {
      content: (res.output?.message?.content ?? []) as unknown as Block[],
      stopReason: res.stopReason ?? "end_turn",
      usage: res.usage ? { inputTokens: res.usage.inputTokens ?? 0, outputTokens: res.usage.outputTokens ?? 0 } : undefined,
    };
  }
}

// ---- Anthropic Messages API on Bedrock (InvokeModel with the native Claude request body) ----

type AnthropicBlock =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface AnthropicMessage { role: "user" | "assistant"; content: AnthropicBlock[] }

/** Converse-style blocks (what the agent and the store speak) → Anthropic Messages blocks. */
export function toAnthropicMessages(messages: Msg[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    const content: AnthropicBlock[] = [];
    for (const b of m.content) {
      if ("text" in b) { if (b.text.trim()) content.push({ type: "text", text: b.text }); }
      else if ("toolUse" in b) content.push({ type: "tool_use", id: b.toolUse.toolUseId, name: b.toolUse.name, input: b.toolUse.input ?? {} });
      else if ("toolResult" in b) content.push({
        type: "tool_result", tool_use_id: b.toolResult.toolUseId,
        content: JSON.stringify(b.toolResult.content.length === 1 ? b.toolResult.content[0].json : b.toolResult.content.map((c) => c.json)),
        ...(b.toolResult.status === "error" ? { is_error: true } : {})
      });
    }
    if (content.length === 0) content.push({ type: "text", text: "…" }); // Anthropic rejects empty turns
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push(...content); // roles must alternate
    else out.push({ role: m.role, content });
  }
  return out;
}

/** Anthropic response blocks → Converse-style blocks. Thinking/other block types are ignored. */
export function fromAnthropicContent(content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]): Block[] {
  const out: Block[] = [];
  for (const c of content) {
    if (c.type === "text" && typeof c.text === "string") out.push({ text: c.text });
    else if (c.type === "tool_use" && c.id && c.name) out.push({ toolUse: { toolUseId: c.id, name: c.name, input: c.input ?? {} } });
  }
  return out;
}

/** The exact JSON body sent to InvokeModel (exported for tests and the check:bedrock script). */
export function anthropicRequestBody(p: BedrockParams, system: string, messages: Msg[], tools: ToolSpec[], options: LlmCallOptions = {}) {
  const temperature = options.temperature ?? p.temperature;
  const anthropicTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  if (p.promptCache && anthropicTools.length) (anthropicTools[anthropicTools.length - 1] as Record<string, unknown>).cache_control = { type: "ephemeral" };
  return {
    anthropic_version: p.anthropicVersion ?? "bedrock-2023-05-31",
    max_tokens: options.maxTokens ?? p.maxTokens,
    system: [{ type: "text", text: system, ...(p.promptCache ? { cache_control: { type: "ephemeral" } } : {}) }],
    messages: toAnthropicMessages(messages),
    ...(anthropicTools.length ? { tools: anthropicTools } : {}),
    ...(p.topP !== undefined ? { top_p: p.topP } : temperature !== undefined ? { temperature } : {}),
    ...(p.topK !== undefined ? { top_k: p.topK } : {}),
    ...(p.stopSequences?.length ? { stop_sequences: p.stopSequences } : {}),
  };
}

/** Claude on Amazon Bedrock through the Anthropic Messages API (InvokeModel). */
export class BedrockAnthropicLlm implements Llm {
  private readonly client: BedrockRuntimeClient;
  constructor(private readonly params: BedrockParams) { this.client = runtimeClient(params); }

  async converse(system: string, messages: Msg[], tools: ToolSpec[], options: LlmCallOptions = {}): Promise<LlmResponse> {
    const body = anthropicRequestBody(this.params, system, messages, tools, options);
    const res = await this.client.send(
      new InvokeModelCommand({ modelId: this.params.modelId, contentType: "application/json", accept: "application/json", body: JSON.stringify(body) }),
      callSignal(this.params),
    );
    const json = JSON.parse(new TextDecoder().decode(res.body)) as {
      content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    return {
      content: fromAnthropicContent(json.content ?? []),
      stopReason: json.stop_reason ?? "end_turn",
      usage: json.usage ? {
        inputTokens: json.usage.input_tokens ?? 0, outputTokens: json.usage.output_tokens ?? 0,
        cacheReadTokens: json.usage.cache_read_input_tokens, cacheWriteTokens: json.usage.cache_creation_input_tokens
      } : undefined,
    };
  }
}

/**
 * Deterministic stand-in for local demos and tests (no AWS credentials).
 * Speaks the Converse tool-use protocol with simple intent rules.
 */
export class MockLlm implements Llm {
  private seq = 0;

  async converse(system: string, messages: Msg[], tools: ToolSpec[], _options?: LlmCallOptions): Promise<LlmResponse> {
    const last = messages[messages.length - 1];
    const results = last.content.filter((b): b is Extract<Block, { toolResult: unknown }> => "toolResult" in b);
    if (results.length) {
      return { content: [{ text: results.map((r) => String(r.toolResult.content[0]?.json?.say ?? "")).join("\n\n") }], stopReason: "end_turn" };
    }
    if (tools.length === 0) return { content: [{ text: "" }], stopReason: "end_turn" };
    const userText = last.content.map((b) => ("text" in b ? b.text : "")).join(" ").trim();
    const t = userText.toLowerCase();
    const locale = system.includes("LOCALE: en") ? "en" : "vi";
    const use = (name: string, input: Record<string, unknown> = {}): LlmResponse => ({ content: [{ toolUse: { toolUseId: `mock-${++this.seq}`, name, input } }], stopReason: "tool_use" });

    const cert = userText.match(/OMS-[0-9A-F]{8}/i);
    if (cert) return use("verify_certificate", { code: cert[0].toUpperCase() });
    if (system.includes("ACTIVE_QUIZ: yes") && /^[a-d]\b/i.test(t)) return use("submit_answer", { answer: t.charAt(0).toUpperCase() });
    if (/đã học xong|học xong|hoàn thành bài|done|finished|completed/.test(t)) return use("complete_lesson");
    if (/giải thích|explain|ví dụ|example/.test(t)) return use("explain_lesson", { question: userText });
    if (/kiểm tra|\bthi\b|quiz|test|exam|chứng chỉ|certif/.test(t)) return use("start_assessment");
    if (/nhắc|nhac|remind/.test(t)) {
      if (/tắt|tat|off|cancel|hủy|huy|stop/.test(t)) return use("set_study_reminder", { time: "off" });
      const at = t.match(/([01]?\d|2[0-3])\s*[:h.]\s*([0-5]\d)?/) ?? t.match(/\b([01]?\d|2[0-3])\b/);
      if (at) return use("set_study_reminder", { time: `${at[1]}:${at[2] ?? "00"}` });
    }
    if (/email|mail|báo cáo|report/.test(t)) return use("send_progress_email");
    if (/khóa học|khoá học|course|đổi khóa/.test(t)) return use("get_my_learning");
    if (/tiến độ|progress/.test(t)) return use("get_my_learning");
    if (/học|bài|lesson|next|tiếp|ôn|study|learn|hoc/.test(t)) return use("get_next_lesson");
    if (/người thật|tư vấn|human|support/.test(t)) return { content: [{ text: tr(locale, "agent.human") }], stopReason: "end_turn" };
    return { content: [{ text: tr(locale, "agent.greeting") }], stopReason: "end_turn" };
  }
}
