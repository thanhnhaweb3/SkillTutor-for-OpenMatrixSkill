import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRoles } from "../src/core/policy";
import type { ExpertContext, ExpertRole } from "../src/core/types";
import { CourseDomainError } from "../src/courses/errors";
import { InMemoryCourseRepository } from "../src/courses/memory-repository";
import { CourseService } from "../src/courses/service";
import type { Course, CourseVersion } from "../src/courses/types";
import { InMemorySkillRepository } from "../src/skills/memory-repository";
import type { Skill, SkillVersion } from "../src/skills/types";

const at = "2026-07-22T00:00:00.000Z";
const context = (userId: string, roles: ExpertRole[]): ExpertContext => ({ userId, expertId: "expert-a", membershipId: `m-${userId}`, roles, permissions: permissionsForRoles(roles) });
const content = { title: "Systems Course", description: "Learn systems thinking.", ownerUserId: "author", modules: [{ id: "m1", title: "Foundation", position: 1,
  lessons: [{ id: "l1", title: "Boundary", summary: "Model a useful boundary.", position: 1, estimatedMinutes: 20,
    outcomes: [{ id: "o1", statement: "Model system boundaries", skillId: "skill-1", skillVersionId: "sv-1", targetProficiencyCode: "L1" }] }] }] };
const dashboard = { getMembership: async (expertId: string, userId: string) => ({ id: `m-${userId}`, expertId, userId, status: "active", roles: [], tier: "free", createdAt: at, updatedAt: at, version: 1 }) } as never;
const skill: Skill = { id: "skill-1", expertId: "expert-a", frameworkId: "f1", code: "SYS", slug: "sys", currentPublishedVersionId: "sv-1", latestVersionId: "sv-1",
  latestVersionNumber: 1, latestStatus: "published", latestName: "Systems", latestOwnerUserId: "author", version: 1, createdAt: at, createdBy: "author", updatedAt: at, updatedBy: "author" };
const skillVersion: SkillVersion = { id: "sv-1", expertId: "expert-a", skillId: "skill-1", versionNumber: 1, status: "published", name: "Systems", description: "Systems skill.",
  outcomes: ["Model systems"], tags: [], ownerUserId: "author", publishedAt: at, publishedBy: "reviewer", version: 1, createdAt: at, createdBy: "author", updatedAt: at, updatedBy: "reviewer" };
const framework = { id: "f1", expertId: "expert-a", name: "Framework", currentVersionNumber: 1, version: 1, createdAt: at, createdBy: "author", updatedAt: at, updatedBy: "author" };
const frameworkVersion = { id: "fv1", expertId: "expert-a", frameworkId: "f1", versionNumber: 1, name: "Framework",
  proficiencyLevels: [{ code: "L1", rank: 1, name: "Foundation", description: "Foundation level." }, { code: "L2", rank: 2, name: "Applied", description: "Applied level." }], createdAt: at, createdBy: "author" };

test("creates a canonical course with active owner and Free quota", async () => {
  const repository = new InMemoryCourseRepository(); const app = new CourseService(repository, dashboard, new InMemorySkillRepository(), () => new Date(at), () => "1");
  const result = await app.create({ context: context("author", ["curriculum_manager"]), tier: "free", code: " sys-101 ", content, requestId: "req" });
  assert.equal(result.course.code, "SYS-101"); assert.equal(result.version.status, "draft"); assert.equal(repository.audits[0].action, "course:create");
});

test("runs approve/publish and pins only published SkillVersions", async () => {
  const repository = new InMemoryCourseRepository(); const app = new CourseService(repository, dashboard,
    new InMemorySkillRepository({ frameworks: [framework], frameworkVersions: [frameworkVersion], skills: [skill], versions: [skillVersion] }), () => new Date(at), (() => { let n = 0; return () => String(++n); })());
  const created = await app.create({ context: context("author", ["curriculum_manager"]), tier: "pro", code: "SYS-101", content, requestId: "r1" });
  const submitted = await app.submitReview({ context: context("author", ["curriculum_manager"]), courseId: created.course.id, versionNumber: 1, expectedVersion: 1, requestId: "r2" });
  const approved = await app.approve({ context: context("reviewer", ["reviewer"]), courseId: created.course.id, versionNumber: 1, expectedVersion: 2, requestId: "r3" });
  const published = await app.publish({ context: context("reviewer", ["reviewer"]), tier: "pro", courseId: created.course.id, versionNumber: 1, expectedVersion: 3, requestId: "r4" });
  assert.equal(published.course.currentPublishedVersionId, published.version.id); assert.equal(published.version.status, "published");
  assert.equal((await repository.listCoursesBySkill({ expertId: "expert-a", skillId: "skill-1", limit: 10 })).items.length, 1);
  assert.equal(submitted.version.status, "in_review"); assert.equal(approved.version.status, "approved");
});

test("publish rejects a draft SkillVersion mapping", async () => {
  const repository = new InMemoryCourseRepository(); const draftSkill = { ...skillVersion, status: "draft" as const, publishedAt: undefined, publishedBy: undefined };
  const app = new CourseService(repository, dashboard, new InMemorySkillRepository({ frameworks: [framework], frameworkVersions: [frameworkVersion], skills: [{ ...skill, latestStatus: "draft" }], versions: [draftSkill] }), () => new Date(at), () => "1");
  const course: Course = { id: "c1", expertId: "expert-a", code: "C1", slug: "c1", latestVersionId: "cv1", latestVersionNumber: 1, latestStatus: "approved", latestTitle: content.title,
    latestOwnerUserId: "author", version: 1, createdAt: at, createdBy: "author", updatedAt: at, updatedBy: "reviewer" };
  const version: CourseVersion = { id: "cv1", expertId: "expert-a", courseId: "c1", versionNumber: 1, status: "approved", ...content, approvedAt: at, approvedBy: "reviewer", version: 1,
    createdAt: at, createdBy: "author", updatedAt: at, updatedBy: "reviewer" };
  const seeded = new InMemoryCourseRepository({ courses: [course], versions: [version] }); const seededApp = new CourseService(seeded, dashboard,
    new InMemorySkillRepository({ frameworks: [framework], frameworkVersions: [frameworkVersion], skills: [{ ...skill, latestStatus: "draft" }], versions: [draftSkill] }), () => new Date(at), () => "1");
  await assert.rejects(seededApp.publish({ context: context("reviewer", ["reviewer"]), tier: "pro", courseId: "c1", versionNumber: 1, expectedVersion: 1, requestId: "r" }),
    (e: unknown) => e instanceof CourseDomainError && e.code === "VALIDATION_ERROR"); void app;
});

test("learner sees published snapshot and not a newer draft", async () => {
  const published = { id: "v1", expertId: "expert-a", courseId: "c1", versionNumber: 1, status: "published" as const, ...content, version: 2, createdAt: at, createdBy: "author", updatedAt: at, updatedBy: "reviewer" };
  const draft = { ...published, id: "v2", versionNumber: 2, status: "draft" as const, version: 1 };
  const course: Course = { id: "c1", expertId: "expert-a", code: "C1", slug: "c1", latestVersionId: "v2", latestVersionNumber: 2, latestStatus: "draft", latestTitle: content.title,
    latestOwnerUserId: "author", currentPublishedVersionId: "v1", version: 3, createdAt: at, createdBy: "author", updatedAt: at, updatedBy: "author" };
  const app = new CourseService(new InMemoryCourseRepository({ courses: [course], versions: [published, draft] }), dashboard, new InMemorySkillRepository());
  assert.equal((await app.get({ context: context("learner", ["learner"]), courseId: "c1" })).version.id, "v1");
});
