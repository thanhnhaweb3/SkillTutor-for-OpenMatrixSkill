import { DescribeContinuousBackupsCommand, DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION;
const tableName = process.env.DYNAMODB_DASHBOARD_TABLE;
const indexName = process.env.DYNAMODB_DASHBOARD_SKILLS_INDEX ?? "GSI2";

async function main() {
  if (!region) throw new Error("AWS_REGION is required");
  if (!tableName) throw new Error("DYNAMODB_DASHBOARD_TABLE is required");
  const base = new DynamoDBClient({ region });
  const description = await base.send(new DescribeTableCommand({ TableName: tableName }));
  const backups = await base.send(new DescribeContinuousBackupsCommand({ TableName: tableName }));
  const pitrStatus = backups.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus;
  if (pitrStatus !== "ENABLED") throw new Error(`PITR must be ENABLED on ${tableName}; received ${pitrStatus ?? "unknown"}`);
  const index = description.Table?.GlobalSecondaryIndexes?.find((item) => item.IndexName === indexName);
  if (!index) throw new Error(`Missing Skills index ${indexName} on ${tableName}`);
  const schema = Object.fromEntries((index.KeySchema ?? []).map((item) => [item.KeyType, item.AttributeName]));
  if (schema.HASH !== "gsi2pk" || schema.RANGE !== "gsi2sk") {
    throw new Error(`Invalid ${indexName} key schema: ${JSON.stringify(schema)}`);
  }
  try {
    await DynamoDBDocumentClient.from(base).send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": "EXPERT#HEALTHCHECK#SKILLS", ":prefix": "FRAMEWORK#" },
      Limit: 1
    }));
    await DynamoDBDocumentClient.from(base).send(new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: "gsi2pk = :pk",
      ExpressionAttributeValues: { ":pk": "EXPERT#HEALTHCHECK#SKILLS" },
      Limit: 1
    }));
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AccessDeniedException") throw error;
    throw new Error(
      `Missing dynamodb:Query on the table or index. Required resources: arn:aws:dynamodb:${region}:*:table/${tableName} and arn:aws:dynamodb:${region}:*:table/${tableName}/index/${indexName}`,
      { cause: error }
    );
  }
  console.log(JSON.stringify({ ok: true, tableName, region, pitrStatus, tableQuery: true, skillIndex: indexName, indexQuery: true, indexStatus: index.IndexStatus, indexSchema: schema }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
