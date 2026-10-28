import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent } from "../src/core/types";
import { DynamoDbDeliveryRepository } from "../src/delivery/dynamodb-repository";
import { cohortItem, cohortKey, enrollmentItem, enrollmentKey, progressItem, progressKey, toCohort, toEnrollment, toProgress, userEnrollmentItem, userEnrollmentKey } from "../src/delivery/serialization";
import type { Cohort, Enrollment, LearnerProgress } from "../src/delivery/types";
const at = "2026-07-22T00:00:00.000Z";
const cohort: Cohort = { id: "cohort-1", expertId: "expert-a", name: "Cohort", courseId: "course-1", courseVersionId: "cv-1", courseVersionNumber: 1, startDate: "2026-07-01", status: "active", version: 1, createdAt: at, createdBy: "admin", updatedAt: at, updatedBy: "admin" };
const enrollment: Enrollment = { id: "e-1", expertId: "expert-a", cohortId: "cohort-1", courseId: "course-1", courseVersionId: "cv-1", userId: "user-a", status: "active", enrolledAt: at, enrolledBy: "admin", version: 1 };
const progress: LearnerProgress = { expertId: "expert-a", cohortId: "cohort-1", courseId: "course-1", courseVersionId: "cv-1", userId: "user-a", completedLessonIds: [], requiredLessonCount: 2, completedLessonCount: 0, percentComplete: 0, version: 1, createdAt: at, updatedAt: at };
const audit: AuditEvent = { eventId: "a1", occurredAt: at, requestId: "r1", actorUserId: "admin", expertId: "expert-a", action: "enrollment:create", targetType: "enrollment", targetId: "e-1", result: "allowed" };

test("delivery keys match canonical Expert/User partitions", () => {
  assert.deepEqual(cohortKey("expert-a", "cohort-1"), { pk: "EXPERT#expert-a", sk: "COHORT#cohort-1#META" });
  assert.deepEqual(enrollmentKey("expert-a", "cohort-1", "user-a"), { pk: "EXPERT#expert-a", sk: "ENROLLMENT#COHORT#cohort-1#USER#user-a" });
  assert.deepEqual(userEnrollmentKey("user-a", "expert-a", "cohort-1"), { pk: "USER#user-a", sk: "ENROLLMENT#EXPERT#expert-a#COHORT#cohort-1" });
  assert.deepEqual(progressKey("user-a", "expert-a", "cohort-1", "course-1"), { pk: "USER#user-a", sk: "PROGRESS#EXPERT#expert-a#COHORT#cohort-1#COURSE#course-1" });
});
test("delivery parsers round-trip and default-deny malformed records", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(toCohort(cohortItem(cohort)))), cohort); assert.deepEqual(JSON.parse(JSON.stringify(toEnrollment(enrollmentItem(enrollment)))), enrollment);
  assert.deepEqual(JSON.parse(JSON.stringify(toProgress(progressItem(progress)))), progress); assert.equal(toProgress({ ...progressItem(progress), completedLessonIds: "bad" }), null);
});
test("AP-06 self progress uses consistent Get operations and no Scan", async () => {
  const commands: unknown[] = []; const client = { send: async (command: unknown) => { commands.push(command); const name = (command as { constructor: { name: string } }).constructor.name; return name === "GetCommand" && commands.length === 1 ? { Item: enrollmentItem(enrollment) } : { Item: progressItem(progress) }; } };
  const repo = new DynamoDbDeliveryRepository({ region: "ap-southeast-1", tableName: "learning", auditTableName: "audit" }, client as never);
  assert.deepEqual(JSON.parse(JSON.stringify(await repo.getSelfProgress("expert-a", "cohort-1", "user-a"))), progress);
  assert.deepEqual(commands.map((x) => (x as { constructor: { name: string } }).constructor.name), ["GetCommand", "GetCommand"]);
});
test("enrollment transaction atomically writes both access paths, progress and audit", async () => {
  let captured: { input?: { TransactItems?: unknown[] } } | undefined; const client = { send: async (command: unknown) => { captured = command as typeof captured; return {}; } };
  const repo = new DynamoDbDeliveryRepository({ region: "ap-southeast-1", tableName: "learning", auditTableName: "audit" }, client as never);
  await repo.commitCreateEnrollment({ enrollment, progress, audit }); assert.equal(captured?.input?.TransactItems?.length, 5);
});

test("listEnrollmentsByUser queries the USER partition (no Scan) and parses USER_ENROLLMENT items", async () => {
  const commands: Array<{ input: Record<string, unknown> }> = [];
  const client = { send: async (command: { input: Record<string, unknown> }) => { commands.push(command); return { Items: [userEnrollmentItem(enrollment), { pk: "USER#user-a", sk: "ENROLLMENT#EXPERT#x#COHORT#y", entityType: "USER_ENROLLMENT", id: 1 }] }; } };
  const repo = new DynamoDbDeliveryRepository({ region: "ap-southeast-1", tableName: "learning", auditTableName: "audit" }, client as never);
  assert.deepEqual(JSON.parse(JSON.stringify(await repo.listEnrollmentsByUser("user-a"))), [enrollment]);
  assert.equal(commands.length, 1); assert.equal(commands[0].constructor.name, "QueryCommand");
  assert.deepEqual(commands[0].input.ExpressionAttributeValues, { ":pk": "USER#user-a", ":sk": "ENROLLMENT#EXPERT#" });
});

test("listEnrollmentsByCohort queries the Expert partition for one cohort (no Scan)", async () => {
  const commands: Array<{ input: Record<string, unknown> }> = [];
  const client = { send: async (command: { input: Record<string, unknown> }) => { commands.push(command); return { Items: [enrollmentItem(enrollment)] }; } };
  const repo = new DynamoDbDeliveryRepository({ region: "ap-southeast-1", tableName: "learning", auditTableName: "audit" }, client as never);
  assert.deepEqual(JSON.parse(JSON.stringify(await repo.listEnrollmentsByCohort(enrollment.expertId, enrollment.cohortId))), [enrollment]);
  assert.equal(commands[0].constructor.name, "QueryCommand");
  assert.deepEqual(commands[0].input.ExpressionAttributeValues, { ":pk": `EXPERT#${enrollment.expertId}`, ":sk": `ENROLLMENT#COHORT#${enrollment.cohortId}#USER#` });
});
