import type { AuditEvent } from "../core/types";
import { DeliveryDomainError } from "./errors";
import type { DeliveryRepository } from "./repository";
import type { Cohort, Enrollment, LearnerProgress } from "./types";
export class InMemoryDeliveryRepository implements DeliveryRepository {
  readonly audits: AuditEvent[] = []; private readonly cohorts: Cohort[]; private readonly enrollments: Enrollment[]; private readonly progress: LearnerProgress[];
  constructor(seed: { cohorts?: Cohort[]; enrollments?: Enrollment[]; progress?: LearnerProgress[] } = {}) { this.cohorts = structuredClone(seed.cohorts ?? []); this.enrollments = structuredClone(seed.enrollments ?? []); this.progress = structuredClone(seed.progress ?? []); }
  async getCohort(expertId: string, cohortId: string) { return structuredClone(this.cohorts.find((x) => x.expertId === expertId && x.id === cohortId) ?? null); }
  async listCohorts(input: { expertId: string; courseId?: string; cursor?: string; limit: number }) { const offset = cursor(input.cursor, input.limit), matches = this.cohorts.filter((x) => x.expertId === input.expertId && (!input.courseId || x.courseId === input.courseId)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const items = matches.slice(offset, offset + input.limit); return { items: structuredClone(items), cursor: offset + items.length < matches.length ? String(offset + items.length) : undefined }; }
  async getActiveCohortCount(expertId: string) { return this.cohorts.filter((x) => x.expertId === expertId && x.status === "active").length; }
  async getEnrollment(expertId: string, cohortId: string, userId: string) { return structuredClone(this.enrollments.find((x) => x.expertId === expertId && x.cohortId === cohortId && x.userId === userId) ?? null); }
  async listEnrollmentsByUser(userId: string) { return structuredClone(this.enrollments.filter((x) => x.userId === userId)); }
  async listEnrollmentsByCohort(expertId: string, cohortId: string) { return structuredClone(this.enrollments.filter((x) => x.expertId === expertId && x.cohortId === cohortId)); }
  async getSelfProgress(expertId: string, cohortId: string, userId: string) { return structuredClone(this.progress.find((x) => x.expertId === expertId && x.cohortId === cohortId && x.userId === userId) ?? null); }
  async commitCreateCohort(input: { cohort: Cohort; audit: AuditEvent }) { if (this.cohorts.some((x) => x.expertId === input.cohort.expertId && x.id === input.cohort.id)) throw conflict(); this.cohorts.push(structuredClone(input.cohort)); this.audits.push(structuredClone(input.audit)); }
  async commitCreateEnrollment(input: { enrollment: Enrollment; progress: LearnerProgress; audit: AuditEvent }) { if (this.enrollments.some((x) => x.expertId === input.enrollment.expertId && x.cohortId === input.enrollment.cohortId && x.userId === input.enrollment.userId) || input.progress.userId !== input.enrollment.userId) throw conflict();
    this.enrollments.push(structuredClone(input.enrollment)); this.progress.push(structuredClone(input.progress)); this.audits.push(structuredClone(input.audit)); }
  async commitProgress(input: { previous: LearnerProgress; next: LearnerProgress; enrollment?: { previous: Enrollment; next: Enrollment }; audit: AuditEvent }) { const pi = this.progress.findIndex((x) => x.expertId === input.previous.expertId && x.cohortId === input.previous.cohortId && x.userId === input.previous.userId);
    if (pi < 0 || this.progress[pi].version !== input.previous.version || input.next.userId !== input.previous.userId || input.next.expertId !== input.previous.expertId) throw conflict();
    if (input.enrollment) { const ei = this.enrollments.findIndex((x) => x.expertId === input.enrollment!.previous.expertId && x.cohortId === input.enrollment!.previous.cohortId && x.userId === input.enrollment!.previous.userId);
      if (ei < 0 || this.enrollments[ei].version !== input.enrollment.previous.version) throw conflict(); this.enrollments[ei] = structuredClone(input.enrollment.next); }
    this.progress[pi] = structuredClone(input.next); this.audits.push(structuredClone(input.audit)); }
}
function cursor(value: string | undefined, limit: number) { const offset = value ? Number.parseInt(value, 10) : 0; if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new DeliveryDomainError("VALIDATION_ERROR"); return offset; }
function conflict() { const e = new Error("Delivery transaction conflict"); e.name = "TransactionCanceledException"; return e; }
