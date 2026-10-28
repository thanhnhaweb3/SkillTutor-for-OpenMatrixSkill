import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent } from "../src/core/types";
import { InMemoryCourseRepository } from "../src/courses/memory-repository";
import type { Course, CourseVersion } from "../src/courses/types";

const now = "2026-07-22T00:00:00.000Z";
const course = (overrides: Partial<Course> = {}): Course => ({ id: "course-1", expertId: "expert-a", code: "SYS-101", slug: "systems-101",
  latestVersionId: "cv-1", latestVersionNumber: 1, latestStatus: "draft", latestTitle: "Systems 101", latestOwnerUserId: "author",
  version: 1, createdAt: now, createdBy: "author", updatedAt: now, updatedBy: "author", ...overrides });
const version = (overrides: Partial<CourseVersion> = {}): CourseVersion => ({ id: "cv-1", expertId: "expert-a", courseId: "course-1", versionNumber: 1,
  status: "draft", title: "Systems 101", description: "A practical systems course.", ownerUserId: "author",
  modules: [{ id: "m1", title: "Start", position: 1, lessons: [{ id: "l1", title: "Intro", summary: "Introduction lesson.", position: 1, estimatedMinutes: 10, outcomes: [] }] }],
  version: 1, createdAt: now, createdBy: "author", updatedAt: now, updatedBy: "author", ...overrides });
const audit = (action = "course:create"): AuditEvent => ({ eventId: `audit-${action}`, occurredAt: now, requestId: "req-1", actorUserId: "author",
  expertId: "expert-a", action, targetType: "course", targetId: "course-1", result: "allowed" });

test("atomic create enforces unique course code", async () => {
  const repo = new InMemoryCourseRepository();
  await repo.commitCreateCourse({ course: course(), version: version(), audit: audit() });
  await assert.rejects(repo.commitCreateCourse({ course: course({ id: "course-2", latestVersionId: "cv-2" }), version: version({ id: "cv-2", courseId: "course-2" }), audit: audit() }),
    (e: unknown) => e instanceof Error && e.name === "TransactionCanceledException");
  assert.equal(repo.audits.length, 1);
});

test("mutation uses optimistic concurrency and atomic audit", async () => {
  const repo = new InMemoryCourseRepository({ courses: [course()], versions: [version()] });
  await repo.commitVersionMutation({ previousCourse: course(), nextCourse: course({ latestStatus: "in_review", version: 2 }), previousVersion: version(),
    nextVersion: version({ status: "in_review", version: 2 }), audit: audit("course:submit_review") });
  await assert.rejects(repo.commitVersionMutation({ previousCourse: course(), nextCourse: course({ version: 2 }), previousVersion: version(), nextVersion: version({ version: 2 }), audit: audit("stale") }));
  assert.equal(repo.audits.length, 1);
});

test("next draft keeps published pointer/history and Expert isolation", async () => {
  const publishedCourse = course({ currentPublishedVersionId: "cv-1", latestStatus: "published", version: 2 });
  const publishedVersion = version({ status: "published", version: 2, publishedAt: now, publishedBy: "reviewer" });
  const repo = new InMemoryCourseRepository({ courses: [publishedCourse], versions: [publishedVersion] });
  await repo.commitCreateNextVersion({ previousCourse: publishedCourse,
    nextCourse: { ...publishedCourse, latestVersionId: "cv-2", latestVersionNumber: 2, latestStatus: "draft", version: 3 },
    version: version({ id: "cv-2", versionNumber: 2 }), audit: audit("course:create_next_version") });
  assert.equal((await repo.getCourse("expert-a", "course-1"))?.currentPublishedVersionId, "cv-1");
  assert.deepEqual((await repo.listCourseVersions({ expertId: "expert-a", courseId: "course-1", limit: 10 })).items.map((x) => x.versionNumber), [2, 1]);
  assert.equal(await repo.getCourse("expert-b", "course-1"), null);
  assert.equal((await repo.listCourses({ expertId: "expert-b", limit: 10 })).items.length, 0);
});
