import type { AuditEvent, Expert, ExpertMembership } from "../core/types";

export interface DashboardRepository {
  getExpert(expertId: string): Promise<Expert | null>;
  getMembership(expertId: string, userId: string): Promise<ExpertMembership | null>;
  listMembershipsByUser(userId: string): Promise<ExpertMembership[]>;
  /** Every membership of one Expert (team / roster screens). */
  listMembershipsByExpert?(expertId: string): Promise<ExpertMembership[]>;
  getLevel0ExpertIdByUser?(userId: string): Promise<string | null>;
}

export interface DashboardData {
  experts: Expert[];
  memberships: ExpertMembership[];
}

export interface MembershipMutationInput {
  previous: ExpertMembership | null;
  next: ExpertMembership;
  expectedVersion: number | null;
  activeAdminDelta: -1 | 0 | 1;
  audit: AuditEvent;
}

export interface MembershipMutationRepository extends DashboardRepository {
  commitMembershipMutation(input: MembershipMutationInput): Promise<void>;
}

export interface Level0BootstrapInput {
  expert: Expert;
  membership: ExpertMembership;
  audit: AuditEvent;
}

export interface Level0BootstrapRepository extends DashboardRepository {
  getLevel0ExpertIdByUser(userId: string): Promise<string | null>;
  commitLevel0Bootstrap(input: Level0BootstrapInput): Promise<void>;
}

export class InMemoryDashboardRepository implements Level0BootstrapRepository, MembershipMutationRepository {
  private readonly level0Locks = new Map<string, string>();
  readonly adminGuards = new Map<string, number>();
  readonly audits: AuditEvent[] = [];
  constructor(private readonly data: DashboardData = { experts: [], memberships: [] }) {}

  async getExpert(expertId: string) {
    return this.data.experts.find((expert) => expert.id === expertId) ?? null;
  }

  async getMembership(expertId: string, userId: string) {
    return this.data.memberships.find(
      (membership) => membership.expertId === expertId && membership.userId === userId
    ) ?? null;
  }

  async listMembershipsByUser(userId: string) {
    return this.data.memberships.filter((membership) => membership.userId === userId);
  }

  async listMembershipsByExpert(expertId: string) {
    return this.data.memberships.filter((membership) => membership.expertId === expertId);
  }

  async getLevel0ExpertIdByUser(userId: string) {
    return this.level0Locks.get(userId) ?? null;
  }

  async commitLevel0Bootstrap(input: Level0BootstrapInput) {
    if (this.level0Locks.has(input.membership.userId) ||
        this.data.experts.some((expert) => expert.id === input.expert.id) ||
        this.data.memberships.some((membership) => membership.expertId === input.expert.id && membership.userId === input.membership.userId)) {
      const error = new Error("Level 0 bootstrap conflict");
      error.name = "TransactionCanceledException";
      throw error;
    }
    this.data.experts.push(input.expert);
    this.data.memberships.push(input.membership);
    this.level0Locks.set(input.membership.userId, input.expert.id);
    this.adminGuards.set(input.expert.id, 1);
    this.audits.push(input.audit);
  }

  async commitMembershipMutation(input: MembershipMutationInput) {
    const expert = this.data.experts.find((item) => item.id === input.next.expertId);
    const membershipIndex = this.data.memberships.findIndex(
      (item) => item.expertId === input.next.expertId && item.userId === input.next.userId
    );
    const current = membershipIndex >= 0 ? this.data.memberships[membershipIndex] : null;
    const activeAdminCount = this.adminGuards.get(input.next.expertId) ?? 0;
    const conflicts = !expert || expert.status !== "active" ||
      (input.previous === null
        ? current !== null
        : current === null || current.version !== input.expectedVersion) ||
      (input.activeAdminDelta === -1 && activeAdminCount <= 1);

    if (conflicts) {
      const error = new Error("Membership mutation conflict");
      error.name = "TransactionCanceledException";
      throw error;
    }

    if (membershipIndex >= 0) this.data.memberships[membershipIndex] = input.next;
    else this.data.memberships.push(input.next);
    if (input.activeAdminDelta !== 0) {
      this.adminGuards.set(input.next.expertId, activeAdminCount + input.activeAdminDelta);
    }
    this.audits.push(input.audit);
  }
}
