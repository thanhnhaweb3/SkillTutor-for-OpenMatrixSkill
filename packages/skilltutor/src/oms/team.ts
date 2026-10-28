import { randomUUID } from "node:crypto";
import { MembershipService, type DashboardRepository, type ExpertContext, type ExpertMembership, type ExpertRole } from "@openmatrix/dashboard";
import { canMutateMemberships } from "./admission";

/**
 * Expert team (staff) management for the learners admin page: give an existing account a staff role by email
 * (e.g. hackathon judges as reviewers) and take it away again. Every write goes through MembershipService,
 * so expert:manage_members, the "only admins grant admin" rule, the last-admin guard and the audit log apply.
 */
export const TEAM_ROLES = ["reviewer", "auditor", "instructor", "curriculum_manager", "expert_admin"] as const satisfies readonly ExpertRole[];
export type TeamRole = (typeof TEAM_ROLES)[number];
export type TeamAddOutcome = "added" | "already_member" | "membership_revoked";
export type TeamRemoveOutcome = "removed" | "not_member" | "self";

const STAFF = new Set<ExpertRole>([...TEAM_ROLES, "platform_admin"]);
export const isStaff = (m: ExpertMembership) => m.status === "active" && m.roles.some((r) => STAFF.has(r));

function service(dashboard: DashboardRepository) {
  if (!canMutateMemberships(dashboard)) throw Object.assign(new Error("Membership changes need DASHBOARD_STORE=dynamodb"), { code: "MUTATIONS_DISABLED" });
  return new MembershipService(dashboard);
}
const rid = () => `team_${randomUUID()}`;

export async function addTeamMember(dashboard: DashboardRepository, actor: ExpertContext, userId: string, role: TeamRole): Promise<TeamAddOutcome> {
  const current = await dashboard.getMembership(actor.expertId, userId);
  if (current?.status === "revoked") return "membership_revoked";
  if (current?.status === "active" && current.roles.includes(role)) return "already_member";
  const members = service(dashboard);
  let m: ExpertMembership;
  if (!current) {
    m = await members.invite({ context: actor, userId, roles: [role], requestId: rid() });
  } else {
    // A suspended (previously removed) member comes back with only the new role, not the staff roles they had before.
    const keep = current.status === "active" ? current.roles : current.roles.filter((r) => !STAFF.has(r));
    m = await members.assignRoles({ context: actor, userId, roles: [...keep, role], expectedVersion: current.version, requestId: rid() });
  }
  if (m.status !== "active") await members.changeStatus({ context: actor, userId, status: "active", expectedVersion: m.version, requestId: rid() });
  return "added";
}

/** Drops every staff role; a member with nothing left (no learner role) is suspended so they lose Expert access. */
export async function removeTeamMember(dashboard: DashboardRepository, actor: ExpertContext, userId: string): Promise<TeamRemoveOutcome> {
  if (userId === actor.userId) return "self";
  const current = await dashboard.getMembership(actor.expertId, userId);
  if (!current || !isStaff(current)) return "not_member";
  if (current.roles.includes("platform_admin")) throw Object.assign(new Error("Platform admins are managed outside the Expert"), { code: "MISSING_PERMISSION" });
  const members = service(dashboard);
  const rest = current.roles.filter((r) => !STAFF.has(r));
  if (rest.length) await members.assignRoles({ context: actor, userId, roles: rest, expectedVersion: current.version, requestId: rid() });
  else await members.changeStatus({ context: actor, userId, status: "suspended", expectedVersion: current.version, requestId: rid() });
  return "removed";
}
