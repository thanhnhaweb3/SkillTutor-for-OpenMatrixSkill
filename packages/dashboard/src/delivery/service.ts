import { createHash, randomUUID } from "node:crypto";
import type { AuditEvent, ExpertContext, MembershipTier, Permission } from "../core/types";
import type { DashboardRepository } from "../data/repositories";
import type { CourseRepository } from "../courses/repository";
import { FREE_COURSE_QUOTA } from "../courses/quota";
import { DeliveryDomainError } from "./errors";
import type { DeliveryRepository } from "./repository";
import type { Cohort, Enrollment, LearnerProgress } from "./types";
import { validateCohortInput } from "./validation";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function permission(context: ExpertContext, value: Permission) { if (!context.permissions.includes(value)) throw new DeliveryDomainError("MISSING_PERMISSION"); }
export class DeliveryService {
  constructor(private readonly repository: DeliveryRepository, private readonly courses: CourseRepository, private readonly dashboard: DashboardRepository,
    private readonly now: () => Date = () => new Date(), private readonly id: () => string = randomUUID) {}
  async listCohorts(input: { context: ExpertContext; courseId?: string; cursor?: string; limit: number }) { permission(input.context, "course:read"); return this.repository.listCohorts({ expertId: input.context.expertId, courseId: input.courseId, cursor: input.cursor, limit: input.limit }); }
  async createCohort(input: { context: ExpertContext; tier: MembershipTier; courseId: string; courseVersionNumber: number; name: string; startDate: string; endDate?: string; requestId: string }) {
    permission(input.context, "course:update"); const course = await this.courses.getCourse(input.context.expertId, input.courseId);
    const version = await this.courses.getCourseVersion(input.context.expertId, input.courseId, input.courseVersionNumber);
    if (!course || !version) throw new DeliveryDomainError("OUTSIDE_EXPERT"); if (version.status !== "published" || course.currentPublishedVersionId !== version.id) throw new DeliveryDomainError("INVALID_STATE_TRANSITION", "Cohorts require the current published CourseVersion");
    if (input.tier === "free" && await this.repository.getActiveCohortCount(input.context.expertId) >= FREE_COURSE_QUOTA.activeCohorts) throw new DeliveryDomainError("QUOTA_EXCEEDED");
    const valid = validateCohortInput(input), at = this.now().toISOString(); const cohort: Cohort = { id: `cohort_${this.id()}`, expertId: input.context.expertId,
      name: valid.name, courseId: course.id, courseVersionId: version.id, courseVersionNumber: version.versionNumber, startDate: valid.startDate,
      endDate: valid.endDate, status: "active", version: 1, createdAt: at, createdBy: input.context.userId, updatedAt: at, updatedBy: input.context.userId };
    await this.repository.commitCreateCohort({ cohort, audit: this.audit(input.context, input.requestId, "cohort:create", "cohort", cohort.id, undefined, cohort) }); return cohort;
  }
  async enroll(input: { context: ExpertContext; cohortId: string; userId: string; requestId: string }) {
    permission(input.context, "expert:manage_members"); const cohort = await this.repository.getCohort(input.context.expertId, input.cohortId);
    if (!cohort || cohort.status !== "active") throw new DeliveryDomainError("OUTSIDE_EXPERT"); const membership = await this.dashboard.getMembership(input.context.expertId, input.userId);
    if (!membership || membership.status !== "active") throw new DeliveryDomainError("VALIDATION_ERROR", "Enrollment requires an active same-Expert member");
    const version = await this.courses.getCourseVersion(input.context.expertId, cohort.courseId, cohort.courseVersionNumber);
    if (!version || version.id !== cohort.courseVersionId || version.status !== "published") throw new DeliveryDomainError("INVALID_STATE_TRANSITION");
    const required = requiredLessons(version), at = this.now().toISOString(); const enrollment: Enrollment = { id: `enrollment_${this.id()}`, expertId: input.context.expertId,
      cohortId: cohort.id, courseId: cohort.courseId, courseVersionId: cohort.courseVersionId, userId: membership.userId, status: "active", enrolledAt: at, enrolledBy: input.context.userId, version: 1 };
    const progress: LearnerProgress = { expertId: enrollment.expertId, cohortId: cohort.id, courseId: cohort.courseId, courseVersionId: cohort.courseVersionId,
      userId: membership.userId, completedLessonIds: [], requiredLessonCount: required.length, completedLessonCount: 0, percentComplete: 0, version: 1, createdAt: at, updatedAt: at };
    await this.repository.commitCreateEnrollment({ enrollment, progress, audit: this.audit(input.context, input.requestId, "enrollment:create", "enrollment", enrollment.id, undefined, { cohortId: cohort.id, userId: membership.userId }) }); return { enrollment, progress };
  }
  async getSelfProgress(input: { context: ExpertContext; cohortId: string }) { permission(input.context, "progress:read_self"); const progress = await this.repository.getSelfProgress(input.context.expertId, input.cohortId, input.context.userId);
    if (!progress) throw new DeliveryDomainError("OUTSIDE_EXPERT"); return progress; }
  async completeLesson(input: { context: ExpertContext; cohortId: string; lessonId: string; requestId: string }) {
    permission(input.context, "progress:update_self"); const enrollment = await this.repository.getEnrollment(input.context.expertId, input.cohortId, input.context.userId);
    const current = await this.repository.getSelfProgress(input.context.expertId, input.cohortId, input.context.userId); const cohort = await this.repository.getCohort(input.context.expertId, input.cohortId);
    if (!enrollment || !current || !cohort) throw new DeliveryDomainError("OUTSIDE_EXPERT");
    const version = await this.courses.getCourseVersion(input.context.expertId, cohort.courseId, cohort.courseVersionNumber); if (!version || version.id !== enrollment.courseVersionId || version.status !== "published") throw new DeliveryDomainError("OUTSIDE_EXPERT");
    const required = requiredLessons(version); if (!required.includes(input.lessonId)) throw new DeliveryDomainError("VALIDATION_ERROR", "Lesson is not required by the enrolled CourseVersion");
    if (current.completedLessonIds.includes(input.lessonId)) return { progress: current, replayed: true };
    if (enrollment.status !== "active") throw new DeliveryDomainError("OUTSIDE_EXPERT");
    const completedLessonIds = [...current.completedLessonIds, input.lessonId].sort(), count = completedLessonIds.length, complete = count === required.length, at = this.now().toISOString();
    const next: LearnerProgress = { ...current, completedLessonIds, requiredLessonCount: required.length, completedLessonCount: count,
      percentComplete: Math.floor(count * 100 / required.length), courseCompletedAt: complete ? at : undefined, version: current.version + 1, updatedAt: at };
    const nextEnrollment: Enrollment | undefined = complete ? { ...enrollment, status: "completed", version: enrollment.version + 1 } : undefined;
    await this.repository.commitProgress({ previous: current, next, enrollment: nextEnrollment ? { previous: enrollment, next: nextEnrollment } : undefined,
      audit: this.audit(input.context, input.requestId, complete ? "progress:course_complete" : "progress:lesson_complete", "progress", `${cohort.id}:${input.context.userId}`, current, next) });
    return { progress: next, replayed: false };
  }
  private audit(context: ExpertContext, requestId: string, action: string, targetType: string, targetId: string, before: unknown, after: unknown): AuditEvent { return {
    eventId: `audit_${this.id()}`, occurredAt: this.now().toISOString(), requestId, actorUserId: context.userId, expertId: context.expertId,
    action, targetType, targetId, result: "allowed", beforeHash: before ? hash(before) : undefined, afterHash: hash(after) }; }
}
function requiredLessons(version: { modules: Array<{ lessons: Array<{ id: string }> }> }) { return version.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id)); }
