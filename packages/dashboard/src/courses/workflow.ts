import type { ExpertContext, Permission } from "../core/types";
import { CourseDomainError } from "./errors";
import type { CourseDraftContent, CourseVersion } from "./types";
import { validateCourseDraft } from "./validation";

function guard(context: ExpertContext, current: CourseVersion, permission: Permission, expectedVersion: number) {
  if (context.expertId !== current.expertId) throw new CourseDomainError("OUTSIDE_EXPERT");
  if (!context.permissions.includes(permission)) throw new CourseDomainError("MISSING_PERMISSION");
  if (current.version !== expectedVersion) throw new CourseDomainError("VERSION_CONFLICT", "Stale course version");
}

function canEdit(context: ExpertContext, current: CourseVersion) {
  return context.roles.some((role) => role === "platform_admin" || role === "expert_admin" || role === "curriculum_manager") ||
    current.ownerUserId === context.userId;
}

export function updateCourseDraft(input: { context: ExpertContext; current: CourseVersion; expectedVersion: number; content: CourseDraftContent; now: string }) {
  guard(input.context, input.current, "course:update", input.expectedVersion);
  if (input.current.status === "published") throw new CourseDomainError("IMMUTABLE_PUBLISHED_VERSION");
  if (input.current.status !== "draft") throw new CourseDomainError("INVALID_STATE_TRANSITION");
  if (!canEdit(input.context, input.current)) throw new CourseDomainError("MISSING_PERMISSION");
  return { ...input.current, ...validateCourseDraft(input.content), version: input.current.version + 1,
    updatedAt: input.now, updatedBy: input.context.userId } satisfies CourseVersion;
}

export function submitCourseForReview(input: { context: ExpertContext; current: CourseVersion; expectedVersion: number; now: string }) {
  guard(input.context, input.current, "course:update", input.expectedVersion);
  if (input.current.status !== "draft") throw new CourseDomainError("INVALID_STATE_TRANSITION");
  if (!canEdit(input.context, input.current)) throw new CourseDomainError("MISSING_PERMISSION");
  validateCourseDraft(input.current);
  return { ...input.current, status: "in_review" as const, submittedAt: input.now, submittedBy: input.context.userId,
    reviewedAt: undefined, reviewedBy: undefined, reviewNote: undefined, approvedAt: undefined, approvedBy: undefined,
    version: input.current.version + 1, updatedAt: input.now, updatedBy: input.context.userId } satisfies CourseVersion;
}

export function requestCourseChanges(input: { context: ExpertContext; current: CourseVersion; expectedVersion: number; note: string; now: string }) {
  guard(input.context, input.current, "course:approve", input.expectedVersion);
  if (input.current.status !== "in_review") throw new CourseDomainError("INVALID_STATE_TRANSITION");
  const note = input.note.normalize("NFKC").trim();
  if (note.length < 3 || note.length > 1000 || /[<>]/u.test(note)) throw new CourseDomainError("VALIDATION_ERROR", "Invalid review note");
  return { ...input.current, status: "draft" as const, reviewedAt: input.now, reviewedBy: input.context.userId,
    reviewNote: note, version: input.current.version + 1, updatedAt: input.now, updatedBy: input.context.userId } satisfies CourseVersion;
}

export function approveCourseVersion(input: { context: ExpertContext; current: CourseVersion; expectedVersion: number; now: string }) {
  guard(input.context, input.current, "course:approve", input.expectedVersion);
  if (input.current.status !== "in_review") throw new CourseDomainError("INVALID_STATE_TRANSITION");
  if (input.current.createdBy === input.context.userId) throw new CourseDomainError("REVIEWER_REQUIRED", "An author cannot approve their own version");
  return { ...input.current, status: "approved" as const, reviewedAt: input.now, reviewedBy: input.context.userId,
    reviewNote: undefined, approvedAt: input.now, approvedBy: input.context.userId, version: input.current.version + 1,
    updatedAt: input.now, updatedBy: input.context.userId } satisfies CourseVersion;
}

export function publishCourseVersion(input: { context: ExpertContext; current: CourseVersion; expectedVersion: number; now: string }) {
  guard(input.context, input.current, "course:publish", input.expectedVersion);
  if (input.current.status !== "approved") throw new CourseDomainError("INVALID_STATE_TRANSITION");
  return { ...input.current, status: "published" as const, publishedAt: input.now, publishedBy: input.context.userId,
    version: input.current.version + 1, updatedAt: input.now, updatedBy: input.context.userId } satisfies CourseVersion;
}

export function createNextCourseDraft(input: { context: ExpertContext; published: CourseVersion; id: string; now: string }) {
  guard(input.context, input.published, "course:update", input.published.version);
  if (input.published.status !== "published") throw new CourseDomainError("INVALID_STATE_TRANSITION");
  return { ...input.published, ...validateCourseDraft(input.published), id: input.id,
    versionNumber: input.published.versionNumber + 1, status: "draft" as const, submittedAt: undefined, submittedBy: undefined,
    reviewedAt: undefined, reviewedBy: undefined, reviewNote: undefined, approvedAt: undefined, approvedBy: undefined,
    publishedAt: undefined, publishedBy: undefined, version: 1, createdAt: input.now, createdBy: input.context.userId,
    updatedAt: input.now, updatedBy: input.context.userId } satisfies CourseVersion;
}
