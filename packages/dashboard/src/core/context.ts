import type { DashboardRepository } from "../data/repositories";
import { permissionsForRoles } from "./policy";
import type { DashboardMe, ExpertContext } from "./types";

export class DashboardContractError extends Error {
  constructor(
    readonly code: "NOT_MEMBER" | "MEMBERSHIP_INACTIVE",
    readonly status: 403
  ) {
    super(code);
  }
}

export async function resolveDashboardMe(input: {
  user: { id: string; displayName: string };
  requestedExpertId?: string;
  repository: DashboardRepository;
}): Promise<{ me: DashboardMe; context: ExpertContext }> {
  const memberships = await input.repository.listMembershipsByUser(input.user.id);
  if (memberships.length === 0 && input.repository.getLevel0ExpertIdByUser) {
    const level0ExpertId = await input.repository.getLevel0ExpertIdByUser(input.user.id);
    if (level0ExpertId) {
      const level0Membership = await input.repository.getMembership(level0ExpertId, input.user.id);
      if (level0Membership) memberships.push(level0Membership);
    }
  }
  const activeMemberships = memberships.filter((membership) => membership.status === "active");
  if (activeMemberships.length === 0) throw new DashboardContractError("NOT_MEMBER", 403);

  const selected = input.requestedExpertId
    ? memberships.find((membership) => membership.expertId === input.requestedExpertId)
    : activeMemberships[0];
  if (!selected) throw new DashboardContractError("NOT_MEMBER", 403);
  if (selected.status !== "active") throw new DashboardContractError("MEMBERSHIP_INACTIVE", 403);

  const expert = await input.repository.getExpert(selected.expertId);
  if (!expert || expert.status !== "active") throw new DashboardContractError("MEMBERSHIP_INACTIVE", 403);
  const permissions = permissionsForRoles(selected.roles);
  const context: ExpertContext = {
    userId: input.user.id,
    expertId: expert.id,
    membershipId: selected.id,
    roles: selected.roles,
    permissions
  };

  const visibleMemberships = await Promise.all(activeMemberships.map(async (membership) => {
    const membershipExpert = await input.repository.getExpert(membership.expertId);
    return membershipExpert?.status === "active"
      ? {
          expertId: membership.expertId,
          expertDisplayName: membershipExpert.displayName,
          roles: membership.roles,
          status: membership.status,
          tier: membership.tier
        }
      : null;
  }));

  return {
    context,
    me: {
      user: input.user,
      activeExpert: { id: expert.id, displayName: expert.displayName, level: expert.level },
      memberships: visibleMemberships.filter((item): item is NonNullable<typeof item> => item !== null),
      permissions
    }
  };
}
