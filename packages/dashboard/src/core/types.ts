export type ExpertStatus = "active" | "suspended" | "archived";
export type MembershipStatus = "invited" | "active" | "suspended" | "revoked";
export type MembershipTier = "free" | "pro" | "enterprise";

export type ExpertRole =
  | "platform_admin"
  | "expert_admin"
  | "curriculum_manager"
  | "instructor"
  | "reviewer"
  | "learner"
  | "auditor";

export type Permission =
  | "identity:read_self"
  | "expert:manage_members"
  | "skill:read"
  | "skill:create"
  | "skill:update"
  | "skill:review"
  | "skill:publish"
  | "course:read"
  | "course:create"
  | "course:update"
  | "course:approve"
  | "course:publish"
  | "progress:read_self"
  | "progress:update_self"
  | "report:read"
  | "report:export"
  | "audit:read";

export interface Expert {
  id: string;
  slug: string;
  displayName: string;
  status: ExpertStatus;
  ownerUserId: string;
  level: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ExpertMembership {
  id: string;
  expertId: string;
  userId: string;
  status: MembershipStatus;
  roles: ExpertRole[];
  tier: MembershipTier;
  invitedBy?: string;
  joinedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ExpertContext {
  userId: string;
  expertId: string;
  membershipId: string;
  roles: ExpertRole[];
  permissions: Permission[];
}

export interface DashboardMe {
  user: { id: string; displayName: string };
  activeExpert: { id: string; displayName: string; level: number };
  memberships: Array<{
    expertId: string;
    expertDisplayName: string;
    roles: ExpertRole[];
    status: MembershipStatus;
    tier: MembershipTier;
  }>;
  permissions: Permission[];
}

export type DenyCode =
  | "UNAUTHENTICATED"
  | "NOT_MEMBER"
  | "MEMBERSHIP_INACTIVE"
  | "MISSING_PERMISSION"
  | "OUTSIDE_EXPERT"
  | "RESOURCE_NOT_ASSIGNED";

export interface DashboardErrorBody {
  error: {
    code: DenyCode | "VALIDATION_ERROR" | "VERSION_CONFLICT" | "MUTATIONS_DISABLED" | "BOOTSTRAP_DISABLED" | "BOOTSTRAP_UNAVAILABLE" | "INTERNAL_ERROR";
    message: string;
    requestId: string;
  };
}

export interface AuditEvent {
  eventId: string;
  occurredAt: string;
  requestId: string;
  actorUserId: string;
  expertId: string;
  action: string;
  targetType: string;
  targetId: string;
  result: "allowed" | "denied" | "failed";
  beforeHash?: string;
  afterHash?: string;
}

export interface Level0BootstrapResult {
  expert: Expert;
  membership: ExpertMembership;
  created: boolean;
}
