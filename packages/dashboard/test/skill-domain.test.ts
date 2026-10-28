import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRoles } from "../src/core/policy";
import type { ExpertContext, ExpertRole, Permission } from "../src/core/types";
import { SkillDomainError } from "../src/skills/errors";
import { freeSkillLimit, requireFreeSkillCapacity } from "../src/skills/quota";
import type { SkillVersion } from "../src/skills/types";
import { normalizeSkillCode, validateProficiencyLevels, validateSkillDraft } from "../src/skills/validation";
import { createNextDraft, publishVersion, requestChanges, submitForReview, updateDraft } from "../src/skills/workflow";

const now = "2026-07-20T00:00:00.000Z";

function context(userId: string, roles: ExpertRole[], permissions?: Permission[]): ExpertContext {
  return {
    userId,
    expertId: "expert-a",
    membershipId: `membership-${userId}`,
    roles,
    permissions: permissions ?? permissionsForRoles(roles)
  };
}

function draft(overrides: Partial<SkillVersion> = {}): SkillVersion {
  return {
    id: "skill-version-1",
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
    createdAt: now,
    createdBy: "author",
    updatedAt: now,
    updatedBy: "author",
    ...overrides
  };
}

test("RBAC v2 grants update/review according to the approved matrix", () => {
  assert.ok(permissionsForRoles(["expert_admin"]).includes("skill:update"));
  assert.ok(permissionsForRoles(["expert_admin"]).includes("skill:review"));
  assert.ok(permissionsForRoles(["curriculum_manager"]).includes("skill:update"));
  assert.ok(!permissionsForRoles(["curriculum_manager"]).includes("skill:review"));
  assert.ok(permissionsForRoles(["reviewer"]).includes("skill:review"));
  assert.ok(!permissionsForRoles(["reviewer"]).includes("skill:update"));
  assert.ok(permissionsForRoles(["instructor"]).includes("skill:update"));
  assert.ok(!permissionsForRoles(["learner"]).includes("skill:update"));
});

test("normalizes and validates canonical skill input", () => {
  assert.equal(normalizeSkillCode(" sys-thinking "), "SYS-THINKING");
  assert.deepEqual(validateSkillDraft({
    name: "  Systems Thinking  ",
    description: " Understand feedback loops. ",
    outcomes: [" Model a system boundary. "],
    tags: ["Systems", "systems", "AIoT"],
    ownerUserId: "author"
  }), {
    name: "Systems Thinking",
    description: "Understand feedback loops.",
    outcomes: ["Model a system boundary."],
    tags: ["systems", "AIoT"],
    ownerUserId: "author"
  });
});

test("rejects unsafe text and invalid proficiency scales", () => {
  assert.throws(() => validateSkillDraft({
    name: "Unsafe skill",
    description: "<script>alert(1)</script>",
    outcomes: ["Valid outcome"],
    tags: [],
    ownerUserId: "author"
  }), (error: unknown) => error instanceof SkillDomainError && error.code === "VALIDATION_ERROR");

  assert.throws(() => validateProficiencyLevels([
    { code: "L1", rank: 1, name: "Basic", description: "Basic level" },
    { code: "L2", rank: 1, name: "Advanced", description: "Advanced level" }
  ]), (error: unknown) => error instanceof SkillDomainError && error.code === "VALIDATION_ERROR");
});

test("orders a valid versioned proficiency scale", () => {
  const levels = validateProficiencyLevels([
    { code: "L2", rank: 2, name: "Advanced", description: "Advanced level" },
    { code: "L1", rank: 1, name: "Basic", description: "Basic level" }
  ]);
  assert.deepEqual(levels.map((level) => level.code), ["L1", "L2"]);
});

