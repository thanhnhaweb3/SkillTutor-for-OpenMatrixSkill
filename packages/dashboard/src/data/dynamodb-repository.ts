import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Expert, ExpertMembership, ExpertRole, ExpertStatus, MembershipStatus, MembershipTier } from "../core/types";
import type {
  DashboardRepository,
  Level0BootstrapInput,
  Level0BootstrapRepository,
  MembershipMutationInput,
  MembershipMutationRepository
} from "./repositories";

const EXPERT_STATUSES = new Set<ExpertStatus>(["active", "suspended", "archived"]);
const MEMBERSHIP_STATUSES = new Set<MembershipStatus>(["invited", "active", "suspended", "revoked"]);
const MEMBERSHIP_TIERS = new Set<MembershipTier>(["free", "pro", "enterprise"]);
const EXPERT_ROLES = new Set<ExpertRole>([
  "platform_admin", "expert_admin", "curriculum_manager", "instructor", "reviewer", "learner", "auditor"
]);

function expertKey(expertId: string) {
  return { pk: `EXPERT#${expertId}`, sk: "META" };
}

function membershipKey(expertId: string, userId: string) {
  return { pk: `EXPERT#${expertId}`, sk: `MEMBER#${userId}` };
}

function toExpert(item: Record<string, unknown> | undefined): Expert | null {
  if (!item || item.entityType !== "EXPERT") return null;
  if (
    typeof item.id !== "string" || typeof item.slug !== "string" ||
    typeof item.displayName !== "string" || typeof item.status !== "string" ||
    !EXPERT_STATUSES.has(item.status as ExpertStatus) || typeof item.ownerUserId !== "string" ||
    typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" ||
    typeof item.version !== "number"
  ) return null;
  return {
    id: item.id,
    slug: item.slug,
    displayName: item.displayName,
    status: item.status as ExpertStatus,
    ownerUserId: item.ownerUserId,
    level: typeof item.level === "number" && Number.isInteger(item.level) && item.level >= 0 ? item.level : 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    version: item.version
  };
}

function toMembership(item: Record<string, unknown> | undefined): ExpertMembership | null {
  if (!item || item.entityType !== "EXPERT_MEMBERSHIP") return null;
  const roles = Array.isArray(item.roles)
    ? item.roles.filter((role): role is ExpertRole => typeof role === "string" && EXPERT_ROLES.has(role as ExpertRole))
    : [];
  if (
    typeof item.id !== "string" || typeof item.expertId !== "string" ||
    typeof item.userId !== "string" || typeof item.status !== "string" ||
    !MEMBERSHIP_STATUSES.has(item.status as MembershipStatus) ||
    typeof item.createdAt !== "string" || typeof item.updatedAt !== "string" ||
    typeof item.version !== "number" || roles.length === 0
  ) return null;
  return {
    id: item.id,
    expertId: item.expertId,
    userId: item.userId,
    status: item.status as MembershipStatus,
    roles,
    tier: typeof item.tier === "string" && MEMBERSHIP_TIERS.has(item.tier as MembershipTier)
      ? item.tier as MembershipTier
      : "free",
    invitedBy: typeof item.invitedBy === "string" ? item.invitedBy : undefined,
    joinedAt: typeof item.joinedAt === "string" ? item.joinedAt : undefined,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    version: item.version
  };
}

function membershipItem(membership: ExpertMembership) {
  return {
    ...membershipKey(membership.expertId, membership.userId),
    gsi1pk: `USER#${membership.userId}`,
    gsi1sk: `EXPERT#${membership.expertId}`,
    entityType: "EXPERT_MEMBERSHIP",
    ...membership
  };
}

function expertItem(expert: Expert) {
  return { ...expertKey(expert.id), entityType: "EXPERT", ...expert };
}

export class DynamoDbDashboardRepository implements DashboardRepository, MembershipMutationRepository, Level0BootstrapRepository {
  private readonly client: DynamoDBDocumentClient;

