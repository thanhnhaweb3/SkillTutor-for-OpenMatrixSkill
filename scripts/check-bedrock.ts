/**
 * Calls Claude on Amazon Bedrock once with the SKILLTUTOR_BEDROCK_* settings from .env
 * (plain reply + one tool-use round trip). Prints model, API, latency and token usage – never credentials.
 *
 *   npm run check:bedrock
 */
import { anthropicRequestBody, type Msg } from "../packages/skilltutor/src/agent/llm";
import type { ToolSpec } from "../packages/skilltutor/src/agent/tools";
import { loadSkillTutorConfig } from "../packages/skilltutor/src/config";
import { bedrockParams, createLlm } from "../packages/skilltutor/src/runtime";

const config = { ...loadSkillTutorConfig(), llmMode: "bedrock" as const };
const p = bedrockParams(config);
const keyId = process.env.AWS_ACCESS_KEY_ID ?? "";

console.log("SkillTutor → Claude on Amazon Bedrock");
console.log(`  API          ${config.bedrock.api === "converse" ? "Converse" : "Anthropic Messages (InvokeModel)"}`);
console.log(`  region       ${p.region}`);
console.log(`  model        ${p.modelId}`);
console.log(`  max_tokens   ${p.maxTokens}   ${p.topP !== undefined ? `top_p ${p.topP}` : `temperature ${p.temperature}`}${p.topK !== undefined ? `   top_k ${p.topK}` : ""}`);
console.log(`  timeout      ${p.timeoutMs} ms, ${p.maxAttempts} attempts, prompt cache ${p.promptCache ? "on" : "off"}`);
console.log(`  credentials  ${keyId ? `${keyId.slice(0, 4)}… (${keyId.startsWith("ASIA") ? "temporary – needs AWS_SESSION_TOKEN" : "long-term"})` : "default AWS chain (no AWS_ACCESS_KEY_ID in env)"}`);
console.log(`  LLM mode     SKILLTUTOR_LLM_MODE=${process.env.SKILLTUTOR_LLM_MODE ?? "(unset → mock)"}${process.env.SKILLTUTOR_LLM_MODE === "bedrock" ? "" : "  ⚠ the app stays on mock replies until this is bedrock"}`);

const tool: ToolSpec = {
  name: "get_time_of_day",
  description: "Returns the learner's local time of day.",
  inputSchema: { type: "object", properties: {}, required: [] }
} as ToolSpec;

if (process.argv.includes("--print-body")) {
  console.log(JSON.stringify(anthropicRequestBody(p, "You are SkillTutor.", [{ role: "user", content: [{ text: "ping" }] }], [tool]), null, 2));
}

const hints: Record<string, string> = {
  AccessDeniedException: "IAM user lacks bedrock:InvokeModel on this model/inference profile, or model access is not enabled (Bedrock console → Model access).",
  ResourceNotFoundException: "Model access not granted yet, or the Anthropic use-case form is not submitted for this account.",
  ValidationException: "Check SKILLTUTOR_BEDROCK_MODEL_ID (use the inference profile ID, e.g. global.anthropic.claude-haiku-4-5-20251001-v1:0) and the parameters (Claude 4.5 rejects temperature together with top_p).",
  UnrecognizedClientException: "AWS_ACCESS_KEY_ID is wrong or deleted.",
  ExpiredTokenException: "Temporary credentials expired – remove AWS_SESSION_TOKEN and use a long-term AKIA… key.",
  ThrottlingException: "Quota reached – retry later or request a higher tokens-per-minute quota.",
  TimeoutError: "No answer within SKILLTUTOR_BEDROCK_TIMEOUT_MS.",
  CredentialsProviderError: "No AWS credentials: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env (see docs/huong-dan-lay-aws-access-key.md)."
};

async function main() {
  const llm = createLlm(config);
  let t0 = Date.now();
  const plain = await llm.converse("You are SkillTutor, a friendly learning assistant. Answer in one short sentence.",
    [{ role: "user", content: [{ text: "Say hello to a new learner in Vietnamese." }] }], []);
  const text = plain.content.map((b) => ("text" in b ? b.text : "")).join("").trim();
  console.log(`\n✓ reply in ${Date.now() - t0} ms (stop: ${plain.stopReason}, tokens in/out: ${plain.usage?.inputTokens ?? "?"}/${plain.usage?.outputTokens ?? "?"})`);
  console.log(`  “${text.slice(0, 200)}”`);

  t0 = Date.now();
  const messages: Msg[] = [{ role: "user", content: [{ text: "What time of day is it for me? Use the tool." }] }];
  const first = await llm.converse("You are SkillTutor. Use tools when they help.", messages, [tool]);
  const use = first.content.find((b): b is Extract<typeof b, { toolUse: unknown }> => "toolUse" in b);
  if (!use) { console.log(`⚠ tool use: model answered without calling the tool (stop: ${first.stopReason})`); return; }
  messages.push({ role: "assistant", content: first.content },
    { role: "user", content: [{ toolResult: { toolUseId: use.toolUse.toolUseId, content: [{ json: { timeOfDay: "evening" } }], status: "success" } }] });
  const second = await llm.converse("You are SkillTutor. Use tools when they help.", messages, [tool]);
  console.log(`✓ tool use round trip in ${Date.now() - t0} ms → “${second.content.map((b) => ("text" in b ? b.text : "")).join("").trim().slice(0, 160)}”`);
  console.log("\nBedrock is ready. Set SKILLTUTOR_LLM_MODE=bedrock (and the same SKILLTUTOR_BEDROCK_* values) on Vercel, then redeploy.");
}

main().catch((error: Error & { name?: string; $metadata?: { httpStatusCode?: number } }) => {
  console.error(`\n✗ ${error.name ?? "Error"}${error.$metadata?.httpStatusCode ? ` (HTTP ${error.$metadata.httpStatusCode})` : ""}: ${error.message}`);
  const msg = error.message ?? "";
  const hint = /use case details/i.test(msg)
    ? "One-time Anthropic form: Bedrock console (region of this call) → Model catalog → Claude Haiku 4.5 → \"Submit use case details\". Wait ~15 min, then rerun."
    : /aws-marketplace/i.test(msg)
      ? "First use of an Anthropic model subscribes the account via AWS Marketplace. Send one message to Claude Haiku 4.5 in the Bedrock Playground as an admin (once per account), or give this IAM user aws-marketplace:ViewSubscriptions + aws-marketplace:Subscribe. Wait ~5 min, then rerun."
    : /being verified/i.test(msg)
      ? "New AWS account still being verified by AWS (usually < 2 h). Nothing to fix in the app – rerun later; if it lasts > 2 h, email aws-verification@amazon.com."
      : hints[error.name ?? ""];
  if (hint) console.error(`  → ${hint}`);
  process.exit(1);
});
