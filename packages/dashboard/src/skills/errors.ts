export type SkillErrorCode =
  | "VALIDATION_ERROR"
  | "MISSING_PERMISSION"
  | "OUTSIDE_EXPERT"
  | "VERSION_CONFLICT"
  | "INVALID_STATE_TRANSITION"
  | "IMMUTABLE_PUBLISHED_VERSION"
  | "REVIEWER_REQUIRED"
  | "QUOTA_EXCEEDED";

export class SkillDomainError extends Error {
  constructor(readonly code: SkillErrorCode, message: string = code) {
    super(message);
    this.name = "SkillDomainError";
  }
}
