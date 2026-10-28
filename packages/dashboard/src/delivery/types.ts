export type CohortStatus = "draft" | "active" | "closed";
export type EnrollmentStatus = "active" | "revoked" | "completed";
export interface Cohort { id: string; expertId: string; name: string; courseId: string; courseVersionId: string; courseVersionNumber: number;
  startDate: string; endDate?: string; status: CohortStatus; version: number; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string }
export interface Enrollment { id: string; expertId: string; cohortId: string; courseId: string; courseVersionId: string; userId: string;
  status: EnrollmentStatus; enrolledAt: string; enrolledBy: string; revokedAt?: string; revokedBy?: string; version: number }
export interface LearnerProgress { expertId: string; cohortId: string; courseId: string; courseVersionId: string; userId: string;
  completedLessonIds: string[]; requiredLessonCount: number; completedLessonCount: number; percentComplete: number; courseCompletedAt?: string;
  version: number; createdAt: string; updatedAt: string }
