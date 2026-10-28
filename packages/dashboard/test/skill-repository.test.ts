import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent } from "../src/core/types";
import { SkillDomainError } from "../src/skills/errors";
import { InMemorySkillRepository } from "../src/skills/memory-repository";
import {
  decodeCursor,
  encodeCursor,
  skillCodeLockKey,
  skillIndexKey,
  skillItem,
  skillVersionItem,
  skillVersionKey,
  toSkill,
  toSkillVersion
} from "../src/skills/serialization";
import type { Skill, SkillVersion } from "../src/skills/types";

const timestamp = "2026-07-20T00:00:00.000Z";

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-1",
    expertId: "expert-a",
    frameworkId: "framework-1",
    code: "SYSTEMS",
    slug: "systems-thinking",
    latestVersionId: "version-1",
    latestVersionNumber: 1,
    latestStatus: "draft",
    latestName: "Systems Thinking",
    latestOwnerUserId: "author",
    version: 1,
    createdAt: timestamp,
    createdBy: "author",
    updatedAt: timestamp,
    updatedBy: "author",
    ...overrides
  };
}

function version(overrides: Partial<SkillVersion> = {}): SkillVersion {
  return {
    id: "version-1",
    expertId: "expert-a",
    skillId: "skill-1",
    versionNumber: 1,
    status: "draft",
    name: "Systems Thinking",
    description: "Understand systems and feedback loops.",
    outcomes: ["Model a system boundary"],
    tags: ["systems"],
    ownerUserId: "author",
    version: 1,
    createdAt: timestamp,
    createdBy: "author",
    updatedAt: timestamp,
    updatedBy: "author",
    ...overrides
  };
}

function audit(action = "skill:create"): AuditEvent {
  return {
    eventId: `audit-${action}`,
    occurredAt: timestamp,
    requestId: "req-test",
    actorUserId: "author",
    expertId: "expert-a",
    action,
    targetType: "skill",
    targetId: "skill-1",
    result: "allowed"
  };
}

test("serializes stable Skill keys, GSI2 keys and zero-padded version keys", () => {
  assert.deepEqual(skillCodeLockKey("expert-a", "framework-1", "SYSTEMS"), {
    pk: "EXPERT#expert-a",
    sk: "SKILLCODE#framework-1#SYSTEMS"
  });
  assert.deepEqual(skillVersionKey("expert-a", "skill-1", 12), {
    pk: "EXPERT#expert-a",
    sk: "SKILL#skill-1#VERSION#0000000012"
  });
  assert.deepEqual(skillIndexKey(skill()), {
    gsi2pk: "EXPERT#expert-a#SKILLS",
    gsi2sk: "STATUS#draft#OWNER#author#NAME#systems thinking#SKILL#skill-1"
  });
});

test("round-trips valid records and default-denies malformed records", () => {
  const storedSkill = skillItem(skill());
  const storedVersion = skillVersionItem(version());
  assert.deepEqual(JSON.parse(JSON.stringify(toSkill(storedSkill))), skill());
  assert.deepEqual(JSON.parse(JSON.stringify(toSkillVersion(storedVersion))), version());
  assert.equal(toSkill({ ...storedSkill, latestStatus: "unknown" }), null);
  assert.equal(toSkillVersion({ ...storedVersion, outcomes: "not-an-array" }), null);
});

test("encodes opaque versioned cursors and rejects malformed cursors", () => {
  const key = { pk: "EXPERT#expert-a", sk: "SKILL#skill-1#META", gsi2pk: "EXPERT#expert-a#SKILLS" };
  assert.deepEqual(decodeCursor(encodeCursor(key)), key);
  assert.throws(
    () => decodeCursor(Buffer.from(JSON.stringify({ v: 2, key }), "utf8").toString("base64url")),
    (error: unknown) => error instanceof SkillDomainError && error.code === "VALIDATION_ERROR"
  );
});

test("atomically creates Skill, version and audit while enforcing unique code", async () => {
  const repository = new InMemorySkillRepository();
  await repository.commitCreateSkill({ skill: skill(), version: version(), audit: audit() });
  assert.deepEqual(await repository.getSkill("expert-a", "skill-1"), skill());
  assert.deepEqual(await repository.getSkillVersion("expert-a", "skill-1", 1), version());
  assert.equal(repository.audits.length, 1);

  await assert.rejects(
    repository.commitCreateSkill({
      skill: skill({ id: "skill-2", latestVersionId: "version-2" }),
      version: version({ id: "version-2", skillId: "skill-2" }),
      audit: audit()
    }),
    (error: unknown) => error instanceof Error && error.name === "TransactionCanceledException"
  );
  assert.equal(repository.audits.length, 1);
});

