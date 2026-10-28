import type { AuditEvent } from "../core/types";
import type { Cohort, Enrollment, LearnerProgress } from "./types";
export interface DeliveryPage<T> { items: T[]; cursor?: string }
export interface DeliveryRepository {
  getCohort(expertId: string, cohortId: string): Promise<Cohort | null>;
  listCohorts(input: { expertId: string; courseId?: string; cursor?: string; limit: number }): Promise<DeliveryPage<Cohort>>;
  getActiveCohortCount(expertId: string): Promise<number>;
  getEnrollment(expertId: string, cohortId: string, userId: string): Promise<Enrollment | null>;
  /** All enrollments of one learner across Experts (used by SkillTutor to find a learner's cohorts). */
  listEnrollmentsByUser?(userId: string): Promise<Enrollment[]>;
  /** Roster of one cohort (used by the SkillTutor learner admin page). */
  listEnrollmentsByCohort?(expertId: string, cohortId: string): Promise<Enrollment[]>;
  getSelfProgress(expertId: string, cohortId: string, userId: string): Promise<LearnerProgress | null>;
  commitCreateCohort(input: { cohort: Cohort; audit: AuditEvent }): Promise<void>;
  commitCreateEnrollment(input: { enrollment: Enrollment; progress: LearnerProgress; audit: AuditEvent }): Promise<void>;
  commitProgress(input: { previous: LearnerProgress; next: LearnerProgress; enrollment?: { previous: Enrollment; next: Enrollment }; audit: AuditEvent }): Promise<void>;
}
