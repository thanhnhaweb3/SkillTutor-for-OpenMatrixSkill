import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION;
const tableName = process.env.DYNAMODB_DASHBOARD_TABLE;
const indexName = process.env.DYNAMODB_DASHBOARD_USER_INDEX ?? "GSI1";

async function main() {
  if (!region) throw new Error("AWS_REGION is required");
  if (!tableName) throw new Error("DYNAMODB_DASHBOARD_TABLE is required");

  const baseClient = new DynamoDBClient({ region });
  let description;
  let describeWarning;
  try {
    description = await baseClient.send(new DescribeTableCommand({ TableName: tableName }));
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AccessDeniedException") throw error;
    describeWarning = "dynamodb:DescribeTable is not allowed; runtime Query check continued";
  }
  const keySchema = description
    ? Object.fromEntries((description.Table?.KeySchema ?? []).map((item) => [item.KeyType, item.AttributeName]))
    : undefined;
  if (keySchema && (keySchema.HASH !== "pk" || keySchema.RANGE !== "sk")) {
    throw new Error(`Invalid table key schema: ${JSON.stringify(keySchema)}`);
  }
  const userIndex = description?.Table?.GlobalSecondaryIndexes?.find((index) => index.IndexName === indexName);
  const availableIndexes = (description?.Table?.GlobalSecondaryIndexes ?? [])
    .map((index) => index.IndexName)
    .filter(Boolean);
  if (description && !userIndex) {
    throw new Error(
      `Table ${tableName} does not have index ${indexName}. Available indexes: ${availableIndexes.join(", ") || "none"}`
    );
  }
  const indexSchema = userIndex
    ? Object.fromEntries((userIndex.KeySchema ?? []).map((item) => [item.KeyType, item.AttributeName]))
    : undefined;
  if (indexSchema && (indexSchema.HASH !== "gsi1pk" || indexSchema.RANGE !== "gsi1sk")) {
    throw new Error(`Invalid ${indexName} key schema: ${JSON.stringify(indexSchema)}`);
  }

  const client = DynamoDBDocumentClient.from(baseClient);
  try {
    await client.send(new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: "gsi1pk = :user",
      ExpressionAttributeValues: { ":user": "USER#HEALTHCHECK" },
      Limit: 1
    }));
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AccessDeniedException") throw error;
    throw new Error(
      `Missing dynamodb:Query on arn:aws:dynamodb:${region}:*:table/${tableName}/index/${indexName}`,
      { cause: error }
    );
  }
  console.log(JSON.stringify({
    ok: true,
    tableName,
    region,
    tableStatus: description?.Table?.TableStatus,
    keySchema,
    userIndex: indexName,
    indexSchema,
    availableIndexes,
    describeWarning
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
