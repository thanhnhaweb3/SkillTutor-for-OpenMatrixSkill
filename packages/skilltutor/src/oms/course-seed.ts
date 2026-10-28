import { createHash, randomUUID } from "node:crypto";
import {
  CourseService,
  DeliveryService,
  MembershipService,
  SkillService,
  permissionsForRoles,
  validateCourseDraft,
  validateFrameworkInput,
  validateSkillDraft,
  type CourseDraftContent,
  type CourseRepository,
  type DashboardRepository,
  type DeliveryRepository,
  type ExpertContext,
  type ExpertMembership,
  type ExpertRole,
  type MembershipTier,
  type SkillRepository
} from "@openmatrix/dashboard";
import { admitLearner, canMutateMemberships } from "./admission";

/**
 * Imports a course manifest into OMS through the normal domain services, so every step keeps
 * OMS's validation, two-person review, quotas and audit log:
 * skill framework (if the Expert has none) → skills (author creates, reviewer publishes)
 * → course (author creates, reviewer approves + publishes) → cohort → enrollments.
 * Idempotent: skills are matched by code, the course by code and the cohort by name.
 */

export interface CourseManifest {
  source?: string;
  framework: { name: string; description?: string; proficiencyLevels: { code: string; rank: number; name: string; description: string }[] };
  skills: { code: string; name: string; description: string; outcomes: string[]; tags: string[] }[];
  course: {
    code: string; title: string; description: string;
    modules: { title: string; lessons: { title: string; summary: string; minutes: number; skill: string; level: string; outcome: string }[] }[];
  };
  cohort: { name: string; startDate: string; endDate?: string };
}

export interface CourseSeedRepos { dashboard: DashboardRepository; skills: SkillRepository; courses: CourseRepository; delivery: DeliveryRepository }

export interface CourseSeedInput {
  repos: CourseSeedRepos;
  manifest: CourseManifest;
  expertId: string;
  authorUserId: string;
  reviewerUserId: string;
  learnerUserIds: string[];
  /** false = validate and plan only (no writes). */
  commit: boolean;
  /**
   * Plan for the author's and reviewer's memberships (operator choice, written to the audit log).
   * The free plan allows 1 published course and 1 active cohort per Expert, so a second course needs "pro".
   */
  tier?: MembershipTier;
  log?: (line: string) => void;
}

export interface CourseSeedResult {
  expertId: string;
  frameworkId?: string;
  skills: { code: string; skillId?: string; skillVersionId?: string; action: "reused" | "created" | "planned" }[];
  course: { code: string; courseId?: string; versionNumber?: number; action: "reused" | "created" | "planned" };
  cohort: { name: string; cohortId?: string; action: "reused" | "created" | "planned" };
  enrollments: { userId: string; action: "reused" | "created" | "planned"; membershipCreated?: boolean }[];
  lessonCount: number;
}

