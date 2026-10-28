import { createHash, randomUUID } from "node:crypto";
import type { ExpertContext, MembershipTier, Permission, AuditEvent } from "../core/types";
import type { DashboardRepository } from "../data/repositories";
import type { SkillRepository } from "../skills/repository";
import type { CourseSkillMap } from "../skills/types";
import { CourseDomainError } from "./errors";
import { requireFreeCourseCapacity, requireFreePublishCapacity } from "./quota";
import type { CourseListQuery, CourseRepository } from "./repository";
import type { Course, CourseDraftContent, CourseVersion } from "./types";
import { normalizeCourseCode, validateCourseDraft } from "./validation";
import { approveCourseVersion, createNextCourseDraft, publishCourseVersion, requestCourseChanges, submitCourseForReview, updateCourseDraft } from "./workflow";

const elevated = (c: ExpertContext) => c.roles.some((r) => ["platform_admin", "expert_admin", "curriculum_manager", "reviewer", "auditor"].includes(r));
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function requirePermission(c: ExpertContext, p: Permission) { if (!c.permissions.includes(p)) throw new CourseDomainError("MISSING_PERMISSION"); }
function slug(value: string, suffix: string) { const base = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "course"; return `${base}-${suffix.slice(0, 8)}`; }

export class CourseService {
  constructor(private readonly repository: CourseRepository, private readonly dashboard: DashboardRepository,
    private readonly skills: SkillRepository, private readonly now: () => Date = () => new Date(), private readonly id: () => string = randomUUID) {}

