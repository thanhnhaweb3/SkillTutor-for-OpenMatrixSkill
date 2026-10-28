import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
import { handleInbound } from "../src/inbound";
import { createLinkCode } from "../src/linking";
import { seedCourse, type CourseManifest } from "../src/oms/course-seed";
import { OmsLearningGateway } from "../src/oms/gateway";
import { runReminders } from "../src/rescue";
import { createSkillTutorRuntime } from "../src/runtime";
import { InMemorySkillTutorStore } from "../src/store";

const manifest = JSON.parse(readFileSync(new URL("../../../docs/courses/ai-van-phong-nang-cao.json", import.meta.url), "utf8")) as CourseManifest;
const at = "2026-10-01T00:00:00.000Z";
const EXPERT = "expert-olym3";
const NOW = new Date("2026-10-21T03:00:00.000Z"); // 10:00 Asia/Ho_Chi_Minh

function oms() {
  const member = (userId: string, roles: ExpertMembership["roles"]): ExpertMembership =>
    ({ id: `m-${userId}`, expertId: EXPERT, userId, status: "active", roles, tier: "free", createdAt: at, updatedAt: at, version: 1 });
  const repos = {
    dashboard: new InMemoryDashboardRepository({
      experts: [{ id: EXPERT, slug: "olym3-training", displayName: "OLYM3 Training", status: "active", ownerUserId: "u-admin", level: 1, createdAt: at, updatedAt: at, version: 1 }],
      memberships: [member("u-admin", ["expert_admin"]), member("u-reviewer", ["reviewer"]), member("u-nha", ["learner"])]
    }),
    skills: new InMemorySkillRepository(),
    courses: new InMemoryCourseRepository(),
    delivery: new InMemoryDeliveryRepository()
  };
  return repos;
}

const base = { expertId: EXPERT, authorUserId: "u-admin", reviewerUserId: "u-reviewer", learnerUserIds: ["u-nha"], manifest };

test("manifest from the training proposal: 6 skills, 12 lessons, every lesson maps to a skill and level", () => {
  assert.equal(manifest.skills.length, 6);
  assert.equal(manifest.course.modules.length, 6);
  assert.equal(manifest.course.modules.flatMap((m) => m.lessons).length, 12);
});

test("dry-run validates and plans without writing", async () => {
  const repos = oms();
  const plan = await seedCourse({ ...base, repos, commit: false });
  assert.deepEqual(plan.skills.map((s) => s.action), Array(6).fill("planned"));
  assert.equal(plan.course.action, "planned");
  assert.equal((await repos.skills.listSkills({ expertId: EXPERT, limit: 100 })).items.length, 0);
});

test("author and reviewer must be different people", async () => {
  await assert.rejects(seedCourse({ ...base, reviewerUserId: "u-admin", repos: oms(), commit: true }), /different accounts/);
});

test("commit creates framework, publishes skills and course with two-person review, opens cohort, enrolls; re-run is idempotent", async () => {
  const repos = oms();
  const first = await seedCourse({ ...base, repos, commit: true });
  assert.deepEqual(first.skills.map((s) => s.action), Array(6).fill("created"));
  assert.equal(first.course.action, "created");
  assert.equal(first.cohort.action, "created");
  assert.deepEqual(first.enrollments, [{ userId: "u-nha", action: "created", membershipCreated: false }]);

  const course = await repos.courses.getCourse(EXPERT, first.course.courseId!);
  const version = await repos.courses.getCourseVersion(EXPERT, course!.id, 1);
  assert.equal(version?.status, "published");
  assert.equal(version?.createdBy, "u-admin");
  assert.equal(version?.approvedBy, "u-reviewer");

  const again = await seedCourse({ ...base, repos, commit: true });
  assert.deepEqual(again.skills.map((s) => s.action), Array(6).fill("reused"));
  assert.equal(again.course.action, "reused");
  assert.equal(again.cohort.action, "reused");
  assert.deepEqual(again.enrollments, [{ userId: "u-nha", action: "reused" }]);
});

