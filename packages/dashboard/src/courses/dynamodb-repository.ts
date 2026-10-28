import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { auditItem, expertKey } from "../skills/serialization";
import { CourseDomainError } from "./errors";
import type { CourseListQuery, CourseRepository, CourseVersionMutationCommit, CreateCourseCommit, CreateNextCourseVersionCommit } from "./repository";
import { courseCodeLockItem, courseItem, courseKey, courseSkillMapItem, courseVersionItem, courseVersionKey,
  decodeCourseCursor, encodeCourseCursor, toCourse, toCourseVersion } from "./serialization";

export interface DynamoDbCourseRepositoryConfig { region: string; tableName: string; auditTableName: string; courseIndexName?: string }

export class DynamoDbCourseRepository implements CourseRepository {
  private readonly client: DynamoDBDocumentClient;
  constructor(private readonly config: DynamoDbCourseRepositoryConfig, client?: DynamoDBDocumentClient) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }), { marshallOptions: { removeUndefinedValues: true } });
  }
  async getCourse(expertId: string, courseId: string) {
    const r = await this.client.send(new GetCommand({ TableName: this.config.tableName, Key: courseKey(expertId, courseId), ConsistentRead: true }));
    return toCourse(r.Item as Record<string, unknown> | undefined);
  }
  async getCourseVersion(expertId: string, courseId: string, versionNumber: number) {
    const r = await this.client.send(new GetCommand({ TableName: this.config.tableName, Key: courseVersionKey(expertId, courseId, versionNumber), ConsistentRead: true }));
    return toCourseVersion(r.Item as Record<string, unknown> | undefined);
  }
  async listCourses(input: CourseListQuery) {
    validateList(input.limit, input.ownerUserId, input.status);
    const prefix = input.status ? `STATUS#${input.status}#${input.ownerUserId ? `OWNER#${input.ownerUserId}#` : ""}` : undefined;
    const r = await this.client.send(new QueryCommand({ TableName: this.config.tableName, IndexName: this.index,
      KeyConditionExpression: prefix ? "gsi2pk = :pk AND begins_with(gsi2sk, :prefix)" : "gsi2pk = :pk",
      ExpressionAttributeValues: { ":pk": `EXPERT#${input.expertId}#COURSES`, ...(prefix ? { ":prefix": prefix } : {}) },
      ExclusiveStartKey: decodeCourseCursor(input.cursor), Limit: input.limit }));
    return { items: (r.Items ?? []).map((x) => toCourse(x as Record<string, unknown>)).filter((x): x is NonNullable<typeof x> => !!x), cursor: encodeCourseCursor(r.LastEvaluatedKey) };
  }
  async listCourseVersions(input: { expertId: string; courseId: string; cursor?: string; limit: number }) {
    validateList(input.limit);
    const r = await this.client.send(new QueryCommand({ TableName: this.config.tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":pk": `EXPERT#${input.expertId}`, ":prefix": `COURSE#${input.courseId}#VERSION#` },
      ExclusiveStartKey: decodeCourseCursor(input.cursor), Limit: input.limit, ScanIndexForward: false }));
    return { items: (r.Items ?? []).map((x) => toCourseVersion(x as Record<string, unknown>)).filter((x): x is NonNullable<typeof x> => !!x), cursor: encodeCourseCursor(r.LastEvaluatedKey) };
  }
  async listCoursesBySkill(input: { expertId: string; skillId: string; status?: import("./types").CourseLifecycleStatus; cursor?: string; limit: number }) {
    validateList(input.limit);
    const r = await this.client.send(new QueryCommand({ TableName: this.config.tableName, IndexName: this.index,
      KeyConditionExpression: "gsi2pk = :pk", ExpressionAttributeValues: { ":pk": `EXPERT#${input.expertId}#COURSES_BY_SKILL#${input.skillId}` },
      ExclusiveStartKey: decodeCourseCursor(input.cursor), Limit: input.limit }));
    const ids = [...new Set((r.Items ?? []).map((x) => x.courseId).filter((x): x is string => typeof x === "string"))];
    if (!ids.length) return { items: [], cursor: encodeCourseCursor(r.LastEvaluatedKey) };
    const batch = await this.client.send(new BatchGetCommand({ RequestItems: { [this.config.tableName]: { Keys: ids.map((id) => courseKey(input.expertId, id)), ConsistentRead: true } } }));
    const items = (batch.Responses?.[this.config.tableName] ?? []).map((x) => toCourse(x as Record<string, unknown>))
      .filter((x): x is NonNullable<typeof x> => !!x && (!input.status || x.latestStatus === input.status));
    return { items, cursor: encodeCourseCursor(r.LastEvaluatedKey) };
  }
  async getQuotaUsage(expertId: string) {
    let courseCount = 0, publishedCourseCount = 0, cursor: Record<string, unknown> | undefined;
    do { const r = await this.client.send(new QueryCommand({ TableName: this.config.tableName, IndexName: this.index,
      KeyConditionExpression: "gsi2pk = :pk", ExpressionAttributeValues: { ":pk": `EXPERT#${expertId}#COURSES` }, ExclusiveStartKey: cursor,
      ProjectionExpression: "id,currentPublishedVersionId" }));
      courseCount += r.Items?.length ?? 0;
      publishedCourseCount += (r.Items ?? []).filter((x) => typeof x.currentPublishedVersionId === "string").length;
      cursor = r.LastEvaluatedKey; } while (cursor);
    return { courseCount, publishedCourseCount, activeCohortCount: 0 };
  }
  async commitCreateCourse(input: CreateCourseCommit) {
    const absent = "attribute_not_exists(pk) AND attribute_not_exists(sk)";
    await this.client.send(new TransactWriteCommand({ TransactItems: [active(this.config.tableName, input.course.expertId),
      { Put: { TableName: this.config.tableName, Item: courseCodeLockItem(input.course), ConditionExpression: absent } },
      { Put: { TableName: this.config.tableName, Item: courseItem(input.course), ConditionExpression: absent } },
      { Put: { TableName: this.config.tableName, Item: courseVersionItem(input.version), ConditionExpression: absent } },
      { Put: auditItem(this.config.auditTableName, input.audit) }] }));
  }
  async commitVersionMutation(input: CourseVersionMutationCommit) {
    if ((input.skillMaps?.length ?? 0) > 20) throw new CourseDomainError("VALIDATION_ERROR", "Too many atomic skill mappings");
    const expected = (value: number) => ({ ConditionExpression: "#version = :expectedVersion", ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expectedVersion": value } });
    await this.client.send(new TransactWriteCommand({ TransactItems: [active(this.config.tableName, input.nextCourse.expertId),
      { Put: { TableName: this.config.tableName, Item: courseItem(input.nextCourse), ...expected(input.previousCourse.version) } },
      { Put: { TableName: this.config.tableName, Item: courseVersionItem(input.nextVersion), ...expected(input.previousVersion.version) } },
      ...(input.skillMaps ?? []).map((map) => ({ Put: { TableName: this.config.tableName, Item: courseSkillMapItem(map, input.nextVersion.versionNumber), ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" } })),
      { Put: auditItem(this.config.auditTableName, input.audit) }] }));
  }
  async commitCreateNextVersion(input: CreateNextCourseVersionCommit) {
    await this.client.send(new TransactWriteCommand({ TransactItems: [active(this.config.tableName, input.nextCourse.expertId),
      { Put: { TableName: this.config.tableName, Item: courseItem(input.nextCourse), ConditionExpression: "#version = :expectedVersion", ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":expectedVersion": input.previousCourse.version } } },
      { Put: { TableName: this.config.tableName, Item: courseVersionItem(input.version), ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" } },
      { Put: auditItem(this.config.auditTableName, input.audit) }] }));
  }
  private get index() { return this.config.courseIndexName ?? "GSI2"; }
}

function active(tableName: string, expertId: string) { return { ConditionCheck: { TableName: tableName, Key: expertKey(expertId), ConditionExpression: "#status = :active",
  ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":active": "active" } } }; }
function validateList(limit: number, owner?: string, status?: string) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || owner && !status) throw new CourseDomainError("VALIDATION_ERROR", "Invalid course list query");
}
