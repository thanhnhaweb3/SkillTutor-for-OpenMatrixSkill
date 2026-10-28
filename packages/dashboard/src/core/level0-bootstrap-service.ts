import { randomUUID } from "node:crypto";
import type { Level0BootstrapRepository } from "../data/repositories";
import type { AuditEvent, Expert, ExpertMembership, Level0BootstrapResult } from "./types";

export class Level0BootstrapError extends Error {
  constructor(readonly code: "BOOTSTRAP_INCONSISTENT") {
    super(code);
  }
}

async function resolveExisting(repository: Level0BootstrapRepository, userId: string): Promise<Level0BootstrapResult | null> {
  const active = (await repository.listMembershipsByUser(userId))
    .find((membership) => membership.status === "active");
  if (active) {
    const expert = await repository.getExpert(active.expertId);
    if (expert?.status === "active") return { expert, membership: active, created: false };
  }

  const lockedExpertId = await repository.getLevel0ExpertIdByUser(userId);
  if (!lockedExpertId) return null;
  const [expert, membership] = await Promise.all([
    repository.getExpert(lockedExpertId),
    repository.getMembership(lockedExpertId, userId)
  ]);
  if (!expert || !membership || expert.status !== "active" || membership.status !== "active") {
    throw new Level0BootstrapError("BOOTSTRAP_INCONSISTENT");
  }
  return { expert, membership, created: false };
}

export class Level0BootstrapService {
  constructor(
    private readonly repository: Level0BootstrapRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID
  ) {}

  async bootstrap(input: { userId: string; requestId: string }): Promise<Level0BootstrapResult> {
    const userId = input.userId.trim();
    if (!userId) throw new Level0BootstrapError("BOOTSTRAP_INCONSISTENT");

    const existing = await resolveExisting(this.repository, userId);
    if (existing) return existing;

    const timestamp = this.now().toISOString();
    const opaqueId = this.uuid();
    const suffix = opaqueId.replaceAll("-", "").slice(0, 12);
    const expertId = `expert_l0_${opaqueId}`;
    const membershipId = `membership_${this.uuid()}`;
    const expert: Expert = {
      id: expertId,
      slug: `level-0-${suffix}`,
      displayName: "Level 0",
      status: "active",
      ownerUserId: userId,
      level: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1
    };
    const membership: ExpertMembership = {
      id: membershipId,
      expertId,
      userId,
      status: "active",
      roles: ["expert_admin", "learner"],
      tier: "free",
      joinedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1
    };
    const audit: AuditEvent = {
      eventId: `audit_${this.uuid()}`,
      occurredAt: timestamp,
      requestId: input.requestId,
      actorUserId: userId,
      expertId,
      action: "expert:bootstrap_level_0_free",
      targetType: "expert",
      targetId: expertId,
      result: "allowed"
    };

    try {
      await this.repository.commitLevel0Bootstrap({ expert, membership, audit });
      return { expert, membership, created: true };
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TransactionCanceledException") throw error;
      const raced = await resolveExisting(this.repository, userId);
      if (raced) return raced;
      throw new Level0BootstrapError("BOOTSTRAP_INCONSISTENT");
    }
  }
}
