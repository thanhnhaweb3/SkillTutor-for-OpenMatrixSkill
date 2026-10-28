import { DescribeContinuousBackupsCommand, DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
const region = process.env.AWS_REGION, tableName = process.env.DYNAMODB_DASHBOARD_TABLE, auditTableName = process.env.DYNAMODB_DASHBOARD_AUDIT_TABLE;
const indexName = process.env.DYNAMODB_DASHBOARD_COURSES_INDEX ?? process.env.DYNAMODB_DASHBOARD_DELIVERY_INDEX ?? "GSI2";
if (!region || !tableName || !auditTableName) throw new Error("AWS_REGION and dashboard table names are required");
const base = new DynamoDBClient({ region }), client = DynamoDBDocumentClient.from(base);
const description = await base.send(new DescribeTableCommand({ TableName: tableName }));
const backup = await base.send(new DescribeContinuousBackupsCommand({ TableName: tableName }));
const index = description.Table?.GlobalSecondaryIndexes?.find((item) => item.IndexName === indexName);
if (!index || index.IndexStatus !== "ACTIVE") throw new Error(`Phase 3 index ${indexName} is not ACTIVE`);
if (backup.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus !== "ENABLED") throw new Error("Learning table PITR is not enabled");
for (const pk of ["EXPERT#HEALTHCHECK#COURSES", "EXPERT#HEALTHCHECK#COURSES_BY_SKILL#HEALTHCHECK", "EXPERT#HEALTHCHECK#COHORTS"]) {
  await client.send(new QueryCommand({ TableName: tableName, IndexName: indexName, KeyConditionExpression: "gsi2pk = :pk", ExpressionAttributeValues: { ":pk": pk }, Limit: 1 }));
}
await client.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":pk": "EXPERT#HEALTHCHECK", ":prefix": "COURSE#" }, Limit: 1 }));
await client.send(new GetCommand({ TableName: tableName, Key: { pk: "USER#HEALTHCHECK", sk: "PROGRESS#EXPERT#HEALTHCHECK#COHORT#HEALTHCHECK#COURSE#HEALTHCHECK" }, ConsistentRead: true }));
await client.send(new QueryCommand({ TableName: auditTableName, KeyConditionExpression: "pk = :pk", ExpressionAttributeValues: { ":pk": "EXPERT#HEALTHCHECK" }, Limit: 1 }));
console.log(JSON.stringify({ ok: true, tableName, auditTableName, region, pitrStatus: "ENABLED", indexName, indexStatus: index.IndexStatus,
  ap03: "Get/Query ready", ap04: "GSI2 Query ready", ap05: "GSI2 Query ready", ap06: "consistent Get ready", cohortQuery: true, auditQuery: true, scanUsed: false }));
