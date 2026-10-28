import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { requireSkillsFeature, requireSkillsMutationFeature, skillsMutationsEnabledFor, validateSkillMutationRequest } from "../src/next/create-skill-handlers";
import { FixedWindowSkillRateLimiter } from "../src/next/skill-rate-limit";

test("Skills feature is default-off", () => {
  const previous = process.env.DASHBOARD_SKILLS_ENABLED;
  delete process.env.DASHBOARD_SKILLS_ENABLED;
  try {
    assert.throws(() => requireSkillsFeature(), (error: unknown) => error instanceof Error && error.message === "SKILLS_DISABLED");
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_SKILLS_ENABLED;
    else process.env.DASHBOARD_SKILLS_ENABLED = previous;
  }
});

test("Skills mutations have an independent default-off kill switch", () => {
  const previous = process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED;
  delete process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED;
  try {
    assert.throws(() => requireSkillsMutationFeature("expert-a"), (error: unknown) => error instanceof Error && error.message === "SKILL_MUTATIONS_DISABLED");
  } finally {
    if (previous === undefined) delete process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED;
    else process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED = previous;
  }
});

test("Skills mutation canary allowlist scopes a globally enabled flag", () => {
  const previousEnabled = process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED;
  const previousAllowlist = process.env.DASHBOARD_SKILLS_CANARY_EXPERT_IDS;
  process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED = "true";
  process.env.DASHBOARD_SKILLS_CANARY_EXPERT_IDS = "expert-a";
  try {
    assert.equal(skillsMutationsEnabledFor("expert-a"), true);
    assert.equal(skillsMutationsEnabledFor("expert-b"), false);
  } finally {
    if (previousEnabled === undefined) delete process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED; else process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED = previousEnabled;
    if (previousAllowlist === undefined) delete process.env.DASHBOARD_SKILLS_CANARY_EXPERT_IDS; else process.env.DASHBOARD_SKILLS_CANARY_EXPERT_IDS = previousAllowlist;
  }
});

test("mutation request requires exact origin and JSON content type", () => {
  const valid = new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/skills", {
    method: "POST",
    headers: { origin: "https://dashboard.openmatrixskill.com", "content-type": "application/json; charset=utf-8" }
  });
  assert.doesNotThrow(() => validateSkillMutationRequest(valid, "https://dashboard.openmatrixskill.com"));

  const badOrigin = new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/skills", {
    method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }
  });
  assert.throws(() => validateSkillMutationRequest(badOrigin, "https://dashboard.openmatrixskill.com"));

  const badType = new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/skills", {
    method: "POST", headers: { origin: "https://dashboard.openmatrixskill.com", "content-type": "text/plain" }
  });
  assert.throws(() => validateSkillMutationRequest(badType, "https://dashboard.openmatrixskill.com"));
});

test("fixed-window limiter rejects bursts and resets after the window", () => {
  let currentTime = 1_000;
  const limiter = new FixedWindowSkillRateLimiter(2, 60_000, () => currentTime);
  assert.equal(limiter.take("user:expert").allowed, true);
  assert.equal(limiter.take("user:expert").allowed, true);
  const denied = limiter.take("user:expert");
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  currentTime += 60_000;
  assert.equal(limiter.take("user:expert").allowed, true);
});