  constructor(private readonly config: { region: string; tableName: string; userIndexName?: string }) {
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }), {
      marshallOptions: { removeUndefinedValues: true }
    });
  }

  async getExpert(expertId: string) {
    const response = await this.client.send(new GetCommand({
      TableName: this.config.tableName,
      Key: expertKey(expertId),
      ConsistentRead: true
    }));
    return toExpert(response.Item as Record<string, unknown> | undefined);
  }

  async getMembership(expertId: string, userId: string) {
    const response = await this.client.send(new GetCommand({
      TableName: this.config.tableName,
      Key: membershipKey(expertId, userId),
      ConsistentRead: true
    }));
    return toMembership(response.Item as Record<string, unknown> | undefined);
  }

  async listMembershipsByUser(userId: string) {
    const memberships: ExpertMembership[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const response = await this.client.send(new QueryCommand({
        TableName: this.config.tableName,
        IndexName: this.config.userIndexName ?? "GSI1",
        KeyConditionExpression: "gsi1pk = :user",
        ExpressionAttributeValues: { ":user": `USER#${userId}` },
        ExclusiveStartKey: exclusiveStartKey
      }));
      for (const item of response.Items ?? []) {
        const membership = toMembership(item as Record<string, unknown>);
        if (membership) memberships.push(membership);
      }
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return memberships;
  }

  async listMembershipsByExpert(expertId: string) {
    const memberships: ExpertMembership[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const response = await this.client.send(new QueryCommand({
        TableName: this.config.tableName,
        KeyConditionExpression: "pk = :expert AND begins_with(sk, :member)",
        ExpressionAttributeValues: { ":expert": `EXPERT#${expertId}`, ":member": "MEMBER#" },
        ConsistentRead: true,
        ExclusiveStartKey: exclusiveStartKey
      }));
      for (const item of response.Items ?? []) {
        const membership = toMembership(item as Record<string, unknown>);
        if (membership) memberships.push(membership);
      }
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return memberships;
  }

  async getLevel0ExpertIdByUser(userId: string) {
    const response = await this.client.send(new GetCommand({
      TableName: this.config.tableName,
      Key: { pk: `USER#${userId}`, sk: "LEVEL0_EXPERT" },
      ConsistentRead: true
    }));
    return typeof response.Item?.expertId === "string" ? response.Item.expertId : null;
  }

  async commitLevel0Bootstrap(input: Level0BootstrapInput) {
    const auditTableName = process.env.DYNAMODB_DASHBOARD_AUDIT_TABLE?.trim();
    if (!auditTableName) throw new Error("DYNAMODB_DASHBOARD_AUDIT_TABLE is required for Level 0 bootstrap");
    const condition = "attribute_not_exists(pk) AND attribute_not_exists(sk)";
    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: this.config.tableName,
            Item: {
              pk: `USER#${input.membership.userId}`,
              sk: "LEVEL0_EXPERT",
              entityType: "LEVEL0_EXPERT_LOCK",
              userId: input.membership.userId,
              expertId: input.expert.id,
              createdAt: input.expert.createdAt
            },
            ConditionExpression: condition
          }
        },
        {
          Put: {
            TableName: this.config.tableName,
            Item: expertItem(input.expert),
            ConditionExpression: condition
          }
        },
        {
          Put: {
            TableName: this.config.tableName,
            Item: membershipItem(input.membership),
            ConditionExpression: condition
          }
        },
        {
          Put: {
            TableName: this.config.tableName,
            Item: {
              pk: `EXPERT#${input.expert.id}`,
              sk: "ADMIN_GUARD",
              entityType: "EXPERT_ADMIN_GUARD",
              activeAdminCount: 1,
              updatedAt: input.expert.updatedAt
            },
            ConditionExpression: condition
          }
        },
        {
          Put: {
            TableName: auditTableName,
            Item: {
              pk: `EXPERT#${input.audit.expertId}`,
              sk: `AUDIT#${input.audit.occurredAt}#${input.audit.eventId}`,
              entityType: "AUDIT_EVENT",
              ...input.audit
            },
            ConditionExpression: condition
          }
        }
      ]
    }));
  }

  async commitMembershipMutation(input: MembershipMutationInput) {
    const auditTableName = process.env.DYNAMODB_DASHBOARD_AUDIT_TABLE?.trim();
    if (!auditTableName) throw new Error("DYNAMODB_DASHBOARD_AUDIT_TABLE is required for membership mutations");
    const membershipPut = input.previous
      ? {
          Put: {
            TableName: this.config.tableName,
            Item: membershipItem(input.next),
            ConditionExpression: "#version = :expectedVersion",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":expectedVersion": input.expectedVersion }
          }
        }
      : {
          Put: {
            TableName: this.config.tableName,
            Item: membershipItem(input.next),
            ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
          }
        };
    const adminGuard = input.activeAdminDelta === 0
      ? []
      : [{
          Update: {
            TableName: this.config.tableName,
            Key: { pk: `EXPERT#${input.next.expertId}`, sk: "ADMIN_GUARD" },
            UpdateExpression: "ADD activeAdminCount :delta SET entityType = :entityType, updatedAt = :updatedAt",
            ConditionExpression: input.activeAdminDelta === -1 ? "activeAdminCount > :minimum" : undefined,
            ExpressionAttributeValues: {
              ":delta": input.activeAdminDelta,
              ":entityType": "EXPERT_ADMIN_GUARD",
              ":updatedAt": input.next.updatedAt,
              ...(input.activeAdminDelta === -1 ? { ":minimum": 1 } : {})
            }
          }
        }];
    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: this.config.tableName,
            Key: expertKey(input.next.expertId),
            ConditionExpression: "#status = :active",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":active": "active" }
          }
        },
        membershipPut,
        ...adminGuard,
        {
          Put: {
            TableName: auditTableName,
            Item: {
              pk: `EXPERT#${input.audit.expertId}`,
              sk: `AUDIT#${input.audit.occurredAt}#${input.audit.eventId}`,
              entityType: "AUDIT_EVENT",
              ...input.audit
            },
            ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
          }
        }
      ]
    }));
  }
}
