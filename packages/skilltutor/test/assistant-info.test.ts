import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { loadSkillTutorConfig } from "../src/config";
import { claudeModelLabel, createAssistantInfoHandler } from "../src/next/catalog";
import type { SkillTutorRuntime } from "../src/runtime";

test("claudeModelLabel reads Bedrock Anthropic model ids", () => {
  assert.equal(claudeModelLabel("us.anthropic.claude-haiku-4-5-20251001-v1:0"), "Haiku 4.5");
  assert.equal(claudeModelLabel("global.anthropic.claude-sonnet-4-5-20250929-v1:0"), "Sonnet 4.5");
  assert.equal(claudeModelLabel("anthropic.claude-opus-4-1-20250805-v1:0"), "Opus 4.1");
  assert.equal(claudeModelLabel("anthropic.claude-sonnet-4-20250514-v1:0"), "Sonnet 4");
  assert.equal(claudeModelLabel("anthropic.claude-3-5-sonnet-20240620-v1:0"), "Sonnet 3.5");
  assert.equal(claudeModelLabel("arn:aws:bedrock:ap-southeast-2:1:inference-profile/custom"), "Claude");
});

test("assistant info is public and reveals only engine + model label", async () => {
  const base = { ...loadSkillTutorConfig(), enabled: true };
  const call = async (config: typeof base) =>
    (await createAssistantInfoHandler(async () => ({ config }) as unknown as SkillTutorRuntime)(new NextRequest("http://localhost:3000/api/skilltutor/assistant"))).json();
  assert.deepEqual(await call({ ...base, llmMode: "bedrock", bedrockModelId: "global.anthropic.claude-haiku-4-5-20251001-v1:0" }),
    { enabled: true, engine: "bedrock", model: "Haiku 4.5" });
  assert.deepEqual(await call({ ...base, llmMode: "mock" }), { enabled: true, engine: "mock", model: null });
  assert.equal((await call({ ...base, enabled: false })).enabled, false);
});
