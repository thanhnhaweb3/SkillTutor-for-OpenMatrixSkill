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
import { loadSkillTutorConfig } from "../src/config";
import { createJoinHandlers, createLearnerAdminHandlers, createTeamAdminHandlers } from "../src/next/learner-admin";
import { createCatalogHandler, createMeHandler } from "../src/next/catalog";
import { seedCourse, type CourseManifest } from "../src/oms/course-seed";
import { OmsLearningGateway } from "../src/oms/gateway";
import { createSkillTutorRuntime } from "../src/runtime";
import { InMemorySkillTutorStore } from "../src/store";

process.env.APP_URL = "http://localhost:3000";
process.env.AC_SESSION_SECRET ??= "test-secret";

const manifest = JSON.parse(readFileSync(new URL("../../../docs/courses/ai-van-phong-nang-cao.json", import.meta.url), "utf8")) as CourseManifest;
const at = "2026-10-01T00:00:00.000Z";
const EXPERT = "expert-olym3";
const ORIGIN = { origin: "http://localhost:3000", "content-type": "application/json" };

const user = (id: string, name: string, email: string): AcUser => ({ id, name, email, role: "learner", avatarInitials: name.slice(0, 2), primaryAdapter: "local",
  primarySubject: `local:${email}`, identities: [], locale: "vi", createdAt: at, updatedAt: at });

async function setup() {
  const member = (userId: string, roles: ExpertMembership["roles"]): ExpertMembership =>
    ({ id: `m-${userId}`, expertId: EXPERT, userId, status: "active", roles, tier: "free", createdAt: at, updatedAt: at, version: 1 });
  const repos = {
    dashboard: new InMemoryDashboardRepository({
      experts: [{ id: EXPERT, slug: "olym3", displayName: "OLYM3 Training", status: "active", ownerUserId: "u-admin", level: 1, createdAt: at, updatedAt: at, version: 1 }],
      memberships: [member("u-admin", ["expert_admin"]), member("u-reviewer", ["reviewer"])]
    }),
    skills: new InMemorySkillRepository(), courses: new InMemoryCourseRepository(), delivery: new InMemoryDeliveryRepository()
  };
  const seeded = await seedCourse({ repos, manifest, expertId: EXPERT, authorUserId: "u-admin", reviewerUserId: "u-reviewer", learnerUserIds: [], commit: true });
  const users = [user("u-admin", "Admin", "lieulieunft@gmail.com"), user("u-bien", "Mai Nguyễn Ngọc Biên", "mainguyenngocbien@gmail.com"), user("u-new", "Học viên mới", "new@olym3.com")];
  const store = new InMemorySkillTutorStore();
  const rt = createSkillTutorRuntime({
    config: { ...loadSkillTutorConfig(), enabled: true, demo: false, channelsMode: "dryrun", appUrl: "http://localhost:3000" },
    gateway: new OmsLearningGateway({ ...repos, progressEnabled: () => true,
      users: { findById: async (id: string) => users.find((u) => u.id === id) ?? null, findByEmail: async (e: string) => users.find((u) => u.email === e) ?? null } }),
    store, llm: new MockLlm(), sender: { whatsapp: async () => "x", sms: async () => "x", email: async () => "x" }
  });
  const as = (id: string) => async () => { const u = users.find((x) => x.id === id)!; return { id: u.id, name: u.name }; };
  return { rt, repos, store, cohortId: seeded.cohort.cohortId!, provider: async () => rt, as };
}

test("seed admits a learner who is not yet an Expert member (invite → active → enroll)", async () => {
  const { repos } = await setup();
  const r = await seedCourse({ repos, manifest, expertId: EXPERT, authorUserId: "u-admin", reviewerUserId: "u-reviewer", learnerUserIds: ["u-bien"], commit: true });
  assert.deepEqual(r.enrollments, [{ userId: "u-bien", action: "created", membershipCreated: true }]);
  const m = await repos.dashboard.getMembership(EXPERT, "u-bien");
  assert.equal(m?.status, "active");
  assert.deepEqual(m?.roles, ["learner"]);
});

