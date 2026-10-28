import type { ExpertContext, Permission } from "../core/types";
import { SkillDomainError } from "./errors";
import type { SkillDraftContent, SkillVersion } from "./types";
import { validateSkillDraft } from "./validation";

function requireScope(context: ExpertContext, version: SkillVersion) {
  if (context.expertId !== version.expertId) throw new SkillDomainError("OUTSIDE_EXPERT");
}

function requirePermission(context: ExpertContext, permission: Permission) {
  if (!context.permissions.includes(permission)) throw new SkillDomainError("MISSING_PERMISSION");
}

function canEdit(context: ExpertContext, version: SkillVersion) {
  const managesAll = context.roles.some((role) =>
    role === "platform_admin" || role === "expert_admin" || role === "curriculum_manager"
  );
  return managesAll || version.ownerUserId === context.userId;
}

export function updateDraft(input: {
  context: ExpertContext;
  current: SkillVersion;
  expectedVersion: number;
  content: SkillDraftContent;
  now: string;
}) {
  requireScope(input.context, input.current);
  requirePermission(input.context, "skill:update");
  if (input.current.status === "published") throw new SkillDomainError("IMMUTABLE_PUBLISHED_VERSION");
  if (input.current.status !== "draft") throw new SkillDomainError("INVALID_STATE_TRANSITION");
  if (input.current.version !== input.expectedVersion) throw new SkillDomainError("VERSION_CONFLICT", "Stale skill version");
  if (!canEdit(input.context, input.current)) throw new SkillDomainError("MISSING_PERMISSION");
  return {
    ...input.current,
    ...validateSkillDraft(input.content),
    version: input.current.version + 1,
    updatedAt: input.now,
    updatedBy: input.context.userId
  };
}

export function submitForReview(input: {
  context: ExpertContext;
  current: SkillVersion;
  expectedVersion: number;
  now: string;
}) {
  requireScope(input.context, input.current);
  requirePermission(input.context, "skill:update");
  if (input.current.status !== "draft") throw new SkillDomainError("INVALID_STATE_TRANSITION");
  if (input.current.version !== input.expectedVersion) throw new SkillDomainError("VERSION_CONFLICT");
  if (!canEdit(input.context, input.current)) throw new SkillDomainError("MISSING_PERMISSION");
  return {
    ...input.current,
    status: "in_review" as const,
    submittedAt: input.now,
    submittedBy: input.context.userId,
    reviewDecision: undefined,
    reviewNote: undefined,
    version: input.current.version + 1,
    updatedAt: input.now,
    updatedBy: input.context.userId
  };
}

export function requestChanges(input: {
  context: ExpertContext;
  current: SkillVersion;
  expectedVersion: number;
  note: string;
  now: string;
}) {
  requireScope(input.context, input.current);
  requirePermission(input.context, "skill:review");
  if (input.current.status !== "in_review") throw new SkillDomainError("INVALID_STATE_TRANSITION");
  if (input.current.version !== input.expectedVersion) throw new SkillDomainError("VERSION_CONFLICT");
  const note = input.note.normalize("NFKC").trim();
  if (note.length < 3 || note.length > 1000 || /[<>]/u.test(note)) {
    throw new SkillDomainError("VALIDATION_ERROR", "Invalid review note");
  }
  return {
    ...input.current,
    status: "draft" as const,
    reviewedAt: input.now,
    reviewedBy: input.context.userId,
    reviewDecision: "changes_requested" as const,
    reviewNote: note,
    version: input.current.version + 1,
    updatedAt: input.now,
    updatedBy: input.context.userId
  };
}

export function publishVersion(input: {
  context: ExpertContext;
  current: SkillVersion;
  expectedVersion: number;
  now: string;
}) {
  requireScope(input.context, input.current);
  requirePermission(input.context, "skill:publish");
  requirePermission(input.context, "skill:review");
  if (input.current.status !== "in_review") throw new SkillDomainError("INVALID_STATE_TRANSITION");
  if (input.current.version !== input.expectedVersion) throw new SkillDomainError("VERSION_CONFLICT");
  if (input.current.createdBy === input.context.userId) {
    throw new SkillDomainError("REVIEWER_REQUIRED", "A different reviewer must publish this version");
  }
  return {
    ...input.current,
    status: "published" as const,
    reviewedAt: input.now,
    reviewedBy: input.context.userId,
    reviewDecision: "approved" as const,
    publishedAt: input.now,
    publishedBy: input.context.userId,
    version: input.current.version + 1,
    updatedAt: input.now,
    updatedBy: input.context.userId
  };
}

export function createNextDraft(input: {
  context: ExpertContext;
  published: SkillVersion;
  id: string;
  now: string;
}) {
  requireScope(input.context, input.published);
  requirePermission(input.context, "skill:update");
  if (input.published.status !== "published") throw new SkillDomainError("INVALID_STATE_TRANSITION");
  return {
    ...input.published,
    id: input.id,
    versionNumber: input.published.versionNumber + 1,
    status: "draft" as const,
    submittedAt: undefined,
    submittedBy: undefined,
    reviewedAt: undefined,
    reviewedBy: undefined,
    reviewDecision: undefined,
    reviewNote: undefined,
    publishedAt: undefined,
    publishedBy: undefined,
    version: 1,
    createdAt: input.now,
    createdBy: input.context.userId,
    updatedAt: input.now,
    updatedBy: input.context.userId
  } satisfies SkillVersion;
}
