import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  InMemoryCourseRepository,
  InMemoryDashboardRepository,
  InMemoryDeliveryRepository,
  InMemorySkillRepository,
  type ExpertMembership
} from "@openmatrix/dashboard";
import type { AcUser } from "@openmatrix/oms-ac-login";
import { MockLlm } from "../src/agent/llm";
import { verifyCertificate } from "../src/certificates";
import { loadSkillTutorConfig } from "../src/config";
import { handleWebMessage } from "../src/inbound";
import { createCatalogHandler, createMyCoursesHandler } from "../src/next/catalog";
import { seedCourse, validateManifest, type CourseManifest } from "../src/oms/course-seed";
import { OmsLearningGateway } from "../src/oms/gateway";
import { createSkillTutorRuntime } from "../src/runtime";
import { InMemorySkillTutorStore } from "../src/store";

process.env.APP_URL = "http://localhost:3000";
process.env.AC_SESSION_SECRET ??= "test-secret";

const load = (file: string) => JSON.parse(readFileSync(new URL(`../../../docs/courses/${file}`, import.meta.url), "utf8")) as CourseManifest;
const office = load("ai-van-phong-nang-cao.json");
const aidp = load("ai-deployment-practitioner-cham-soc-khach-hang.json");
const at = "2026-10-01T00:00:00.000Z";
const EXPERT = "expert-olym3";
const NOW = new Date("2026-10-29T03:00:00.000Z");

function oms() {
  const member = (userId: string, roles: ExpertMembership["roles"]): ExpertMembership =>
    ({ id: `m-${userId}`, expertId: EXPERT, userId, status: "active", roles, tier: "free", createdAt: at, updatedAt: at, version: 1 });
  return {
    dashboard: new InMemoryDashboardRepository({
      experts: [{ id: EXPERT, slug: "olym3-training", displayName: "OLYM3 Training", status: "active", ownerUserId: "u-admin", level: 1, createdAt: at, updatedAt: at, version: 1 }],
      memberships: [member("u-admin", ["expert_admin"]), member("u-reviewer", ["reviewer"]), member("u-dev", ["learner"])]
    }),
    skills: new InMemorySkillRepository(), courses: new InMemoryCourseRepository(), delivery: new InMemoryDeliveryRepository()
  };
}

test("AI Deployment Practitioner manifest: 8 skills, 8 modules, 16 lessons, levels L1–L4, no clash with the office-AI course", () => {
  const checked = validateManifest(aidp);
  assert.equal(aidp.skills.length, 8);
  assert.equal(aidp.course.modules.length, 8);
  assert.equal(checked.lessonCount, 16);
  assert.deepEqual(checked.levels, ["L1", "L2", "L3", "L4"]);
  const officeCodes = new Set(office.skills.map((s) => s.code));
  assert.ok(aidp.skills.every((s) => !officeCodes.has(s.code)), "skill codes are unique across courses");
  assert.notEqual(aidp.course.code, office.course.code);
});