test("learner completes the seeded course on WhatsApp: reminder → 12 lessons → quiz across all topics → certificate with 6 skills", async () => {
  const repos = oms();
  const seeded = await seedCourse({ ...base, repos, commit: true });
  const nha: AcUser = { id: "u-nha", email: "nha@olym3.com", name: "Mai Thanh Nhã", role: "learner", avatarInitials: "MN", primaryAdapter: "local",
    primarySubject: "local:nha@olym3.com", identities: [], locale: "vi", createdAt: at, updatedAt: at };
  const store = new InMemorySkillTutorStore();
  const rt = createSkillTutorRuntime({
    // whole course in one day → no daily message quota in this test (limits.test.ts covers the quota)
    config: { ...loadSkillTutorConfig(), enabled: true, demo: false, channelsMode: "dryrun", llmMode: "mock", agentMode: "local", appUrl: "https://tutor.test",
      dailyLimits: { web: 0, whatsapp: 0, sms: 0, simulator: 0 } },
    gateway: new OmsLearningGateway({ ...repos, users: { findById: async (id: string) => (id === nha.id ? nha : null) } as never, progressEnabled: () => true, now: () => NOW }),
    store, llm: new MockLlm(), sender: { whatsapp: async () => "x", sms: async () => "x", email: async () => "x" }, now: () => NOW
  });
  const phone = "+84901234786";
  const say = (text: string) => handleInbound(rt, { phone, text, channel: "whatsapp" });

  const code = await createLinkCode(rt, "u-nha");
  await say(`LINK ${code.code}`);
  assert.match((await say("nhắc 20:00")).reply ?? "", /20:00/);
  // Next day 20:05 local, not studied since → one reminder naming the next lesson.
  const evening = createSkillTutorRuntime({ ...rt, now: () => new Date("2026-10-22T13:05:00.000Z") });
  assert.deepEqual((await runReminders(evening)).sent.map((s) => s.channel), ["whatsapp"]);
  assert.match(store.outbox.at(-1)!.text, /Từ hỏi AI sang giao việc cho AI/);

  const first = await say("học");
  assert.match(first.reply ?? "", /Bài 1\/12/);
  for (let i = 0; i < 12; i++) { await say("next_lesson"); await say("done_lesson"); }
  const progress = await repos.delivery.getSelfProgress(EXPERT, seeded.cohort.cohortId!, "u-nha");
  assert.equal(progress?.percentComplete, 100);

  await say("start_quiz");
  const version = await repos.courses.getCourseVersion(EXPERT, seeded.course.courseId!, 1);
  const quiz = (await store.getQuizSet(`${version!.id}#vi`))!;
  assert.equal(quiz.questions.length, 6);
  const tested = new Set(quiz.questions.map((q) => version!.modules.find((m) => m.lessons.some((l) => l.id === q.lessonId))!.id));
  assert.equal(tested.size, 6, "one question per topic");
  let last;
  for (const q of quiz.questions) last = await say(q.correctOptionId);
  const certCode = (last?.reply ?? "").match(/OMS-[0-9A-F]{8}/)?.[0];
  assert.ok(certCode, "certificate issued");

  const { valid, cert } = await verifyCertificate(rt, certCode!);
  assert.equal(valid, true);
  assert.equal(cert?.courseTitle, "AI ứng dụng nâng cao trong công việc văn phòng");
  assert.equal(cert?.expertName, "OLYM3 Training");
  assert.equal(cert?.skills.length, 6);
  assert.ok(store.outbox.some((o) => o.channel === "email" && o.to.email === "nha@olym3.com" && o.subject?.includes(certCode!)));
});

test("fresh workspace: a reviewer who is not yet a member is added with the reviewer role, then publishes", async () => {
  const repos = {
    dashboard: new InMemoryDashboardRepository({
      experts: [{ id: EXPERT, slug: "olym3-training", displayName: "OLYM3 Training", status: "active", ownerUserId: "u-admin", level: 0, createdAt: at, updatedAt: at, version: 1 }],
      memberships: [{ id: "m-u-admin", expertId: EXPERT, userId: "u-admin", status: "active", roles: ["expert_admin"], tier: "free", createdAt: at, updatedAt: at, version: 1 }]
    }),
    skills: new InMemorySkillRepository(), courses: new InMemoryCourseRepository(), delivery: new InMemoryDeliveryRepository()
  };
  const plan = await seedCourse({ ...base, learnerUserIds: [], repos, commit: false });
  assert.equal(plan.course.action, "planned");
  assert.equal(await repos.dashboard.getMembership(EXPERT, "u-reviewer"), null, "dry-run writes nothing");
  const done = await seedCourse({ ...base, learnerUserIds: [], repos, commit: true });
  assert.equal(done.course.action, "created");
  const m = await repos.dashboard.getMembership(EXPERT, "u-reviewer");
  assert.deepEqual([m?.status, m?.roles], ["active", ["reviewer"]]);
});
