import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRoles } from "../src/core/policy";
import type { ExpertContext, ExpertRole } from "../src/core/types";
import { InMemoryCourseRepository } from "../src/courses/memory-repository";
import type { Course, CourseVersion } from "../src/courses/types";
import { DeliveryDomainError } from "../src/delivery/errors";
import { InMemoryDeliveryRepository } from "../src/delivery/memory-repository";
import { DeliveryService } from "../src/delivery/service";
import { validateCohortInput } from "../src/delivery/validation";

const now = "2026-07-22T00:00:00.000Z";
const context = (userId: string, roles: ExpertRole[]): ExpertContext => ({ userId, expertId: "expert-a", membershipId: `m-${userId}`, roles, permissions: permissionsForRoles(roles) });
const course: Course = { id: "course-1", expertId: "expert-a", code: "C1", slug: "c1", latestVersionId: "cv-1", latestVersionNumber: 1,
  latestStatus: "published", latestTitle: "Course", latestOwnerUserId: "author", currentPublishedVersionId: "cv-1", version: 1, createdAt: now, createdBy: "author", updatedAt: now, updatedBy: "reviewer" };
const version: CourseVersion = { id: "cv-1", expertId: "expert-a", courseId: "course-1", versionNumber: 1, status: "published", title: "Course",
  description: "Published course.", ownerUserId: "author", modules: [{ id: "m1", title: "Module", position: 1, lessons: [
    { id: "lesson-1", title: "One", summary: "First lesson.", position: 1, estimatedMinutes: 10, outcomes: [] },
    { id: "lesson-2", title: "Two", summary: "Second lesson.", position: 2, estimatedMinutes: 10, outcomes: [] }] }],
  publishedAt: now, publishedBy: "reviewer", version: 1, createdAt: now, createdBy: "author", updatedAt: now, updatedBy: "reviewer" };
const dashboard = { getMembership: async (expertId: string, userId: string) => userId === "inactive" ? null : ({ id: `m-${userId}`, expertId, userId,
  status: "active", roles: ["learner"], tier: "free", createdAt: now, updatedAt: now, version: 1 }) } as never;
function setup() { const delivery = new InMemoryDeliveryRepository(); const courses = new InMemoryCourseRepository({ courses: [course], versions: [version] });
  return { delivery, service: new DeliveryService(delivery, courses, dashboard, () => new Date(now), (() => { let n = 0; return () => String(++n); })()) }; }

test("validates cohort date bounds", () => {
  assert.deepEqual(validateCohortInput({ name: "July cohort", startDate: "2026-07-01", endDate: "2026-07-31" }), { name: "July cohort", startDate: "2026-07-01", endDate: "2026-07-31" });
  assert.throws(() => validateCohortInput({ name: "Bad", startDate: "2026-08-01", endDate: "2026-07-01" }), (e: unknown) => e instanceof DeliveryDomainError && e.code === "VALIDATION_ERROR");
});

test("cohort pins the current published CourseVersion and enforces Free active quota", async () => {
  const { service } = setup(); const admin = context("admin", ["expert_admin"]);
  const cohort = await service.createCohort({ context: admin, tier: "free", courseId: "course-1", courseVersionNumber: 1, name: "July cohort", startDate: "2026-07-01", requestId: "r1" });
  assert.equal(cohort.courseVersionId, "cv-1"); assert.equal(cohort.status, "active");
  await assert.rejects(service.createCohort({ context: admin, tier: "free", courseId: "course-1", courseVersionNumber: 1, name: "Second cohort", startDate: "2026-08-01", requestId: "r2" }),
    (e: unknown) => e instanceof DeliveryDomainError && e.code === "QUOTA_EXCEEDED");
});

test("enrollment stores canonical AcUser.id and prevents duplicates", async () => {
  const { service } = setup(), admin = context("admin", ["expert_admin"]); const cohort = await service.createCohort({ context: admin, tier: "pro", courseId: "course-1", courseVersionNumber: 1, name: "Cohort", startDate: "2026-07-01", requestId: "r1" });
  const result = await service.enroll({ context: admin, cohortId: cohort.id, userId: "learner-a", requestId: "r2" });
  assert.equal(result.enrollment.userId, "learner-a"); assert.equal(result.progress.requiredLessonCount, 2);
  await assert.rejects(service.enroll({ context: admin, cohortId: cohort.id, userId: "learner-a", requestId: "r3" }), (e: unknown) => e instanceof Error && e.name === "TransactionCanceledException");
});

test("self progress is monotonic, duplicate-safe and server-derives completion", async () => {
  const { service, delivery } = setup(), admin = context("admin", ["expert_admin"]), learner = context("learner-a", ["learner"]);
  const cohort = await service.createCohort({ context: admin, tier: "pro", courseId: "course-1", courseVersionNumber: 1, name: "Cohort", startDate: "2026-07-01", requestId: "r1" });
  await service.enroll({ context: admin, cohortId: cohort.id, userId: learner.userId, requestId: "r2" });
  const first = await service.completeLesson({ context: learner, cohortId: cohort.id, lessonId: "lesson-1", requestId: "r3" });
  const replay = await service.completeLesson({ context: learner, cohortId: cohort.id, lessonId: "lesson-1", requestId: "r4" });
  const done = await service.completeLesson({ context: learner, cohortId: cohort.id, lessonId: "lesson-2", requestId: "r5" });
  const completedReplay = await service.completeLesson({ context: learner, cohortId: cohort.id, lessonId: "lesson-2", requestId: "r6" });
  assert.equal(first.progress.percentComplete, 50); assert.equal(replay.replayed, true); assert.equal(done.progress.percentComplete, 100); assert.equal(done.progress.courseCompletedAt, now);
  assert.equal(completedReplay.replayed, true); assert.equal(completedReplay.progress.version, done.progress.version);
  assert.equal(delivery.audits.filter((x) => x.action.startsWith("progress:")).length, 2);
});

test("learner cannot read or write another user's progress or another Expert", async () => {
  const { service } = setup(), admin = context("admin", ["expert_admin"]); const cohort = await service.createCohort({ context: admin, tier: "pro", courseId: "course-1", courseVersionNumber: 1, name: "Cohort", startDate: "2026-07-01", requestId: "r1" });
  await service.enroll({ context: admin, cohortId: cohort.id, userId: "learner-a", requestId: "r2" });
  await assert.rejects(service.getSelfProgress({ context: context("learner-b", ["learner"]), cohortId: cohort.id }), (e: unknown) => e instanceof DeliveryDomainError && e.code === "OUTSIDE_EXPERT");
  await assert.rejects(service.getSelfProgress({ context: { ...context("learner-a", ["learner"]), expertId: "expert-b" }, cohortId: cohort.id }), (e: unknown) => e instanceof DeliveryDomainError && e.code === "OUTSIDE_EXPERT");
});
