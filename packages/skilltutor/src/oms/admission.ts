import { randomUUID } from "node:crypto";
import {
  DeliveryService,
  MembershipService,
  type CourseRepository,
  type DashboardRepository,
  type DeliveryRepository,
  type ExpertContext,
  type MembershipMutationRepository
} from "@openmatrix/dashboard";

/**
 * Admits a learner into a cohort the way an Expert admin would by hand:
 * 1. make sure the user is an active member of the Expert (invite as learner → activate; re-activate if suspended),
 * 2. enroll them through DeliveryService (pins the cohort's published CourseVersion and creates progress).
 * Every write goes through the OMS services, so permissions (expert:manage_members) and the audit log apply.
 */
export type AdmitOutcome = "enrolled" | "already_enrolled" | "membership_revoked" | "cohort_closed";

export interface AdmissionDeps { dashboard: DashboardRepository; courses: CourseRepository; delivery: DeliveryRepository }

export const canMutateMemberships = (repo: DashboardRepository): repo is MembershipMutationRepository =>
  typeof (repo as Partial<MembershipMutationRepository>).commitMembershipMutation === "function";

export async function admitLearner(deps: AdmissionDeps, actor: ExpertContext, input: { cohortId: string; userId: string }): Promise<{ outcome: AdmitOutcome; membershipCreated: boolean }> {
  const cohort = await deps.delivery.getCohort(actor.expertId, input.cohortId);
  if (!cohort) throw Object.assign(new Error("Cohort not found in this Expert"), { code: "OUTSIDE_EXPERT" });
  if (cohort.status !== "active") return { outcome: "cohort_closed", membershipCreated: false };
  if (await deps.delivery.getEnrollment(actor.expertId, cohort.id, input.userId)) return { outcome: "already_enrolled", membershipCreated: false };

  let membership = await deps.dashboard.getMembership(actor.expertId, input.userId);
  let membershipCreated = false;
  if (!membership || membership.status !== "active") {
    if (membership?.status === "revoked") return { outcome: "membership_revoked", membershipCreated: false };
    if (!canMutateMemberships(deps.dashboard)) throw Object.assign(new Error("Membership changes need DASHBOARD_STORE=dynamodb"), { code: "MUTATIONS_DISABLED" });
    const members = new MembershipService(deps.dashboard);
    if (!membership) {
      membership = await members.invite({ context: actor, userId: input.userId, roles: ["learner"], requestId: `admit_${randomUUID()}` });
      membershipCreated = true;
    }
    membership = await members.changeStatus({ context: actor, userId: input.userId, status: "active", expectedVersion: membership.version, requestId: `admit_${randomUUID()}` });
  }
  await new DeliveryService(deps.delivery, deps.courses, deps.dashboard).enroll({ context: actor, cohortId: cohort.id, userId: input.userId, requestId: `admit_${randomUUID()}` });
  return { outcome: "enrolled", membershipCreated };
}
