export type CourseErrorCode =
  | "VALIDATION_ERROR"
  | "MISSING_PERMISSION"
  | "OUTSIDE_EXPERT"
  | "VERSION_CONFLICT"
  | "INVALID_STATE_TRANSITION"
  | "IMMUTABLE_PUBLISHED_VERSION"
  | "REVIEWER_REQUIRED"
  | "QUOTA_EXCEEDED";

export class CourseDomainError extends Error {
  constructor(readonly code: CourseErrorCode, message: string = code) {
    super(message);
    this.name = "CourseDomainError";
  }
}
