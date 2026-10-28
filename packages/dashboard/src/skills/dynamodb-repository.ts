import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { SkillDomainError } from "./errors";
import type { CreateNextSkillVersionCommit, CreateSkillCommit, SeedSkillFrameworkCommit, SkillImportCommit, SkillListQuery, SkillRepository, SkillVersionMutationCommit } from "./repository";
import {
  auditItem,
  decodeCursor,
  encodeCursor,
  expertKey,
  frameworkKey,
  frameworkItem,
  frameworkVersionItem,
  frameworkVersionKey,
  skillCodeLockItem,
  skillImportReceiptItem,
  skillImportReceiptKey,
  skillItem,
  skillKey,
  skillVersionItem,
  skillVersionKey,
  toFramework,
  toFrameworkVersion,
  toSkill, toSkillImportReceipt,
  toSkillVersion
} from "./serialization";

export interface DynamoDbSkillRepositoryConfig {
  region: string;
  tableName: string;
  auditTableName: string;
  skillIndexName?: string;
}

export class DynamoDbSkillRepository implements SkillRepository {
  private readonly client: DynamoDBDocumentClient;

  constructor(private readonly config: DynamoDbSkillRepositoryConfig, client?: DynamoDBDocumentClient) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }), {
      marshallOptions: { removeUndefinedValues: true }
    });
  }

  async getFramework(expertId: string, frameworkId: string) {
    const response = await this.client.send(new GetCommand({
      TableName: this.config.tableName,
      Key: frameworkKey(expertId, frameworkId),
      ConsistentRead: true
    }));
    return toFramework(response.Item as Record<string, unknown> | undefined);
  }

  async getFrameworkVersion(expertId: string, frameworkId: string, versionNumber: number) {
    const response = await this.client.send(new GetCommand({
      TableName: this.config.tableName,
      Key: frameworkVersionKey(expertId, frameworkId, versionNumber),
      ConsistentRead: true
    }));
    return toFrameworkVersion(response.Item as Record<string, unknown> | undefined);
  }

  async listFrameworks(expertId: string) {
    const frameworks = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const response = await this.client.send(new QueryCommand({
        TableName: this.config.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `EXPERT#${expertId}`, ":prefix": "FRAMEWORK#" },
        ExclusiveStartKey: cursor
      }));
      for (const item of response.Items ?? []) {
        const framework = toFramework(item as Record<string, unknown>);
        if (framework) frameworks.push(framework);
      }
      cursor = response.LastEvaluatedKey;
    } while (cursor);
    return frameworks.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSkill(expertId: string, skillId: string) {
    const response = await this.client.send(new GetCommand({
      TableName: this.config.tableName,
      Key: skillKey(expertId, skillId),
      ConsistentRead: true
    }));
    return toSkill(response.Item as Record<string, unknown> | undefined);
  }

  async getImportReceipt(expertId: string, idempotencyKey: string) {
    const response = await this.client.send(new GetCommand({ TableName: this.config.tableName, Key: skillImportReceiptKey(expertId, idempotencyKey), ConsistentRead: true }));
    return toSkillImportReceipt(response.Item as Record<string, unknown> | undefined);
  }

  async getSkillVersion(expertId: string, skillId: string, versionNumber: number) {
    const response = await this.client.send(new GetCommand({
      TableName: this.config.tableName,
      Key: skillVersionKey(expertId, skillId, versionNumber),
      ConsistentRead: true
    }));
    return toSkillVersion(response.Item as Record<string, unknown> | undefined);
  }

  async listSkills(input: SkillListQuery) {
    this.validateList(input.limit, input.ownerUserId, input.status);
    const prefix = input.status
      ? `STATUS#${input.status}#${input.ownerUserId ? `OWNER#${input.ownerUserId}#` : ""}`
      : undefined;
    const response = await this.client.send(new QueryCommand({
      TableName: this.config.tableName,
      IndexName: this.config.skillIndexName ?? "GSI2",
      KeyConditionExpression: prefix ? "gsi2pk = :pk AND begins_with(gsi2sk, :prefix)" : "gsi2pk = :pk",
      ExpressionAttributeValues: {
        ":pk": `EXPERT#${input.expertId}#SKILLS`,
        ...(prefix ? { ":prefix": prefix } : {})
      },
      ExclusiveStartKey: decodeCursor(input.cursor),
      Limit: input.limit
    }));
    return {
      items: (response.Items ?? []).map((item) => toSkill(item as Record<string, unknown>)).filter((item): item is NonNullable<typeof item> => item !== null),
      cursor: encodeCursor(response.LastEvaluatedKey)
    };
  }

  async listSkillVersions(input: { expertId: string; skillId: string; cursor?: string; limit: number }) {
    this.validateList(input.limit);
    const response = await this.client.send(new QueryCommand({
      TableName: this.config.tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": `EXPERT#${input.expertId}`,
        ":prefix": `SKILL#${input.skillId}#VERSION#`
      },
      ExclusiveStartKey: decodeCursor(input.cursor),
      Limit: input.limit,
      ScanIndexForward: false
    }));
    return {
      items: (response.Items ?? []).map((item) => toSkillVersion(item as Record<string, unknown>)).filter((item): item is NonNullable<typeof item> => item !== null),
      cursor: encodeCursor(response.LastEvaluatedKey)
    };
  }

  async getQuotaUsage(expertId: string) {
    const count = async (prefix?: string) => {
      let total = 0;
      let cursor: Record<string, unknown> | undefined;
      do {
        const response = await this.client.send(new QueryCommand({
          TableName: this.config.tableName,
          IndexName: this.config.skillIndexName ?? "GSI2",
          KeyConditionExpression: prefix ? "gsi2pk = :pk AND begins_with(gsi2sk, :prefix)" : "gsi2pk = :pk",
          ExpressionAttributeValues: {
            ":pk": `EXPERT#${expertId}#SKILLS`,
            ...(prefix ? { ":prefix": prefix } : {})
          },
          ExclusiveStartKey: cursor,
          Select: "COUNT"
        }));
        total += response.Count ?? 0;
        cursor = response.LastEvaluatedKey;
      } while (cursor);
      return total;
    };
    const [createdSkillCount, publishedSkillCount] = await Promise.all([count(), count("STATUS#published#")]);
    return { createdSkillCount, publishedSkillCount, completedCourseCount: 0 };
  }

  async commitCreateSkill(input: CreateSkillCommit) {
    const absent = "attribute_not_exists(pk) AND attribute_not_exists(sk)";
    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: this.config.tableName,
            Key: expertKey(input.skill.expertId),
            ConditionExpression: "#status = :active",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":active": "active" }
          }
        },
        { Put: { TableName: this.config.tableName, Item: skillCodeLockItem(input.skill), ConditionExpression: absent } },
        { Put: { TableName: this.config.tableName, Item: skillItem(input.skill), ConditionExpression: absent } },
        { Put: { TableName: this.config.tableName, Item: skillVersionItem(input.version), ConditionExpression: absent } },
        { Put: auditItem(this.config.auditTableName, input.audit) }
      ]
    }));
  }

  async commitSeedFramework(input: SeedSkillFrameworkCommit) {
    const absent = "attribute_not_exists(pk) AND attribute_not_exists(sk)";
    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: this.config.tableName,
            Key: expertKey(input.framework.expertId),
            ConditionExpression: "#status = :active",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":active": "active" }
          }
        },
        { Put: { TableName: this.config.tableName, Item: frameworkItem(input.framework), ConditionExpression: absent } },
        { Put: { TableName: this.config.tableName, Item: frameworkVersionItem(input.version), ConditionExpression: absent } },
        { Put: auditItem(this.config.auditTableName, input.audit) }
      ]
    }));
  }

  async commitSkillImport(input: SkillImportCommit) {
    const absent = "attribute_not_exists(pk) AND attribute_not_exists(sk)";
    await this.client.send(new TransactWriteCommand({ TransactItems: [
      { ConditionCheck: { TableName: this.config.tableName, Key: expertKey(input.receipt.expertId), ConditionExpression: "#status = :active", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":active": "active" } } },
      ...input.skills.flatMap(({ skill, version }) => [
        { Put: { TableName: this.config.tableName, Item: skillCodeLockItem(skill), ConditionExpression: absent } },
        { Put: { TableName: this.config.tableName, Item: skillItem(skill), ConditionExpression: absent } },
        { Put: { TableName: this.config.tableName, Item: skillVersionItem(version), ConditionExpression: absent } }
      ]),
      { Put: { TableName: this.config.tableName, Item: skillImportReceiptItem(input.receipt), ConditionExpression: absent } },
      { Put: auditItem(this.config.auditTableName, input.audit) }
    ] }));
  }

  async commitVersionMutation(input: SkillVersionMutationCommit) {
    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: this.config.tableName,
            Key: expertKey(input.nextSkill.expertId),
            ConditionExpression: "#status = :active",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":active": "active" }
          }
        },
        {
          Put: {
            TableName: this.config.tableName,
            Item: skillItem(input.nextSkill),
            ConditionExpression: "#version = :expectedVersion",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":expectedVersion": input.previousSkill.version }
          }
        },
        {
          Put: {
            TableName: this.config.tableName,
            Item: skillVersionItem(input.nextVersion),
            ConditionExpression: "#version = :expectedVersion",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":expectedVersion": input.previousVersion.version }
          }
        },
        { Put: auditItem(this.config.auditTableName, input.audit) }
      ]
    }));
  }

  async commitCreateNextVersion(input: CreateNextSkillVersionCommit) {
    await this.client.send(new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: this.config.tableName,
            Key: expertKey(input.nextSkill.expertId),
            ConditionExpression: "#status = :active",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: { ":active": "active" }
          }
        },
        {
          Put: {
            TableName: this.config.tableName,
            Item: skillItem(input.nextSkill),
            ConditionExpression: "#version = :expectedVersion",
            ExpressionAttributeNames: { "#version": "version" },
            ExpressionAttributeValues: { ":expectedVersion": input.previousSkill.version }
          }
        },
        {
          Put: {
            TableName: this.config.tableName,
            Item: skillVersionItem(input.version),
            ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
          }
        },
        { Put: auditItem(this.config.auditTableName, input.audit) }
      ]
    }));
  }

  private validateList(limit: number, ownerUserId?: string, status?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || ownerUserId && !status) {
      throw new SkillDomainError("VALIDATION_ERROR", "Invalid skill list query");
    }
  }
}
