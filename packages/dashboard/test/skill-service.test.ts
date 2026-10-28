import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRoles } from "../src/core/policy";
import type { ExpertContext, ExpertMembership, ExpertRole } from "../src/core/types";
import { InMemoryDashboardRepository } from "../src/data/repositories";
import { SkillDomainError } from "../src/skills/errors";
import { InMemorySkillRepository } from "../src/skills/memory-repository";
import { SkillService } from "../src/skills/service";
import type { SkillFramework } from "../src/skills/types";

const now = "2026-07-20T00:00:00.000Z";
const framework: SkillFramework = {
  id: "framework-1", expertId: "expert-a", name: "OMS Framework", currentVersionNumber: 1, version: 1,
  createdAt: now, createdBy: "admin", updatedAt: now, updatedBy: "admin"
};

function membership(userId: string, roles: ExpertRole[]): ExpertMembership {
  return {
    id: `membership-${userId}`, expertId: "expert-a", userId, status: "active", roles, tier: "free",
    joinedAt: now, createdAt: now, updatedAt: now, version: 1
  };
}

function context(userId: string, roles: ExpertRole[]): ExpertContext {
  return { userId, expertId: "expert-a", membershipId: `membership-${userId}`, roles, permissions: permissionsForRoles(roles) };
}

function fixture() {
  const skillRepository = new InMemorySkillRepository({ frameworks: [framework] });
  const dashboardRepository = new InMemoryDashboardRepository({
    experts: [{ id: "expert-a", slug: "expert-a", displayName: "Expert A", status: "active", ownerUserId: "admin", level: 0, createdAt: now, updatedAt: now, version: 1 }],
    memberships: [membership("admin", ["expert_admin"]), membership("author", ["curriculum_manager"]), membership("reviewer", ["reviewer"]), membership("learner", ["learner"])]
  });
  let sequence = 0;
  const service = new SkillService(skillRepository, dashboardRepository, () => new Date(now), () => `id-${++sequence}`);
  return { service, skillRepository };
}

async function create() {
  const state = fixture();
  const result = await state.service.create({
    context: context("author", ["curriculum_manager"]), tier: "free", frameworkId: framework.id, code: "sys-1",
    content: { name: "Systems Thinking", description: "Understand systems and feedback loops.", outcomes: ["Model a system"], tags: ["systems"], ownerUserId: "author" },
    requestId: "req-create"
  });
  return { ...state, ...result };
}

test("creates a validated Skill v1 with server-owned identity and atomic audit", async () => {
  const { skillRepository, skill, version } = await create();
  assert.match(skill.id, /^skill_id-/);
  assert.equal(skill.code, "SYS-1");
  assert.equal(skill.latestStatus, "draft");
  assert.equal(version.createdBy, "author");
  assert.equal(skillRepository.audits[0]?.action, "skill:create");
  assert.ok(skillRepository.audits[0]?.afterHash);
});

test("enforces active owner, framework scope and Free quota", async () => {
  const { service } = fixture();
  await assert.rejects(service.create({
    context: context("admin", ["expert_admin"]), tier: "free", frameworkId: framework.id, code: "INVALID-OWNER",
    content: { name: "Invalid owner", description: "Owner is not a member.", outcomes: ["Validate ownership"], tags: [], ownerUserId: "outsider" }, requestId: "req-owner"
  }), (error: unknown) => error instanceof SkillDomainError && error.code === "VALIDATION_ERROR");

  for (let index = 0; index < 3; index += 1) {
    await service.create({
      context: context("admin", ["expert_admin"]), tier: "free", frameworkId: framework.id, code: `SKILL-${index}`,
      content: { name: `Skill ${index}`, description: "Valid skill description.", outcomes: ["Valid outcome"], tags: [], ownerUserId: "author" }, requestId: `req-${index}`
    });
  }
  await assert.rejects(service.create({
    context: context("admin", ["expert_admin"]), tier: "free", frameworkId: framework.id, code: "SKILL-4",
    content: { name: "Skill Four", description: "Valid skill description.", outcomes: ["Valid outcome"], tags: [], ownerUserId: "author" }, requestId: "req-4"
  }), (error: unknown) => error instanceof SkillDomainError && error.code === "QUOTA_EXCEEDED");
});

test("runs create, review, publish and next-version workflow through repositories", async () => {
  const { service, skillRepository, skill, version } = await create();
  const submitted = await service.submitReview({ context: context("author", ["curriculum_manager"]), skillId: skill.id, versionNumber: 1, expectedVersion: version.version, requestId: "req-submit" });
  const published = await service.publish({ context: context("reviewer", ["reviewer"]), skillId: skill.id, versionNumber: 1, expectedVersion: submitted.version.version, requestId: "req-publish" });
  assert.equal(published.version.status, "published");
  assert.equal(published.skill.currentPublishedVersionId, version.id);
  const next = await service.nextDraft({ context: context("admin", ["expert_admin"]), skillId: skill.id, requestId: "req-next" });
  assert.equal(next.version.versionNumber, 2);
  assert.equal((await skillRepository.getSkillVersion("expert-a", skill.id, 1))?.status, "published");
  assert.deepEqual(skillRepository.audits.map((item) => item.action), ["skill:create", "skill:submit_review", "skill:publish", "skill:create_next_version"]);
});

test("limits learner reads to published content", async () => {
  const { service, skill } = await create();
  await assert.rejects(
    service.get({ context: context("learner", ["learner"]), skillId: skill.id }),
    (error: unknown) => error instanceof SkillDomainError && error.code === "OUTSIDE_EXPERT"
  );
  const listed = await service.list({ context: context("learner", ["learner"]), query: { limit: 25 } });
  assert.equal(listed.items.length, 0);
});

test("imports a manifest atomically and replays the same idempotency key", async () => {
  const { service, skillRepository } = fixture();
  const input = { context: context("admin", ["expert_admin"]), tier: "free" as const, idempotencyKey: "import:test:0001", requestId: "req-import",
    manifest: { schemaVersion: 1, frameworkId: framework.id, skills: [
      { code: "SYS", name: "Systems Thinking", description: "Understand connected systems.", outcomes: ["Model systems"], tags: ["systems"] },
      { code: "DEC", name: "Decision Making", description: "Make evidence-based decisions.", outcomes: ["Compare options"], tags: ["decision"] }
    ] } };
  const first = await service.importSkills(input);
  const replay = await service.importSkills({ ...input, requestId: "req-replay" });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.receipt.skillIds, first.receipt.skillIds);
  assert.equal((await skillRepository.listSkills({ expertId: "expert-a", limit: 25 })).items.length, 2);
  assert.equal(skillRepository.audits.filter((item) => item.action === "skill:import").length, 1);
});

test("rejects reuse of an import idempotency key with different content", async () => {
  const { service } = fixture();
  const common = { context: context("admin", ["expert_admin"]), tier: "free" as const, idempotencyKey: "import:test:0002", requestId: "req-import" };
  await service.importSkills({ ...common, manifest: { schemaVersion: 1, frameworkId: framework.id, skills: [
    { code: "SYS", name: "Systems Thinking", description: "Understand connected systems.", outcomes: ["Model systems"], tags: [] }
  ] } });
  await assert.rejects(service.importSkills({ ...common, manifest: { schemaVersion: 1, frameworkId: framework.id, skills: [
    { code: "DEC", name: "Decision Making", description: "Make evidence-based decisions.", outcomes: ["Compare options"], tags: [] }
  ] } }), (error: unknown) => error instanceof SkillDomainError && error.code === "VERSION_CONFLICT");
});