const slugId = (prefix: string, text: string, i: number) =>
  `${prefix}-${i + 1}-${text.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;

/** Builds the CourseDraftContent once skill codes are resolved to published SkillVersions. */
export function buildCourseDraft(manifest: CourseManifest, ownerUserId: string, skillVersions: Map<string, { skillId: string; skillVersionId: string }>): CourseDraftContent {
  let n = 0;
  return {
    title: manifest.course.title,
    description: manifest.course.description,
    ownerUserId,
    modules: manifest.course.modules.map((m, mi) => ({
      id: slugId("mod", m.title, mi),
      title: m.title,
      position: mi + 1,
      lessons: m.lessons.map((l, li) => {
        const sv = skillVersions.get(l.skill);
        if (!sv) throw new Error(`Lesson "${l.title}" references unknown skill ${l.skill}`);
        n++;
        return {
          id: slugId("lesson", l.title, n - 1), title: l.title, summary: l.summary, position: li + 1, estimatedMinutes: l.minutes,
          outcomes: [{ id: `o-${n}`, statement: l.outcome, skillId: sv.skillId, skillVersionId: sv.skillVersionId, targetProficiencyCode: l.level }]
        };
      })
    }))
  };
}

/** Static checks that need no database: OMS validators + references between the manifest's parts. */
export function validateManifest(manifest: CourseManifest) {
  const framework = validateFrameworkInput(manifest.framework);
  const levels = new Set(framework.proficiencyLevels.map((l) => l.code));
  const codes = new Set<string>();
  for (const s of manifest.skills) {
    validateSkillDraft({ ...s, ownerUserId: "validator" });
    if (codes.has(s.code)) throw new Error(`Duplicate skill code ${s.code}`);
    codes.add(s.code);
  }
  for (const l of manifest.course.modules.flatMap((m) => m.lessons)) {
    if (!codes.has(l.skill)) throw new Error(`Lesson "${l.title}" uses unknown skill ${l.skill}`);
    if (!levels.has(l.level)) throw new Error(`Lesson "${l.title}" uses unknown level ${l.level}`);
  }
  const placeholder = new Map(manifest.skills.map((s) => [s.code, { skillId: `skill-${s.code}`, skillVersionId: `skillv-${s.code}` }]));
  validateCourseDraft(buildCourseDraft(manifest, "validator", placeholder));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.cohort.startDate)) throw new Error("cohort.startDate must be YYYY-MM-DD");
  return { lessonCount: manifest.course.modules.reduce((a, m) => a + m.lessons.length, 0), levels: [...levels] };
}

function contextOf(m: ExpertMembership): ExpertContext {
  return { userId: m.userId, expertId: m.expertId, membershipId: m.id, roles: m.roles, permissions: permissionsForRoles(m.roles) };
}

function need(m: ExpertMembership | null, who: string, roles: ExpertRole[]) {
  if (!m || m.status !== "active") throw new Error(`${who} is not an active member of this Expert`);
  if (!m.roles.some((r) => roles.includes(r))) throw new Error(`${who} needs one of the roles: ${roles.join(", ")} (has ${m.roles.join(", ")})`);
  return m;
}

async function findSkillByCode(repo: SkillRepository, expertId: string, code: string) {
  let cursor: string | undefined;
  do {
    const page = await repo.listSkills({ expertId, limit: 100, cursor });
    const hit = page.items.find((s) => s.code === code.toUpperCase());
    if (hit) return hit;
    cursor = page.cursor;
  } while (cursor);
  return null;
}

async function findCourseByCode(repo: CourseRepository, expertId: string, code: string) {
  let cursor: string | undefined;
  do {
    const page = await repo.listCourses({ expertId, limit: 100, cursor });
    const hit = page.items.find((c) => c.code === code.toUpperCase());
    if (hit) return hit;
    cursor = page.cursor;
  } while (cursor);
  return null;
}

const REVIEW_ROLES: ExpertRole[] = ["reviewer", "expert_admin", "platform_admin"];

/** Makes the second account an active reviewer of the Expert (invite → reviewer role → active) so a fresh workspace can publish. */
async function ensureReviewer(repos: CourseSeedRepos, author: ExpertMembership, userId: string, commit: boolean, log: (line: string) => void): Promise<ExpertMembership> {
  let m = await repos.dashboard.getMembership(author.expertId, userId);
  if (m?.status === "active" && m.roles.some((r) => REVIEW_ROLES.includes(r))) return m;
  if (m?.status === "revoked") throw new Error("Reviewer was removed from this Expert (membership revoked)");
  if (!commit) {
    log("reviewer: will be added to the Expert with the reviewer role");
    return m ? { ...m, status: "active", roles: [...m.roles, "reviewer"] } : { id: "planned-reviewer", expertId: author.expertId, userId, status: "active", roles: ["reviewer"], tier: "free", createdAt: "", updatedAt: "", version: 0 };
  }
  if (!canMutateMemberships(repos.dashboard)) throw new Error("Reviewer is not a member yet and membership changes need DASHBOARD_STORE=dynamodb");
  const members = new MembershipService(repos.dashboard), actor = contextOf(author), rid = () => `seed_${randomUUID()}`;
  if (!m) m = await members.invite({ context: actor, userId, roles: ["reviewer"], requestId: rid() });
  else if (!m.roles.some((r) => REVIEW_ROLES.includes(r))) m = await members.assignRoles({ context: actor, userId, roles: [...m.roles, "reviewer"], expectedVersion: m.version, requestId: rid() });
  if (m.status !== "active") m = await members.changeStatus({ context: actor, userId, status: "active", expectedVersion: m.version, requestId: rid() });
  log("reviewer: added to the Expert with the reviewer role");
  return m;
}

const FREE_LIMITS = { publishedCourses: 1, activeCohorts: 1 };

/** Fails before any write when the free plan cannot hold another published course / active cohort. */
async function requireFreeCapacity(repos: CourseSeedRepos, expertId: string, code: string, free: boolean) {
  if (!free) return;
  const existing = await findCourseByCode(repos.courses, expertId, code);
  if (existing?.currentPublishedVersionId) return; // re-run of an already published course
  const usage = await repos.courses.getQuotaUsage(expertId);
  const cohorts = await repos.delivery.getActiveCohortCount(expertId);
  if (usage.publishedCourseCount >= FREE_LIMITS.publishedCourses || cohorts >= FREE_LIMITS.activeCohorts) {
    throw Object.assign(new Error(
      `Free plan limit: this Expert already has ${usage.publishedCourseCount} published course(s) and ${cohorts} active cohort(s) ` +
      `(free allows ${FREE_LIMITS.publishedCourses} and ${FREE_LIMITS.activeCohorts}). Re-run with --tier pro to move the author and reviewer to the pro plan.`
    ), { code: "QUOTA_EXCEEDED" });
  }
}

/** Moves the author/reviewer memberships to the requested plan (audited membership mutation). */
async function setTier(repos: CourseSeedRepos, members: ExpertMembership[], tier: MembershipTier | undefined, commit: boolean, log: (line: string) => void) {
  if (!tier) return members;
  const out: ExpertMembership[] = [];
  for (const m of members) {
    if (m.tier === tier) { out.push(m); continue; }
    if (!commit || m.version === 0) { log(`membership ${m.userId}: will change plan ${m.tier} → ${tier}`); out.push({ ...m, tier }); continue; }
    if (!canMutateMemberships(repos.dashboard)) throw new Error("Changing the plan needs DASHBOARD_STORE=dynamodb");
    const now = new Date().toISOString();
    const next: ExpertMembership = { ...m, tier, updatedAt: now, version: m.version + 1 };
    await repos.dashboard.commitMembershipMutation({
      previous: m, next, expectedVersion: m.version, activeAdminDelta: 0,
      audit: { eventId: `audit_${randomUUID()}`, occurredAt: now, requestId: `seed_${randomUUID()}`, actorUserId: members[0].userId, expertId: m.expertId,
        action: "membership:set_tier", targetType: "membership", targetId: m.id, result: "allowed",
        beforeHash: createHash("sha256").update(JSON.stringify(m)).digest("hex"), afterHash: createHash("sha256").update(JSON.stringify(next)).digest("hex") }
    });
    log(`membership ${m.userId}: plan ${m.tier} → ${tier}`);
    out.push(next);
  }
  return out;
}

export async function seedCourse(input: CourseSeedInput): Promise<CourseSeedResult> {
  const { repos, manifest, expertId, commit } = input;
  const log = input.log ?? (() => undefined);
  const rid = () => `seed_${randomUUID()}`;
  const { lessonCount } = validateManifest(manifest);
  if (input.authorUserId === input.reviewerUserId) throw new Error("Author and reviewer must be different accounts (OMS two-person review)");

  const expert = await repos.dashboard.getExpert(expertId);
  if (!expert || expert.status !== "active") throw new Error(`Expert ${expertId} must exist and be active`);
  const author = need(await repos.dashboard.getMembership(expertId, input.authorUserId), "Author", ["expert_admin", "platform_admin"]);
  const reviewer = await ensureReviewer(repos, author, input.reviewerUserId, commit, log);
  for (const id of input.learnerUserIds) {
    const m = await repos.dashboard.getMembership(expertId, id);
    if (m?.status === "revoked") throw new Error(`Learner ${id} was removed from this Expert (membership revoked)`);
    if (m?.status !== "active") log(`learner ${id}: not a member yet – will be added as learner`);
  }
  const [authorM, reviewerM] = await setTier(repos, [author, reviewer], input.tier, commit, log);
  const authorCtx = contextOf(authorM), reviewerCtx = contextOf(reviewerM), tier = authorM.tier;
  await requireFreeCapacity(repos, expertId, manifest.course.code, authorM.tier === "free" || reviewerM.tier === "free");

  const skillService = new SkillService(repos.skills, repos.dashboard);
  const courseService = new CourseService(repos.courses, repos.dashboard, repos.skills);
  const delivery = new DeliveryService(repos.delivery, repos.courses, repos.dashboard);
  const result: CourseSeedResult = { expertId, skills: [], course: { code: manifest.course.code, action: "planned" }, cohort: { name: manifest.cohort.name, action: "planned" }, enrollments: [], lessonCount };

  // 1. Proficiency framework: reuse the Expert's first framework if it has all levels the course uses.
  const frameworks = await repos.skills.listFrameworks(expertId);
  let frameworkId = frameworks[0]?.id;
  if (frameworkId) {
    const fw = frameworks[0];
    const version = await repos.skills.getFrameworkVersion(expertId, fw.id, fw.currentVersionNumber);
    const have = new Set(version?.proficiencyLevels.map((l) => l.code));
    const missing = [...new Set(manifest.course.modules.flatMap((m) => m.lessons.map((l) => l.level)))].filter((c) => !have.has(c));
    if (missing.length) throw new Error(`Framework "${fw.name}" lacks proficiency codes ${missing.join(", ")}; use its codes in the manifest`);
    log(`framework: reuse ${fw.name}`);
  } else if (commit) {
    const now = new Date().toISOString(), valid = validateFrameworkInput(manifest.framework);
    frameworkId = `framework_${randomUUID()}`;
    const version = { id: `frameworkv_${randomUUID()}`, expertId, frameworkId, versionNumber: 1, name: valid.name, description: valid.description,
      proficiencyLevels: valid.proficiencyLevels, publishedAt: now, publishedBy: authorCtx.userId, createdAt: now, createdBy: authorCtx.userId };
    await repos.skills.commitSeedFramework({
      framework: { id: frameworkId, expertId, name: valid.name, currentVersionNumber: 1, version: 1, createdAt: now, createdBy: authorCtx.userId, updatedAt: now, updatedBy: authorCtx.userId },
      version,
      audit: { eventId: `audit_${randomUUID()}`, occurredAt: now, requestId: rid(), actorUserId: authorCtx.userId, expertId, action: "skill_framework:seed_v1",
        targetType: "skill_framework", targetId: frameworkId, result: "allowed", afterHash: createHash("sha256").update(JSON.stringify(version)).digest("hex") }
    });
    log(`framework: created ${valid.name}`);
  } else log(`framework: would create ${manifest.framework.name}`);
  result.frameworkId = frameworkId;

  // 2. Skills: author creates + submits, reviewer publishes.
  const pinned = new Map<string, { skillId: string; skillVersionId: string }>();
  for (const s of manifest.skills) {
    const existing = await findSkillByCode(repos.skills, expertId, s.code);
    if (existing?.currentPublishedVersionId) {
      pinned.set(s.code, { skillId: existing.id, skillVersionId: existing.currentPublishedVersionId });
      result.skills.push({ code: s.code, skillId: existing.id, skillVersionId: existing.currentPublishedVersionId, action: "reused" });
      log(`skill ${s.code}: reuse published`);
      continue;
    }
    if (existing) throw new Error(`Skill ${s.code} exists but is not published (status ${existing.latestStatus}); publish or archive it first`);
    if (!commit) { result.skills.push({ code: s.code, action: "planned" }); pinned.set(s.code, { skillId: `planned-${s.code}`, skillVersionId: `planned-${s.code}` }); continue; }
    const created = await skillService.create({ context: authorCtx, tier, frameworkId: frameworkId!, code: s.code, requestId: rid(),
      content: { name: s.name, description: s.description, outcomes: s.outcomes, tags: s.tags, ownerUserId: authorCtx.userId } });
    const submitted = await skillService.submitReview({ context: authorCtx, skillId: created.skill.id, versionNumber: 1, expectedVersion: created.version.version, requestId: rid() });
    const published = await skillService.publish({ context: reviewerCtx, skillId: created.skill.id, versionNumber: 1, expectedVersion: submitted.version.version, requestId: rid() });
    pinned.set(s.code, { skillId: published.skill.id, skillVersionId: published.version.id });
    result.skills.push({ code: s.code, skillId: published.skill.id, skillVersionId: published.version.id, action: "created" });
    log(`skill ${s.code}: created and published`);
  }

  // 3. Course: author creates + submits, reviewer approves + publishes (publish pins the skill maps).
  const content = buildCourseDraft(manifest, authorCtx.userId, pinned);
  let course = await findCourseByCode(repos.courses, expertId, manifest.course.code);
  let versionNumber: number | undefined;
  if (course?.currentPublishedVersionId) {
    versionNumber = (await repos.courses.listCourseVersions({ expertId, courseId: course.id, limit: 100 })).items.find((v) => v.id === course!.currentPublishedVersionId)?.versionNumber;
    result.course = { code: course.code, courseId: course.id, versionNumber, action: "reused" };
    log(`course ${course.code}: reuse published v${versionNumber}`);
  } else if (course) {
    throw new Error(`Course ${course.code} exists but is not published (status ${course.latestStatus}); finish or archive it first`);
  } else if (commit) {
    const created = await courseService.create({ context: authorCtx, tier, code: manifest.course.code, content, requestId: rid() });
    const m = (v: { version: number }) => ({ courseId: created.course.id, versionNumber: 1, expectedVersion: v.version, requestId: rid() });
    const submitted = await courseService.submitReview({ context: authorCtx, ...m(created.version) });
    const approved = await courseService.approve({ context: reviewerCtx, ...m(submitted.version) });
    const published = await courseService.publish({ context: reviewerCtx, tier: reviewerM.tier, ...m(approved.version) });
    course = published.course; versionNumber = 1;
    result.course = { code: course.code, courseId: course.id, versionNumber, action: "created" };
    log(`course ${course.code}: created, approved and published`);
  }

  // 4. Cohort.
  if (course && versionNumber) {
    const cohorts = await repos.delivery.listCohorts({ expertId, courseId: course.id, limit: 100 });
    let cohort = cohorts.items.find((c) => c.name === manifest.cohort.name && c.status === "active");
    if (cohort) { result.cohort = { name: cohort.name, cohortId: cohort.id, action: "reused" }; log(`cohort: reuse ${cohort.id}`); }
    else if (commit) {
      cohort = await delivery.createCohort({ context: authorCtx, tier, courseId: course.id, courseVersionNumber: versionNumber, name: manifest.cohort.name,
        startDate: manifest.cohort.startDate, endDate: manifest.cohort.endDate, requestId: rid() });
      result.cohort = { name: cohort.name, cohortId: cohort.id, action: "created" };
      log(`cohort: created ${cohort.id}`);
    }
    // 5. Enrollments.
    for (const userId of input.learnerUserIds) {
      if (cohort && await repos.delivery.getEnrollment(expertId, cohort.id, userId)) { result.enrollments.push({ userId, action: "reused" }); continue; }
      if (!commit || !cohort) { result.enrollments.push({ userId, action: "planned" }); continue; }
      const admitted = await admitLearner(repos, authorCtx, { cohortId: cohort.id, userId });
      result.enrollments.push({ userId, action: "created", membershipCreated: admitted.membershipCreated });
      log(`enrolled ${userId}`);
    }
  } else {
    result.enrollments = input.learnerUserIds.map((userId) => ({ userId, action: "planned" as const }));
  }
  return result;
}