test("Free quota starts at 3 and grants 3 per achievement", () => {
  assert.equal(freeSkillLimit({ publishedSkillCount: 0, completedCourseCount: 0 }), 3);
  assert.equal(freeSkillLimit({ publishedSkillCount: 2, completedCourseCount: 1 }), 12);
  assert.deepEqual(requireFreeSkillCapacity({ createdSkillCount: 2, publishedSkillCount: 0, completedCourseCount: 0 }), {
    allowed: true,
    limit: 3,
    remainingAfterCreate: 0
  });
  assert.throws(
    () => requireFreeSkillCapacity({ createdSkillCount: 3, publishedSkillCount: 0, completedCourseCount: 0 }),
    (error: unknown) => error instanceof SkillDomainError && error.code === "QUOTA_EXCEEDED"
  );
});

test("updates an owned draft and rejects stale versions", () => {
  const author = context("author", ["instructor"]);
  const updated = updateDraft({
    context: author,
    current: draft(),
    expectedVersion: 1,
    content: {
      name: "Updated Skill",
      description: "Updated skill description.",
      outcomes: ["Apply the updated skill"],
      tags: ["updated"],
      ownerUserId: "author"
    },
    now
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.name, "Updated Skill");

  assert.throws(
    () => updateDraft({ context: author, current: draft(), expectedVersion: 9, content: updated, now }),
    (error: unknown) => error instanceof SkillDomainError && error.code === "VERSION_CONFLICT"
  );
});

test("enforces submit, request-changes and resubmit workflow", () => {
  const author = context("author", ["curriculum_manager"]);
  const reviewer = context("reviewer", ["reviewer"]);
  const submitted = submitForReview({ context: author, current: draft(), expectedVersion: 1, now });
  assert.equal(submitted.status, "in_review");
  const returned = requestChanges({ context: reviewer, current: submitted, expectedVersion: 2, note: "Add measurable outcomes", now });
  assert.equal(returned.status, "draft");
  assert.equal(returned.reviewDecision, "changes_requested");
  const resubmitted = submitForReview({ context: author, current: returned, expectedVersion: 3, now });
  assert.equal(resubmitted.status, "in_review");
  assert.equal(resubmitted.reviewDecision, undefined);
});

test("requires a different reviewer to publish", () => {
  const submitted = submitForReview({
    context: context("author", ["expert_admin"]),
    current: draft(),
    expectedVersion: 1,
    now
  });
  assert.throws(
    () => publishVersion({ context: context("author", ["expert_admin"]), current: submitted, expectedVersion: 2, now }),
    (error: unknown) => error instanceof SkillDomainError && error.code === "REVIEWER_REQUIRED"
  );
  const published = publishVersion({ context: context("reviewer", ["reviewer"]), current: submitted, expectedVersion: 2, now });
  assert.equal(published.status, "published");
  assert.equal(published.reviewDecision, "approved");
  assert.equal(published.publishedBy, "reviewer");
});

test("published versions are immutable and create a separate next draft", () => {
  const published = draft({ status: "published", publishedBy: "reviewer", publishedAt: now });
  assert.throws(
    () => updateDraft({
      context: context("author", ["expert_admin"]),
      current: published,
      expectedVersion: 1,
      content: published,
      now
    }),
    (error: unknown) => error instanceof SkillDomainError && error.code === "IMMUTABLE_PUBLISHED_VERSION"
  );
  const next = createNextDraft({ context: context("author", ["expert_admin"]), published, id: "skill-version-2", now });
  assert.equal(next.id, "skill-version-2");
  assert.equal(next.versionNumber, 2);
  assert.equal(next.status, "draft");
  assert.equal(next.publishedAt, undefined);
});

test("denies cross-Expert workflow operations", () => {
  const outside = { ...context("author", ["expert_admin"]), expertId: "expert-b" };
  assert.throws(
    () => submitForReview({ context: outside, current: draft(), expectedVersion: 1, now }),
    (error: unknown) => error instanceof SkillDomainError && error.code === "OUTSIDE_EXPERT"
  );
});