test("free-plan guard, then --tier pro: both courses live side by side under one Expert: catalogue, My courses, full AIDP course → certificate with its own skills", async () => {
  const repos = oms();
  const people = { expertId: EXPERT, authorUserId: "u-admin", reviewerUserId: "u-reviewer", learnerUserIds: ["u-dev"] };
  const first = await seedCourse({ ...people, manifest: office, repos, commit: true });
  // Free plan: 1 published course + 1 active cohort per Expert → refused up front, nothing written.
  await assert.rejects(seedCourse({ ...people, manifest: aidp, repos, commit: false }), /Free plan limit.*--tier pro/s, "the dry-run already reports it");
  await assert.rejects(seedCourse({ ...people, manifest: aidp, repos, commit: true }), (e: Error & { code?: string }) => e.code === "QUOTA_EXCEEDED");
  assert.equal((await repos.skills.listSkills({ expertId: EXPERT, limit: 100 })).items.length, office.skills.length, "no AIDP skill was created");
  const planned = await seedCourse({ ...people, manifest: aidp, repos, commit: false, tier: "pro" });
  assert.equal(planned.course.action, "planned");
  const second = await seedCourse({ ...people, manifest: aidp, repos, commit: true, tier: "pro" });
  assert.equal((await repos.dashboard.getMembership(EXPERT, "u-admin"))?.tier, "pro");
  assert.equal((await repos.dashboard.getMembership(EXPERT, "u-reviewer"))?.tier, "pro");
  assert.equal(first.course.action, "created");
  assert.equal(second.course.action, "created");
  assert.deepEqual(second.skills.map((s) => s.action), Array(8).fill("created"));
  assert.equal(second.cohort.action, "created");
  assert.equal((await seedCourse({ ...people, manifest: aidp, repos, commit: true })).course.action, "reused", "re-running the seed is idempotent (no --tier needed)");

  const dev: AcUser = { id: "u-dev", email: "dev@olym3.com", name: "Lê Minh Dev", role: "learner", avatarInitials: "LD", primaryAdapter: "local",
    primarySubject: "local:dev@olym3.com", identities: [], locale: "vi", createdAt: at, updatedAt: at };
  const store = new InMemorySkillTutorStore();
  const rt = createSkillTutorRuntime({
    config: { ...loadSkillTutorConfig(), enabled: true, demo: false, channelsMode: "dryrun", llmMode: "mock", agentMode: "local", appUrl: "https://tutor.test",
      publicExpertIds: [EXPERT], dailyLimits: { web: 0, whatsapp: 0, sms: 0, simulator: 0 } },
    gateway: new OmsLearningGateway({ ...repos, users: { findById: async (id: string) => (id === dev.id ? dev : null) } as never, progressEnabled: () => true, now: () => NOW }),
    store, llm: new MockLlm(), sender: { whatsapp: async () => "x", sms: async () => "x", email: async () => "x" }, now: () => NOW
  });
  const asDev = async () => ({ id: dev.id, name: dev.name });

  // Landing catalogue lists both cohorts; the learner is enrolled in both.
  const catalog = await (await createCatalogHandler(async () => rt, asDev)(new NextRequest("http://localhost:3000/api/skilltutor/catalog"))).json();
  const card = catalog.cohorts.find((c: { cohortId: string }) => c.cohortId === second.cohort.cohortId);
  assert.equal(catalog.cohorts.length, 2);
  assert.equal(card.lessonCount, 16);
  assert.equal(card.skills.length, 8);
  assert.equal(card.startDate, "2026-11-23");
  assert.equal(card.status, "enrolled");

  // "Continue on the web" for the AIDP course, then all 16 lessons.
  await handleWebMessage(rt, dev, `course:${EXPERT}:${second.cohort.cohortId}`, "app");
  const lesson1 = await handleWebMessage(rt, dev, "next_lesson", "app");
  assert.match(lesson1.reply ?? "", /AI Deployment Practitioner.*1\/16/s);
  await handleWebMessage(rt, dev, "done_lesson", "app");
  const mine = async () => (await createMyCoursesHandler(async () => rt, asDev)(new NextRequest("http://localhost:3000/api/skilltutor/courses"))).json();
  const after1 = (await mine()).courses.find((c: { cohortId: string }) => c.cohortId === second.cohort.cohortId);
  assert.equal(after1.active, true);
  assert.equal(after1.lessons.length, 16);
  assert.deepEqual(after1.lessons.slice(0, 2).map((l: { done: boolean }) => l.done), [true, false]);
  assert.equal(after1.nextLessonId, after1.lessons[1].id);

  for (let i = 1; i < 16; i++) { await handleWebMessage(rt, dev, "next_lesson", "app"); await handleWebMessage(rt, dev, "done_lesson", "app"); }
  const progress = await repos.delivery.getSelfProgress(EXPERT, second.cohort.cohortId!, "u-dev");
  assert.equal(progress?.percentComplete, 100);
  const officeProgress = await repos.delivery.getSelfProgress(EXPERT, first.cohort.cohortId!, "u-dev");
  assert.equal(officeProgress?.completedLessonCount ?? 0, 0, "progress goes to the course being studied only");

  await handleWebMessage(rt, dev, "start_quiz", "app");
  const version = await repos.courses.getCourseVersion(EXPERT, second.course.courseId!, 1);
  const quiz = (await store.getQuizSet(`${version!.id}#vi`))!;
  assert.ok(quiz.questions.length >= 4);
  let last;
  for (const q of quiz.questions) last = await handleWebMessage(rt, dev, q.correctOptionId, "app");
  const certCode = (last?.reply ?? "").match(/OMS-[0-9A-F]{8}/)?.[0];
  assert.ok(certCode, "certificate issued");
  const { valid, cert } = await verifyCertificate(rt, certCode!);
  assert.equal(valid, true);
  assert.equal(cert?.courseTitle, aidp.course.title);
  assert.ok(cert!.skills.length >= 1 && cert!.skills.every((s) => s.name.length > 0));

  const finalCard = (await mine()).courses.find((c: { cohortId: string }) => c.cohortId === second.cohort.cohortId);
  assert.equal(finalCard.certificateCode, certCode);
});
