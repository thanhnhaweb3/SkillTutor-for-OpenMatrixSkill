import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent } from "../src/core/types";
import { DynamoDbCourseRepository } from "../src/courses/dynamodb-repository";
import { CourseDomainError } from "../src/courses/errors";
import { courseCodeLockKey, courseIndexKey, courseItem, courseSkillMapItem, courseVersionItem, courseVersionKey,
  decodeCourseCursor, encodeCourseCursor, toCourse, toCourseVersion } from "../src/courses/serialization";
import type { Course, CourseVersion } from "../src/courses/types";

const now = "2026-07-22T00:00:00.000Z";
const course = (overrides: Partial<Course> = {}): Course => ({ id: "course-1", expertId: "expert-a", code: "SYS-101", slug: "systems-101",
  latestVersionId: "cv-1", latestVersionNumber: 1, latestStatus: "draft", latestTitle: "Systems 101", latestOwnerUserId: "author",
  version: 1, createdAt: now, createdBy: "author", updatedAt: now, updatedBy: "author", ...overrides });
const version = (overrides: Partial<CourseVersion> = {}): CourseVersion => ({ id: "cv-1", expertId: "expert-a", courseId: "course-1", versionNumber: 1,
  status: "draft", title: "Systems 101", description: "Practical systems thinking.", ownerUserId: "author",
  modules: [{ id: "m1", title: "Start", position: 1, lessons: [{ id: "l1", title: "Intro", summary: "Introduction lesson.", position: 1, estimatedMinutes: 10,
    outcomes: [{ id: "o1", statement: "Model boundaries", skillId: "skill-1", skillVersionId: "sv-1", targetProficiencyCode: "L1" }] }] }],
  version: 1, createdAt: now, createdBy: "author", updatedAt: now, updatedBy: "author", ...overrides });
const audit: AuditEvent = { eventId: "audit-1", occurredAt: now, requestId: "req-1", actorUserId: "author", expertId: "expert-a",
  action: "course:create", targetType: "course", targetId: "course-1", result: "allowed" };

test("serializes stable course, version, code-lock and isolated GSI2 keys", () => {
  assert.deepEqual(courseCodeLockKey("expert-a", "SYS-101"), { pk: "EXPERT#expert-a", sk: "COURSECODE#SYS-101" });
  assert.deepEqual(courseVersionKey("expert-a", "course-1", 12), { pk: "EXPERT#expert-a", sk: "COURSE#course-1#VERSION#0000000012" });
  assert.deepEqual(courseIndexKey(course()), { gsi2pk: "EXPERT#expert-a#COURSES", gsi2sk: "STATUS#draft#OWNER#author#TITLE#systems 101#COURSE#course-1" });
  const map = courseSkillMapItem({ expertId: "expert-a", courseId: "course-1", skillId: "skill-1", skillVersionId: "sv-1",
    targetProficiencyCode: "L1", createdAt: now, createdBy: "author" }, 1);
  assert.equal(map.gsi2pk, "EXPERT#expert-a#COURSES_BY_SKILL#skill-1");
});

test("round-trips records and default-denies malformed nested content", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(toCourse(courseItem(course())))), course());
  assert.deepEqual(JSON.parse(JSON.stringify(toCourseVersion(courseVersionItem(version())))), version());
  assert.equal(toCourse({ ...courseItem(course()), latestStatus: "unsafe" }), null);
  const malformed = courseVersionItem(version());
  (malformed as Record<string, unknown>).modules = [{ ...malformed.modules[0], lessons: [{ ...malformed.modules[0].lessons[0], outcomes: [{ skillId: "missing fields" }] }] }];
  assert.equal(toCourseVersion(malformed), null);
  const cursor = encodeCourseCursor({ pk: "EXPERT#expert-a", sk: "COURSE#1#META" });
  assert.deepEqual(decodeCourseCursor(cursor), { pk: "EXPERT#expert-a", sk: "COURSE#1#META" });
  assert.throws(() => decodeCourseCursor("not-json"), (e: unknown) => e instanceof CourseDomainError && e.code === "VALIDATION_ERROR");
});

test("AP-03/AP-04/AP-05 issue Get/Query/BatchGet and never Scan", async () => {
  const commands: unknown[] = [];
  const client = { send: async (command: unknown) => { commands.push(command); const name = (command as { constructor: { name: string } }).constructor.name;
    if (name === "GetCommand") return { Item: courseItem(course()) };
    if (name === "QueryCommand") return { Items: name && [(command as { input: { ExpressionAttributeValues?: Record<string, string> } }).input.ExpressionAttributeValues?.[":pk"]?.includes("BY_SKILL")
      ? courseSkillMapItem({ expertId: "expert-a", courseId: "course-1", skillId: "skill-1", skillVersionId: "sv-1", targetProficiencyCode: "L1", createdAt: now, createdBy: "author" }, 1)
      : courseItem(course())] };
    if (name === "BatchGetCommand") return { Responses: { learning: [courseItem(course())] } };
    return {}; } };
  const repo = new DynamoDbCourseRepository({ region: "ap-southeast-1", tableName: "learning", auditTableName: "audit" }, client as never);
  await repo.getCourse("expert-a", "course-1");
  await repo.listCourses({ expertId: "expert-a", limit: 10 });
  await repo.listCoursesBySkill({ expertId: "expert-a", skillId: "skill-1", limit: 10 });
  assert.deepEqual(commands.map((x) => (x as { constructor: { name: string } }).constructor.name), ["GetCommand", "QueryCommand", "QueryCommand", "BatchGetCommand"]);
  assert.ok(commands.every((x) => (x as { constructor: { name: string } }).constructor.name !== "ScanCommand"));
});

test("create transaction includes active Expert, code lock, aggregate, version and audit", async () => {
  let captured: { input?: { TransactItems?: unknown[] } } | undefined;
  const client = { send: async (command: unknown) => { captured = command as typeof captured; return {}; } };
  const repo = new DynamoDbCourseRepository({ region: "ap-southeast-1", tableName: "learning", auditTableName: "audit" }, client as never);
  await repo.commitCreateCourse({ course: course(), version: version(), audit });
  assert.equal(captured?.input?.TransactItems?.length, 5);
});

test("full stored CourseVersion retains DynamoDB headroom", () => {
  const large = version({ description: "d".repeat(4000), modules: Array.from({ length: 20 }, (_, mi) => ({ id: `m${mi}`, title: `Module ${mi}`, position: mi + 1,
    lessons: Array.from({ length: 6 }, (_, li) => ({ id: `m${mi}l${li}`, title: `Lesson ${li}`, summary: "s".repeat(1900), position: li + 1, estimatedMinutes: 30,
      outcomes: [{ id: `o${mi}-${li}`, statement: "Apply the mapped skill", skillId: `skill-${mi % 20}`, skillVersionId: `sv-${mi % 20}`, targetProficiencyCode: "L1" }] })) })) });
  const bytes = Buffer.byteLength(JSON.stringify(courseVersionItem(large)), "utf8");
  assert.ok(bytes < 400_000, `serialized item was ${bytes} bytes`);
  assert.ok(bytes > 200_000, `benchmark fixture was only ${bytes} bytes`);
});