test("join link → pending request → admin approves → learner enrolled, notified, on the roster", async () => {
  const { provider, as, cohortId, repos, store } = await setup();
  const join = createJoinHandlers(provider, as("u-bien"));
  const url = `http://localhost:3000/api/skilltutor/join?e=${EXPERT}&c=${cohortId}`;
  assert.equal((await (await join.GET(new NextRequest(url))).json()).status, "none");
  const sent = await join.POST(new NextRequest("http://localhost:3000/api/skilltutor/join", { method: "POST", headers: ORIGIN, body: JSON.stringify({ expertId: EXPERT, cohortId, note: "Em ở phòng Kế hoạch" }) }));
  assert.equal(sent.status, 201);
  assert.equal((await sent.json()).status, "pending");

  const admin = createLearnerAdminHandlers(provider, as("u-admin"));
  const page = await (await admin.GET(new NextRequest(`http://localhost:3000/api/skilltutor/admin/learners?cohortId=${cohortId}`))).json();
  assert.equal(page.cohorts[0].courseTitle, "AI ứng dụng nâng cao trong công việc văn phòng");
  assert.match(page.joinUrl, /\/dashboard\/skilltutor\/join\?e=expert-olym3&c=/);
  assert.deepEqual(page.requests.map((r: { userId: string; status: string; note: string }) => [r.userId, r.status, r.note]), [["u-bien", "pending", "Em ở phòng Kế hoạch"]]);

  const approved = await admin.POST(new NextRequest("http://localhost:3000/api/skilltutor/admin/learners", { method: "POST", headers: ORIGIN, body: JSON.stringify({ action: "approve", cohortId, userId: "u-bien" }) }));
  assert.equal((await approved.json()).status, "enrolled");
  assert.ok(await repos.delivery.getEnrollment(EXPERT, cohortId, "u-bien"));
  assert.ok(store.outbox.some((o) => o.channel === "email" && o.to.email === "mainguyenngocbien@gmail.com" && /ghi danh/.test(o.subject ?? "")));
  assert.equal((await (await join.GET(new NextRequest(url))).json()).status, "enrolled");

  const after = await (await admin.GET(new NextRequest(`http://localhost:3000/api/skilltutor/admin/learners?cohortId=${cohortId}`))).json();
  assert.deepEqual(after.roster.map((r: { userId: string; percentComplete: number }) => [r.userId, r.percentComplete]), [["u-bien", 0]]);
  assert.equal(after.requests[0].status, "approved");
});

test("admin adds learners by email: enrolls, reports unknown accounts, is idempotent", async () => {
  const { provider, as, cohortId } = await setup();
  const admin = createLearnerAdminHandlers(provider, as("u-admin"));
  const post = (emails: string[]) => admin.POST(new NextRequest("http://localhost:3000/api/skilltutor/admin/learners", { method: "POST", headers: ORIGIN, body: JSON.stringify({ action: "admit", cohortId, emails }) }));
  const first = await (await post(["New@OLYM3.com", "nobody@olym3.com", "not-an-email"])).json();
  assert.deepEqual(first.results.map((r: { email: string; status: string }) => [r.email, r.status]),
    [["new@olym3.com", "enrolled"], ["nobody@olym3.com", "no_account"], ["not-an-email", "invalid_email"]]);
  const again = await (await post(["new@olym3.com"])).json();
  assert.equal(again.results[0].status, "already_enrolled");
});

test("only Expert admins can use the learner admin API; requests reject; cross-site POST blocked", async () => {
  const { provider, as, cohortId } = await setup();
  const asLearner = createLearnerAdminHandlers(provider, as("u-bien"));
  assert.equal((await asLearner.GET(new NextRequest("http://localhost:3000/api/skilltutor/admin/learners"))).status, 403);

  const join = createJoinHandlers(provider, as("u-bien"));
  await join.POST(new NextRequest("http://localhost:3000/api/skilltutor/join", { method: "POST", headers: ORIGIN, body: JSON.stringify({ expertId: EXPERT, cohortId }) }));
  const admin = createLearnerAdminHandlers(provider, as("u-admin"));
  const cross = await admin.POST(new NextRequest("http://localhost:3000/api/skilltutor/admin/learners", { method: "POST", headers: { ...ORIGIN, origin: "https://evil.example" }, body: JSON.stringify({ action: "approve", cohortId, userId: "u-bien" }) }));
  assert.equal(cross.status, 403);
  const rejected = await admin.POST(new NextRequest("http://localhost:3000/api/skilltutor/admin/learners", { method: "POST", headers: ORIGIN, body: JSON.stringify({ action: "reject", cohortId, userId: "u-bien" }) }));
  assert.equal((await rejected.json()).status, "rejected");
  const status = await (await join.GET(new NextRequest(`http://localhost:3000/api/skilltutor/join?e=${EXPERT}&c=${cohortId}`))).json();
  assert.equal(status.status, "rejected", "learner sees the decision and may ask again");
});

