import { randomUUID } from "node:crypto";
import type { MembershipMutationRepository } from "../data/repositories";
import { authorize } from "./policy";
import type { AuditEvent, ExpertContext, ExpertMembership, ExpertRole, MembershipStatus } from "./types";

export class MembershipMutationError extends Error {
  constructor(readonly code: "MISSING_PERMISSION" | "OUTSIDE_EXPERT" | "VALIDATION_ERROR" | "VERSION_CONFLICT") {
    super(code);
  }
}

const transitions: Record<MembershipStatus, readonly MembershipStatus[]> = {
  invited: ["active", "revoked"],
  active: ["suspended", "revoked"],
  suspended: ["active", "revoked"],
  revoked: []
};

function isActiveAdmin(membership: ExpertMembership | null) {
  return membership?.status === "active" && membership.roles.includes("expert_admin");
}

function adminDelta(previous: ExpertMembership | null, next: ExpertMembership): -1 | 0 | 1 {
  const before = isActiveAdmin(previous);
  const after = isActiveAdmin(next);
  return before === after ? 0 : after ? 1 : -1;
}

function requireManager(context: ExpertContext, expertId: string, roles: readonly ExpertRole[]) {
  if (context.expertId !== expertId) throw new MembershipMutationError("OUTSIDE_EXPERT");
  if (!authorize(context, "expert:manage_members").allowed) {
    throw new MembershipMutationError("MISSING_PERMISSION");
  }
  if (roles.includes("platform_admin")) throw new MembershipMutationError("MISSING_PERMISSION");
  if (roles.includes("expert_admin") && !context.roles.some((role) => role === "expert_admin" || role === "platform_admin")) {
    throw new MembershipMutationError("MISSING_PERMISSION");
  }
}

function audit(input: {
  context: ExpertContext;
  requestId: string;
  action: string;
  membershipId: string;
  now: string;
}): AuditEvent {
  return {
    eventId: `audit_${randomUUID()}`,
    occurredAt: input.now,
    requestId: input.requestId,
    actorUserId: input.context.userId,
    expertId: input.context.expertId,
    action: input.action,
    targetType: "expert_membership",
    targetId: input.membershipId,
    result: "allowed"
  };
}

export class MembershipService {
  constructor(private readonly repository: MembershipMutationRepository) {}

  async invite(input: {
    context: ExpertContext;
    userId: string;
    roles: ExpertRole[];
    requestId: string;
  }) {
    requireManager(input.context, input.context.expertId, input.roles);
    if (!input.userId.trim() || input.roles.length === 0) throw new MembershipMutationError("VALIDATION_ERROR");
    const existing = await this.repository.getMembership(input.context.expertId, input.userId);
    if (existing) throw new MembershipMutationError("VERSION_CONFLICT");
    const now = new Date().toISOString();
    const membership: ExpertMembership = {
      id: `membership_${randomUUID()}`,
      expertId: input.context.expertId,
      userId: input.userId,
      status: "invited",
      roles: [...new Set(input.roles)],
      tier: "free",
      invitedBy: input.context.userId,
      createdAt: now,
      updatedAt: now,
      version: 1
    };
    await this.repository.commitMembershipMutation({
      previous: null,
      next: membership,
      expectedVersion: null,
      activeAdminDelta: 0,
      audit: audit({ context: input.context, requestId: input.requestId, action: "membership:invite", membershipId: membership.id, now })
    });
    return membership;
  }

  async changeStatus(input: {
    context: ExpertContext;
    userId: string;
    status: MembershipStatus;
    expectedVersion: number;
    requestId: string;
  }) {
    const current = await this.repository.getMembership(input.context.expertId, input.userId);
    if (!current || current.version !== input.expectedVersion) throw new MembershipMutationError("VERSION_CONFLICT");
    requireManager(input.context, current.expertId, current.roles);
    if (!transitions[current.status].includes(input.status)) throw new MembershipMutationError("VALIDATION_ERROR");
    const now = new Date().toISOString();
    const next: ExpertMembership = {
      ...current,
      status: input.status,
      joinedAt: input.status === "active" ? current.joinedAt ?? now : current.joinedAt,
      updatedAt: now,
      version: current.version + 1
    };
    await this.repository.commitMembershipMutation({
      previous: current,
      next,
      expectedVersion: current.version,
      activeAdminDelta: adminDelta(current, next),
      audit: audit({ context: input.context, requestId: input.requestId, action: `membership:${input.status}`, membershipId: current.id, now })
    });
    return next;
  }

  async assignRoles(input: {
    context: ExpertContext;
    userId: string;
    roles: ExpertRole[];
    expectedVersion: number;
    requestId: string;
  }) {
    if (input.roles.length === 0) throw new MembershipMutationError("VALIDATION_ERROR");
    const current = await this.repository.getMembership(input.context.expertId, input.userId);
    if (!current || current.version !== input.expectedVersion) throw new MembershipMutationError("VERSION_CONFLICT");
    requireManager(input.context, current.expertId, input.roles);
    const now = new Date().toISOString();
    const next = { ...current, roles: [...new Set(input.roles)], updatedAt: now, version: current.version + 1 };
    await this.repository.commitMembershipMutation({
      previous: current,
      next,
      expectedVersion: current.version,
      activeAdminDelta: adminDelta(current, next),
      audit: audit({ context: input.context, requestId: input.requestId, action: "membership:assign_roles", membershipId: current.id, now })
    });
    return next;
  }
}