  async list(input: { context: ExpertContext; query: Omit<CourseListQuery, "expertId"> & { skillId?: string } }) {
    requirePermission(input.context, "course:read");
    const query = elevated(input.context) ? input.query : { ...input.query, status: "published" as const, ownerUserId: undefined };
    return query.skillId ? this.repository.listCoursesBySkill({ expertId: input.context.expertId, skillId: query.skillId, status: query.status, cursor: query.cursor, limit: query.limit })
      : this.repository.listCourses({ ...query, expertId: input.context.expertId });
  }
  async get(input: { context: ExpertContext; courseId: string; versionNumber?: number }) {
    requirePermission(input.context, "course:read");
    const course = await this.repository.getCourse(input.context.expertId, input.courseId);
    if (!course) throw new CourseDomainError("OUTSIDE_EXPERT");
    const number = input.versionNumber ?? (elevated(input.context) ? course.latestVersionNumber : undefined);
    const version = number ? await this.repository.getCourseVersion(input.context.expertId, course.id, number)
      : course.currentPublishedVersionId ? (await this.repository.listCourseVersions({ expertId: input.context.expertId, courseId: course.id, limit: 100 })).items.find((x) => x.id === course.currentPublishedVersionId) ?? null : null;
    if (!version || (!elevated(input.context) && version.status !== "published" && version.ownerUserId !== input.context.userId)) throw new CourseDomainError("OUTSIDE_EXPERT");
    return { course, version };
  }
  async create(input: { context: ExpertContext; tier: MembershipTier; code: string; content: CourseDraftContent; requestId: string }) {
    requirePermission(input.context, "course:create"); await this.requireActiveOwner(input.context.expertId, input.content.ownerUserId);
    if (input.tier === "free") requireFreeCourseCapacity(await this.repository.getQuotaUsage(input.context.expertId));
    const content = validateCourseDraft(input.content), code = normalizeCourseCode(input.code), at = this.now().toISOString();
    const courseId = `course_${this.id()}`, versionId = `coursev_${this.id()}`;
    const course: Course = { id: courseId, expertId: input.context.expertId, code, slug: slug(content.title, courseId), latestVersionId: versionId,
      latestVersionNumber: 1, latestStatus: "draft", latestTitle: content.title, latestOwnerUserId: content.ownerUserId, version: 1,
      createdAt: at, createdBy: input.context.userId, updatedAt: at, updatedBy: input.context.userId };
    const version: CourseVersion = { id: versionId, expertId: course.expertId, courseId, versionNumber: 1, status: "draft", ...content,
      version: 1, createdAt: at, createdBy: input.context.userId, updatedAt: at, updatedBy: input.context.userId };
    await this.repository.commitCreateCourse({ course, version, audit: this.audit(input.context, input.requestId, "course:create", course.id, undefined, version) });
    return { course, version };
  }
  async update(input: Mutation & { content: CourseDraftContent }) { await this.requireActiveOwner(input.context.expertId, input.content.ownerUserId); return this.mutate(input, (v) => updateCourseDraft({ ...input, current: v, now: this.now().toISOString() }), "course:update_draft"); }
  async submitReview(input: Mutation) { return this.mutate(input, (v) => submitCourseForReview({ ...input, current: v, now: this.now().toISOString() }), "course:submit_review"); }
  async requestChanges(input: Mutation & { note: string }) { return this.mutate(input, (v) => requestCourseChanges({ ...input, current: v, now: this.now().toISOString() }), "course:changes_requested"); }
  async approve(input: Mutation) { return this.mutate(input, (v) => approveCourseVersion({ ...input, current: v, now: this.now().toISOString() }), "course:approve"); }
  async publish(input: Mutation & { tier: MembershipTier }) {
    const current = await this.loadLatest(input); const maps = await this.validateMappings(input.context, current.version);
    if (input.tier === "free") requireFreePublishCapacity(await this.repository.getQuotaUsage(input.context.expertId), !!current.course.currentPublishedVersionId);
    return this.mutateLoaded(input, current, (v) => publishCourseVersion({ ...input, current: v, now: this.now().toISOString() }), "course:publish", true, maps);
  }
  async nextDraft(input: { context: ExpertContext; courseId: string; requestId: string }) {
    const { course } = await this.get({ context: input.context, courseId: input.courseId });
    if (!course.currentPublishedVersionId) throw new CourseDomainError("INVALID_STATE_TRANSITION");
    const versions = await this.repository.listCourseVersions({ expertId: input.context.expertId, courseId: course.id, limit: 100 });
    const published = versions.items.find((x) => x.id === course.currentPublishedVersionId);
    if (!published) throw new CourseDomainError("OUTSIDE_EXPERT");
    const at = this.now().toISOString(), version = createNextCourseDraft({ context: input.context, published, id: `coursev_${this.id()}`, now: at });
    const nextCourse = { ...course, latestVersionId: version.id, latestVersionNumber: version.versionNumber, latestStatus: "draft" as const,
      latestTitle: version.title, latestOwnerUserId: version.ownerUserId, version: course.version + 1, updatedAt: at, updatedBy: input.context.userId };
    await this.repository.commitCreateNextVersion({ previousCourse: course, nextCourse, version, audit: this.audit(input.context, input.requestId, "course:create_next_version", course.id, course, nextCourse) });
    return { course: nextCourse, version };
  }
  private async mutate(input: Mutation, transition: (v: CourseVersion) => CourseVersion, action: string) { const loaded = await this.loadLatest(input); return this.mutateLoaded(input, loaded, transition, action); }
  private async mutateLoaded(input: Mutation, loaded: { course: Course; version: CourseVersion }, transition: (v: CourseVersion) => CourseVersion,
    action: string, published = false, skillMaps?: CourseSkillMap[]) {
    const version = transition(loaded.version), course = { ...loaded.course, latestStatus: version.status, latestTitle: version.title,
      latestOwnerUserId: version.ownerUserId, currentPublishedVersionId: published ? version.id : loaded.course.currentPublishedVersionId,
      version: loaded.course.version + 1, updatedAt: version.updatedAt, updatedBy: input.context.userId };
    await this.repository.commitVersionMutation({ previousCourse: loaded.course, nextCourse: course, previousVersion: loaded.version, nextVersion: version,
      skillMaps, audit: this.audit(input.context, input.requestId, action, course.id, loaded.version, version) }); return { course, version };
  }
  private async loadLatest(input: Mutation) { const course = await this.repository.getCourse(input.context.expertId, input.courseId);
    const version = await this.repository.getCourseVersion(input.context.expertId, input.courseId, input.versionNumber);
    if (!course || !version || course.latestVersionNumber !== version.versionNumber) throw new CourseDomainError("OUTSIDE_EXPERT"); return { course, version }; }
  private async validateMappings(context: ExpertContext, version: CourseVersion) {
    const unique = new Map<string, { skillId: string; skillVersionId: string; targetProficiencyCode: string }>();
    for (const outcome of version.modules.flatMap((m) => m.lessons.flatMap((l) => l.outcomes))) unique.set(outcome.skillId, outcome);
    const at = this.now().toISOString(), maps: CourseSkillMap[] = [];
    for (const outcome of unique.values()) { const skill = await this.skills.getSkill(context.expertId, outcome.skillId);
      if (!skill) throw new CourseDomainError("OUTSIDE_EXPERT");
      const skillVersion = (await this.skills.listSkillVersions({ expertId: context.expertId, skillId: outcome.skillId, limit: 100 })).items.find((x) => x.id === outcome.skillVersionId);
      if (!skillVersion || skillVersion.id !== outcome.skillVersionId || skillVersion.status !== "published") throw new CourseDomainError("VALIDATION_ERROR", "Course outcomes must pin a published SkillVersion");
      const framework = await this.skills.getFramework(context.expertId, skill.frameworkId);
      const frameworkVersion = framework ? await this.skills.getFrameworkVersion(context.expertId, framework.id, framework.currentVersionNumber) : null;
      if (!frameworkVersion?.proficiencyLevels.some((level) => level.code === outcome.targetProficiencyCode)) {
        throw new CourseDomainError("VALIDATION_ERROR", "Unknown target proficiency code");
      }
      maps.push({ expertId: context.expertId, courseId: version.courseId, skillId: outcome.skillId, skillVersionId: outcome.skillVersionId,
        targetProficiencyCode: outcome.targetProficiencyCode, createdAt: at, createdBy: context.userId }); }
    return maps;
  }
  private async requireActiveOwner(expertId: string, userId: string) { const m = await this.dashboard.getMembership(expertId, userId);
    if (!m || m.status !== "active") throw new CourseDomainError("VALIDATION_ERROR", "Owner must be an active Expert member"); }
  private audit(c: ExpertContext, requestId: string, action: string, targetId: string, before: unknown, after: unknown): AuditEvent { return {
    eventId: `audit_${this.id()}`, occurredAt: this.now().toISOString(), requestId, actorUserId: c.userId, expertId: c.expertId, action,
    targetType: "course", targetId, result: "allowed", beforeHash: before ? hash(before) : undefined, afterHash: hash(after) }; }
}

interface Mutation { context: ExpertContext; courseId: string; versionNumber: number; expectedVersion: number; requestId: string }