test("landing catalog: public cohorts with per-user status; me summary shows enrollment after approval", async () => {
  const { rt, provider, as, cohortId } = await setup();
  rt.config.publicExpertIds = [EXPERT];
  const url = "http://localhost:3000/api/skilltutor/catalog";
  const guest = await (await createCatalogHandler(provider, async () => null)(new NextRequest(url))).json();
  assert.equal(guest.signedIn, false);
  assert.deepEqual(guest.cohorts.map((c: { cohortId: string; status: string; lessonCount: number }) => [c.cohortId, c.status, c.lessonCount]), [[cohortId, "guest", 12]]);
  assert.equal(guest.cohorts[0].skills.length, 6);

  const bienCatalog = createCatalogHandler(provider, as("u-bien"));
  assert.equal((await (await bienCatalog(new NextRequest(url))).json()).cohorts[0].status, "none");
  await createJoinHandlers(provider, as("u-bien")).POST(new NextRequest("http://localhost:3000/api/skilltutor/join", { method: "POST", headers: ORIGIN, body: JSON.stringify({ expertId: EXPERT, cohortId }) }));
  assert.equal((await (await bienCatalog(new NextRequest(url))).json()).cohorts[0].status, "pending");
  await createLearnerAdminHandlers(provider, as("u-admin")).POST(new NextRequest("http://localhost:3000/api/skilltutor/admin/learners", { method: "POST", headers: ORIGIN, body: JSON.stringify({ action: "approve", cohortId, userId: "u-bien" }) }));
  assert.equal((await (await bienCatalog(new NextRequest(url))).json()).cohorts[0].status, "enrolled");

  const me = await (await createMeHandler(provider, as("u-bien"))(new NextRequest("http://localhost:3000/api/skilltutor/me"))).json();
  assert.deepEqual([me.whatsapp.linked, me.enrollments.length, me.enrollments[0].percentComplete], [false, 1, 0]);
  assert.equal((await createMeHandler(provider, async () => null)(new NextRequest("http://localhost:3000/api/skilltutor/me"))).status, 401);
});

test("Expert team: approve a judge by email as reviewer, remove them, re-add with a new role; learners keep their learner role", async () => {
  const { provider, as, repos } = await setup();
  const team = createTeamAdminHandlers(provider, as("u-admin"));
  const url = "http://localhost:3000/api/skilltutor/admin/team";
  const post = async (body: Record<string, unknown>) => (await team.POST(new NextRequest(url, { method: "POST", headers: ORIGIN, body: JSON.stringify(body) }))).json();

  const before = await (await team.GET(new NextRequest(url))).json();
  assert.deepEqual(before.members.map((m: { userId: string }) => m.userId).sort(), ["u-admin", "u-reviewer"]);
  assert.equal(before.selfUserId, "u-admin");

  assert.equal((await post({ action: "add", email: "New@olym3.com", role: "reviewer" })).status, "added");
  assert.deepEqual([(await repos.dashboard.getMembership(EXPERT, "u-new"))?.status, (await repos.dashboard.getMembership(EXPERT, "u-new"))?.roles], ["active", ["reviewer"]]);
  assert.equal((await post({ action: "add", email: "new@olym3.com", role: "reviewer" })).status, "already_member");
  assert.equal((await post({ action: "add", email: "nobody@olym3.com" })).status, "no_account");
  assert.equal((await team.POST(new NextRequest(url, { method: "POST", headers: ORIGIN, body: JSON.stringify({ action: "add", email: "new@olym3.com", role: "platform_admin" }) }))).status, 422);

  // A judge (reviewer) cannot manage the team.
  assert.equal((await createTeamAdminHandlers(provider, as("u-new")).GET(new NextRequest(url))).status, 403);

  assert.equal((await post({ action: "remove", userId: "u-new" })).status, "removed");
  assert.equal((await repos.dashboard.getMembership(EXPERT, "u-new"))?.status, "suspended");
  assert.equal((await post({ action: "remove", userId: "u-new" })).status, "not_member");
  assert.equal((await post({ action: "remove", userId: "u-admin" })).status, "self");

  assert.equal((await post({ action: "add", email: "new@olym3.com", role: "auditor" })).status, "added");
  assert.deepEqual([(await repos.dashboard.getMembership(EXPERT, "u-new"))?.status, (await repos.dashboard.getMembership(EXPERT, "u-new"))?.roles], ["active", ["auditor"]]);

  await seedCourse({ repos, manifest, expertId: EXPERT, authorUserId: "u-admin", reviewerUserId: "u-reviewer", learnerUserIds: ["u-bien"], commit: true });
  assert.equal((await post({ action: "add", email: "mainguyenngocbien@gmail.com", role: "reviewer" })).status, "added");
  assert.equal((await post({ action: "remove", userId: "u-bien" })).status, "removed");
  assert.deepEqual([(await repos.dashboard.getMembership(EXPERT, "u-bien"))?.status, (await repos.dashboard.getMembership(EXPERT, "u-bien"))?.roles], ["active", ["learner"]]);
});

test("landing catalog carries the OMS course code so known courses render bilingual copy", async () => {
  const { rt } = await setup();
  rt.config.publicExpertIds = [EXPERT];
  const body = await (await createCatalogHandler(async () => rt, async () => null)(new NextRequest("http://localhost:3000/api/skilltutor/catalog"))).json();
  assert.equal(body.cohorts[0].courseCode, "AIVP-ADV-01");
});
