import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { InMemoryCourseRepository, InMemoryDashboardRepository, InMemoryDeliveryRepository, InMemorySkillRepository, type ExpertMembership } from "@openmatrix/dashboard";
import { pickLang, splitBilingual } from "../src/bilingual";
import { seedCourse, validateManifest, type CourseManifest } from "../src/oms/course-seed";
import { OmsLearningGateway } from "../src/oms/gateway";
import { localizeGateway } from "../src/oms/localized";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../docs/courses/${name}.json`, import.meta.url), "utf8")) as CourseManifest;
const bilingual = load("applying-data-and-ai-in-business-en-vi-45min");
const at = "2026-10-29T00:00:00.000Z";
const EXPERT = "expert-olym3";

test("pickLang splits 'English / Tiếng Việt' at the language boundary, keeping slashes inside the English half", () => {
  assert.equal(pickLang("Business decisions and data / Quyết định kinh doanh và dữ liệu", "en"), "Business decisions and data");
  assert.equal(pickLang("Business decisions and data / Quyết định kinh doanh và dữ liệu", "vi"), "Quyết định kinh doanh và dữ liệu");
  assert.equal(pickLang("KPI: completed orders / sessions per channel. / KPI: đơn hoàn tất / phiên mỗi kênh.", "en"), "KPI: completed orders / sessions per channel.");
  assert.equal(pickLang("KPI: completed orders / sessions per channel. / KPI: đơn hoàn tất / phiên mỗi kênh.", "vi"), "KPI: đơn hoàn tất / phiên mỗi kênh.");
  assert.equal(pickLang("ENGLISH\nLearn 2 min.\n\nTIẾNG VIỆT\nHọc 2 phút.", "en"), "Learn 2 min.");
  assert.equal(pickLang("ENGLISH\nLearn 2 min.\n\nTIẾNG VIỆT\nHọc 2 phút.", "vi"), "Học 2 phút.");
  // Single-language text is left alone.
  for (const text of ["Giao việc cho AI và chia nhỏ nhiệm vụ", "Excel / Google Sheets: lập bảng tổng hợp doanh thu theo tháng", "Plain English title", ""]) {
    assert.equal(pickLang(text, "en"), text);
  }
});

test("every lesson of the bilingual manifest has both languages; the Vietnamese-only manifests are never split", () => {
  validateManifest(bilingual);
  for (const m of bilingual.course.modules) {
    assert.ok(splitBilingual(m.title), m.title);
    for (const l of m.lessons) for (const text of [l.title, l.summary, l.outcome]) assert.ok(splitBilingual(text), text.slice(0, 60));
  }
  const strings = (o: unknown): string[] => typeof o === "string" ? [o] : o && typeof o === "object" ? Object.values(o).flatMap(strings) : [];
  for (const name of ["ai-van-phong-nang-cao", "ai-deployment-practitioner-cham-soc-khach-hang"]) {
    const m = load(name);
    assert.deepEqual(strings({ skills: m.skills, course: m.course, cohort: m.cohort }).filter((s) => splitBilingual(s)), [], name);
  }
});

test("localized gateway: the tutor sees lessons, course version and skill names in the learner's language", async () => {
  const member = (userId: string, roles: ExpertMembership["roles"]): ExpertMembership =>
    ({ id: `m-${userId}`, expertId: EXPERT, userId, status: "active", roles, tier: "pro", createdAt: at, updatedAt: at, version: 1 });
  const repos = {
    dashboard: new InMemoryDashboardRepository({
      experts: [{ id: EXPERT, slug: "olym3", displayName: "OLYM3 Training", status: "active", ownerUserId: "u-admin", level: 1, createdAt: at, updatedAt: at, version: 1 }],
      memberships: [member("u-admin", ["expert_admin"]), member("u-reviewer", ["reviewer"])]
    }),
    skills: new InMemorySkillRepository(), courses: new InMemoryCourseRepository(), delivery: new InMemoryDeliveryRepository()
  };
  const seeded = await seedCourse({ repos, manifest: bilingual, expertId: EXPERT, authorUserId: "u-admin", reviewerUserId: "u-reviewer", learnerUserIds: [], commit: true });
  const gateway = new OmsLearningGateway({ ...repos, progressEnabled: () => true, users: { findById: async () => null } });
  const { courseId, versionNumber } = seeded.course;

  const en = await localizeGateway(gateway, "en").getLessons(EXPERT, courseId!, versionNumber!);
  const vi = await localizeGateway(gateway, "vi").getLessons(EXPERT, courseId!, versionNumber!);
  assert.equal(en.length, 9);
  assert.equal(en[0].title, "From business goals to decisions");
  assert.equal(vi[0].title, "Từ mục tiêu kinh doanh đến quyết định");
  assert.equal(en[0].moduleTitle, "Business decisions and data");
  assert.match(en[0].summary, /^Timing: learn 2 min/);
  assert.doesNotMatch(en[0].summary, /TIẾNG VIỆT|Phân bổ/);
  assert.match(vi[0].summary, /^Phân bổ: học 2 phút/);
  assert.equal(en[0].outcomes[0].statement, "Write one decision, KPI and hypothesis.");

  const version = await localizeGateway(gateway, "en").getCourseVersion(EXPERT, courseId!, versionNumber!);
  assert.equal(version?.title, "Applying Data and AI in business");
  const raw = await gateway.getCourseVersion(EXPERT, courseId!, versionNumber!);
  assert.match(raw!.title, / \/ ứng dụng Data và AI/, "OMS keeps the bilingual original");

  const skillId = en[0].outcomes[0].skillId;
  assert.deepEqual(await localizeGateway(gateway, "en").skillNames(EXPERT, [skillId]), { [skillId]: "Frame a business problem" });
  assert.deepEqual(await localizeGateway(gateway, "vi").skillNames(EXPERT, [skillId]), { [skillId]: "Xác định bài toán kinh doanh" });
});
