import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRoles } from "../src/core/policy";
import type { ExpertContext, ExpertRole } from "../src/core/types";
import { CourseDomainError } from "../src/courses/errors";
import { FREE_COURSE_QUOTA, requireFreeCourseCapacity, requireFreePublishCapacity } from "../src/courses/quota";
import type { CourseVersion } from "../src/courses/types";
import { COURSE_LIMITS, normalizeCourseCode, validateCourseDraft } from "../src/courses/validation";
import { approveCourseVersion, createNextCourseDraft, publishCourseVersion, requestCourseChanges, submitCourseForReview, updateCourseDraft } from "../src/courses/workflow";

const now = "2026-07-22T00:00:00.000Z";
function context(userId: string, roles: ExpertRole[]): ExpertContext {
  return { userId, expertId: "expert-a", membershipId: `member-${userId}`, roles, permissions: permissionsForRoles(roles) };
}
function draft(overrides: Partial<CourseVersion> = {}): CourseVersion {
  return { id: "cv-1", expertId: "expert-a", courseId: "course-1", versionNumber: 1, status: "draft",
    title: "Systems Course", description: "Learn practical systems thinking.", ownerUserId: "author",
    modules: [{ id: "m1", title: "Foundations", position: 1, lessons: [{ id: "l1", title: "Boundaries",
      summary: "Learn to establish system boundaries.", position: 1, estimatedMinutes: 20,
      outcomes: [{ id: "o1", statement: "Model a system boundary", skillId: "skill-1", skillVersionId: "sv-1", targetProficiencyCode: "L1" }] }] }],
    version: 1, createdAt: now, createdBy: "author", updatedAt: now, updatedBy: "author", ...overrides };
}

test("permission v3 grants explicit course create and self-progress update", () => {
  assert.ok(permissionsForRoles(["curriculum_manager"]).includes("course:create"));
  assert.ok(!permissionsForRoles(["instructor"]).includes("course:create"));
  assert.ok(permissionsForRoles(["learner"]).includes("progress:update_self"));
  assert.ok(!permissionsForRoles(["auditor"]).includes("progress:update_self"));
});

test("validates course ordering and fixed bounds", () => {
  assert.equal(normalizeCourseCode(" sys-101 "), "SYS-101");
  assert.equal(COURSE_LIMITS.serializedBytes, 300_000);
  assert.equal(validateCourseDraft(draft()).title, "Systems Course");
  assert.throws(() => validateCourseDraft({ ...draft(), modules: [{ ...draft().modules[0], position: 2 }] }),
    (e: unknown) => e instanceof CourseDomainError && e.code === "VALIDATION_ERROR");
  assert.throws(() => validateCourseDraft({ ...draft(), modules: [{ ...draft().modules[0], lessons: [] }] }),
    (e: unknown) => e instanceof CourseDomainError && e.code === "VALIDATION_ERROR");
});

test("enforces approved free quotas", () => {
  assert.deepEqual(FREE_COURSE_QUOTA, { courses: 3, publishedCourses: 1, activeCohorts: 1 });
  assert.equal(requireFreeCourseCapacity({ courseCount: 2, publishedCourseCount: 0, activeCohortCount: 0 }).remainingAfterCreate, 0);
  assert.throws(() => requireFreeCourseCapacity({ courseCount: 3, publishedCourseCount: 0, activeCohortCount: 0 }),
    (e: unknown) => e instanceof CourseDomainError && e.code === "QUOTA_EXCEEDED");
  assert.throws(() => requireFreePublishCapacity({ courseCount: 2, publishedCourseCount: 1, activeCohortCount: 0 }, false),
    (e: unknown) => e instanceof CourseDomainError && e.code === "QUOTA_EXCEEDED");
});

test("runs separate review, approval and publish transitions", () => {
  const author = context("author", ["curriculum_manager"]), reviewer = context("reviewer", ["reviewer"]);
  const submitted = submitCourseForReview({ context: author, current: draft(), expectedVersion: 1, now });
  const returned = requestCourseChanges({ context: reviewer, current: submitted, expectedVersion: 2, note: "Clarify the first lesson", now });
  const updated = updateCourseDraft({ context: author, current: returned, expectedVersion: 3, content: returned, now });
  const resubmitted = submitCourseForReview({ context: author, current: updated, expectedVersion: 4, now });
  assert.throws(() => approveCourseVersion({ context: context("author", ["expert_admin"]), current: resubmitted, expectedVersion: 5, now }),
    (e: unknown) => e instanceof CourseDomainError && e.code === "REVIEWER_REQUIRED");
  const approved = approveCourseVersion({ context: reviewer, current: resubmitted, expectedVersion: 5, now });
  const published = publishCourseVersion({ context: reviewer, current: approved, expectedVersion: 6, now });
  assert.equal(published.status, "published");
  assert.equal(published.approvedBy, "reviewer");
});

test("published snapshot is immutable and next draft is independent", () => {
  const published = draft({ status: "published", version: 7, approvedBy: "reviewer", approvedAt: now, publishedBy: "reviewer", publishedAt: now });
  assert.throws(() => updateCourseDraft({ context: context("author", ["expert_admin"]), current: published, expectedVersion: 7, content: published, now }),
    (e: unknown) => e instanceof CourseDomainError && e.code === "IMMUTABLE_PUBLISHED_VERSION");
  const next = createNextCourseDraft({ context: context("author", ["expert_admin"]), published, id: "cv-2", now });
  next.modules[0].title = "Changed only in draft";
  assert.equal(published.modules[0].title, "Foundations");
  assert.equal(next.versionNumber, 2);
});

test("rejects stale and cross-Expert transitions", () => {
  assert.throws(() => submitCourseForReview({ context: context("author", ["curriculum_manager"]), current: draft(), expectedVersion: 9, now }),
    (e: unknown) => e instanceof CourseDomainError && e.code === "VERSION_CONFLICT");
  assert.throws(() => submitCourseForReview({ context: { ...context("author", ["curriculum_manager"]), expertId: "expert-b" }, current: draft(), expectedVersion: 1, now }),
    (e: unknown) => e instanceof CourseDomainError && e.code === "OUTSIDE_EXPERT");
});