test("atomically seeds an immutable Framework v1 and audit", async () => {
  const repository = new InMemorySkillRepository();
  const framework = {
    id: "framework-1", expertId: "expert-a", name: "OMS Framework", currentVersionNumber: 1,
    version: 1, createdAt: timestamp, createdBy: "author", updatedAt: timestamp, updatedBy: "author"
  };
  const frameworkVersion = {
    id: "frameworkv-1", expertId: "expert-a", frameworkId: "framework-1", versionNumber: 1,
    name: "OMS Framework", description: "Versioned OMS proficiency framework.",
    proficiencyLevels: [
      { code: "L1", rank: 1, name: "Foundation", description: "Foundation proficiency." },
      { code: "L2", rank: 2, name: "Applied", description: "Applied proficiency." }
    ],
    publishedAt: timestamp, publishedBy: "author", createdAt: timestamp, createdBy: "author"
  };
  await repository.commitSeedFramework({ framework, version: frameworkVersion, audit: audit("skill_framework:seed_v1") });
  assert.deepEqual(await repository.getFramework("expert-a", "framework-1"), framework);
  assert.deepEqual(await repository.getFrameworkVersion("expert-a", "framework-1", 1), frameworkVersion);
  assert.equal(repository.audits.at(-1)?.action, "skill_framework:seed_v1");
  await assert.rejects(
    repository.commitSeedFramework({ framework, version: frameworkVersion, audit: audit("duplicate") }),
    (error: unknown) => error instanceof Error && error.name === "TransactionCanceledException"
  );
});

test("lists Skills with bounded cursor pagination and status/owner scope", async () => {
  const repository = new InMemorySkillRepository();
  const fixtures = [
    skill({ id: "skill-1", code: "A", latestName: "Alpha", latestVersionId: "version-1" }),
    skill({ id: "skill-2", code: "B", latestName: "Beta", latestVersionId: "version-2" }),
    skill({ id: "skill-3", code: "C", latestName: "Gamma", latestVersionId: "version-3", latestStatus: "published", latestOwnerUserId: "reviewer" })
  ];
  for (const [index, item] of fixtures.entries()) {
    await repository.commitCreateSkill({
      skill: item,
      version: version({ id: `version-${index + 1}`, skillId: item.id, status: item.latestStatus }),
      audit: audit(`skill:create:${index}`)
    });
  }
  const first = await repository.listSkills({ expertId: "expert-a", status: "draft", ownerUserId: "author", limit: 1 });
  const second = await repository.listSkills({ expertId: "expert-a", status: "draft", ownerUserId: "author", limit: 1, cursor: first.cursor });
  assert.deepEqual(first.items.map((item) => item.latestName), ["Alpha"]);
  assert.deepEqual(second.items.map((item) => item.latestName), ["Beta"]);
  assert.equal(second.cursor, undefined);
  await assert.rejects(
    repository.listSkills({ expertId: "expert-a", ownerUserId: "author", limit: 25 }),
    (error: unknown) => error instanceof SkillDomainError && error.code === "VALIDATION_ERROR"
  );
});

test("commits version transitions with optimistic concurrency and audit", async () => {
  const repository = new InMemorySkillRepository();
  await repository.commitCreateSkill({ skill: skill(), version: version(), audit: audit() });
  const nextVersion = version({ status: "in_review", version: 2, submittedAt: timestamp, submittedBy: "author" });
  const nextSkill = skill({ latestStatus: "in_review", version: 2 });
  await repository.commitVersionMutation({
    previousSkill: skill(),
    nextSkill,
    previousVersion: version(),
    nextVersion,
    audit: audit("skill:submit_review")
  });
  assert.equal((await repository.getSkill("expert-a", "skill-1"))?.latestStatus, "in_review");
  assert.equal(repository.audits.at(-1)?.action, "skill:submit_review");

  await assert.rejects(
    repository.commitVersionMutation({
      previousSkill: skill(),
      nextSkill,
      previousVersion: version(),
      nextVersion,
      audit: audit("skill:stale")
    }),
    (error: unknown) => error instanceof Error && error.name === "TransactionCanceledException"
  );
});

test("creates the next draft without overwriting published history", async () => {
  const publishedSkill = skill({
    currentPublishedVersionId: "version-1",
    latestStatus: "published",
    version: 2
  });
  const publishedVersion = version({ status: "published", version: 2, publishedAt: timestamp, publishedBy: "reviewer" });
  const repository = new InMemorySkillRepository({ skills: [publishedSkill], versions: [publishedVersion] });
  const nextVersion = version({ id: "version-2", versionNumber: 2 });
  const nextSkill = {
    ...publishedSkill,
    latestVersionId: nextVersion.id,
    latestVersionNumber: 2,
    latestStatus: "draft" as const,
    version: 3
  };
  await repository.commitCreateNextVersion({
    previousSkill: publishedSkill,
    nextSkill,
    version: nextVersion,
    audit: audit("skill:create_next_version")
  });
  assert.equal((await repository.getSkillVersion("expert-a", "skill-1", 1))?.status, "published");
  assert.equal((await repository.getSkillVersion("expert-a", "skill-1", 2))?.status, "draft");
  assert.deepEqual((await repository.listSkillVersions({ expertId: "expert-a", skillId: "skill-1", limit: 10 })).items.map((item) => item.versionNumber), [2, 1]);
});

test("never returns another Expert's Skill", async () => {
  const repository = new InMemorySkillRepository({ skills: [skill()], versions: [version()] });
  assert.equal(await repository.getSkill("expert-b", "skill-1"), null);
  assert.equal((await repository.listSkills({ expertId: "expert-b", limit: 25 })).items.length, 0);
});
