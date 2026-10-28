import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import type { ExpertContext } from "../src/core/types";
import {
  createSkillDetailHandler,
  createSkillFrameworksHandler,
  createSkillImportDryRunHandler,
  createSkillImportCommitHandler,
  createSkillsCollectionHandlers,
  SkillHttpError,
  type SkillHandlerRuntime,
  type SkillRuntimeResolver
} from "../src/next/create-skill-handlers";
import { SkillDomainError } from "../src/skills/errors";

const context: ExpertContext = {
  userId: "user-a", expertId: "expert-a", membershipId: "membership-a",
  roles: ["expert_admin"], permissions: ["skill:read", "skill:create", "skill:update", "skill:review", "skill:publish"]
};

function application(overrides: Partial<SkillHandlerRuntime["service"]> = {}): SkillHandlerRuntime["service"] {
  return {
    list: async () => ({ items: [] }),
    listFrameworks: async () => [],
    get: async () => { throw new SkillDomainError("OUTSIDE_EXPERT"); },
    create: async () => { throw new Error("not implemented"); },
    importSkills: async () => { throw new Error("not implemented"); },
    update: async () => { throw new Error("not implemented"); },
    submitReview: async () => { throw new Error("not implemented"); },
    requestChanges: async () => { throw new Error("not implemented"); },
    publish: async () => { throw new Error("not implemented"); },
    nextDraft: async () => { throw new Error("not implemented"); },
    ...overrides
  } as SkillHandlerRuntime["service"];
}

function resolver(service: SkillHandlerRuntime["service"]): SkillRuntimeResolver {
  return async () => ({ service, context, tier: "free" });
}

async function withFeature<T>(run: () => Promise<T>) {
  const previous = process.env.DASHBOARD_SKILLS_ENABLED;
  const previousMutations = process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED;
  const previousCanaryExperts = process.env.DASHBOARD_SKILLS_CANARY_EXPERT_IDS;
  process.env.DASHBOARD_SKILLS_ENABLED = "true";
  process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED = "true";
  process.env.DASHBOARD_SKILLS_CANARY_EXPERT_IDS = "*";
  try { return await run(); }
  finally {
    if (previous === undefined) delete process.env.DASHBOARD_SKILLS_ENABLED;
    else process.env.DASHBOARD_SKILLS_ENABLED = previous;
    if (previousMutations === undefined) delete process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED;
    else process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED = previousMutations;
    if (previousCanaryExperts === undefined) delete process.env.DASHBOARD_SKILLS_CANARY_EXPERT_IDS;
    else process.env.DASHBOARD_SKILLS_CANARY_EXPERT_IDS = previousCanaryExperts;
  }
}

test("Skills list handler returns a stable page and request ID", async () => withFeature(async () => {
  const handlers = createSkillsCollectionHandlers(resolver(application({ list: async () => ({ items: [], cursor: undefined }) })));
  const response = await handlers.GET(new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/skills?expertId=expert-a"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
  assert.match(response.headers.get("x-request-id") ?? "", /^req_/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}));

test("Skill frameworks handler returns frameworks inside the resolved Expert context", async () => withFeature(async () => {
  const framework = {
    id: "framework-a", expertId: "expert-a", name: "OMS Skill Framework",
    currentVersionNumber: 1, version: 1, createdAt: "2026-07-20T00:00:00.000Z",
    createdBy: "user-a", updatedAt: "2026-07-20T00:00:00.000Z", updatedBy: "user-a"
  };
  const handler = createSkillFrameworksHandler(resolver(application({ listFrameworks: async () => [framework] })));
  const response = await handler(new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/skill-frameworks?expertId=expert-a"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { frameworks: [framework], capabilities: { mutations: true } });
}));

test("Skill import dry-run validates canonical input without committing", async () => withFeature(async () => {
  const framework = {
    id: "framework-a", expertId: "expert-a", name: "OMS", currentVersionNumber: 1, version: 1,
    createdAt: "2026-07-20T00:00:00.000Z", createdBy: "user-a", updatedAt: "2026-07-20T00:00:00.000Z", updatedBy: "user-a"
  };
  const handler = createSkillImportDryRunHandler(resolver(application({ listFrameworks: async () => [framework] })));
  const response = await handler(new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/skills/import/dry-run", {
    method: "POST", headers: { origin: "https://dashboard.openmatrixskill.com", "content-type": "application/json" },
    body: JSON.stringify({ expertId: "expert-a", manifest: { schemaVersion: 1, frameworkId: "framework-a", skills: [{
      code: "sys", name: "Systems Thinking", description: "Understand connected systems.", outcomes: ["Model feedback loops"], tags: ["systems"]
    }] } })
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "dry-run");
  assert.equal(body.preview.skills[0].code, "SYS");
}));

test("Skill import commit requires explicit confirmation and preserves replay status", async () => withFeature(async () => {
  const service = application({ importSkills: async () => ({ receipt: {
    expertId: "expert-a", idempotencyKey: "import:test:api", manifestHash: "hash", skillIds: ["skill-a"],
    skillCodes: ["SYS"], createdAt: "2026-07-20T00:00:00.000Z", createdBy: "user-a"
  }, replayed: false }) });
  const handler = createSkillImportCommitHandler(resolver(service));
  const request = (confirm: boolean) => new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/skills/import/commit", {
    method: "POST", headers: { origin: "https://dashboard.openmatrixskill.com", "content-type": "application/json" },
    body: JSON.stringify({ expertId: "expert-a", idempotencyKey: "import:test:api", manifest: {}, confirm })
  });
  assert.equal((await handler(request(false))).status, 422);
  assert.equal((await handler(request(true))).status, 201);
}));

test("Skills handlers map unauthenticated and cross-Expert access safely", async () => withFeature(async () => {
  const unauthenticated: SkillRuntimeResolver = async () => { throw new SkillHttpError("UNAUTHENTICATED", 401); };
  const list = createSkillsCollectionHandlers(unauthenticated);
  const unauthenticatedResponse = await list.GET(new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/skills?expertId=expert-a"));
  assert.equal(unauthenticatedResponse.status, 401);
  assert.equal((await unauthenticatedResponse.json()).error.code, "UNAUTHENTICATED");

  const detail = createSkillDetailHandler(resolver(application()));
  const outsideResponse = await detail(
    new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/skills/skill-a?expertId=expert-a"),
    { params: { skillId: "skill-from-expert-b" } }
  );
  assert.equal(outsideResponse.status, 404);
  assert.equal((await outsideResponse.json()).error.code, "OUTSIDE_EXPERT");
}));

test("Skills create maps transaction conflicts to 409 without leaking internals", async () => withFeature(async () => {
  const conflict = new Error("internal conditional details");
  conflict.name = "TransactionCanceledException";
  const handlers = createSkillsCollectionHandlers(resolver(application({ create: async () => { throw conflict; } })));
  const response = await handlers.POST(new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/skills", {
    method: "POST",
    headers: { origin: "https://dashboard.openmatrixskill.com", "content-type": "application/json" },
    body: JSON.stringify({
      expertId: "expert-a", frameworkId: "framework-a", code: "SYS",
      name: "Systems Thinking", description: "Understand systems.", outcomes: ["Model systems"], tags: [], ownerUserId: "user-a"
    })
  }));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "VERSION_CONFLICT");
  assert.ok(!JSON.stringify(body).includes("conditional details"));
}));
