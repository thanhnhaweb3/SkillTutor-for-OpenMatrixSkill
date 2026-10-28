import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const tableName = process.env.DYNAMODB_USERS_TABLE ?? "OpenMatrixUsers";
const region = process.env.AWS_REGION ?? "us-east-1";

async function main() {
  const missing = ["AWS_REGION", "DYNAMODB_USERS_TABLE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"].filter(
    (key) => !process.env[key]
  );
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);

  const baseClient = new DynamoDBClient({ region });
  let description;
  let describeWarning;
  try {
    description = await baseClient.send(new DescribeTableCommand({ TableName: tableName }));
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AccessDeniedException") throw error;
    describeWarning = "dynamodb:DescribeTable is not allowed; runtime GetItem check will continue";
  }

  const keySchema = description
    ? Object.fromEntries((description.Table?.KeySchema ?? []).map((item) => [item.KeyType, item.AttributeName]))
    : undefined;
  if (keySchema && (keySchema.HASH !== "pk" || keySchema.RANGE !== "sk")) {
    throw new Error(`Invalid key schema: expected HASH=pk and RANGE=sk, received ${JSON.stringify(keySchema)}`);
  }

  const client = DynamoDBDocumentClient.from(baseClient);
  await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: "HEALTHCHECK", sk: "HEALTHCHECK" },
      ConsistentRead: true
    })
  );

  console.log(
    JSON.stringify({
      ok: true,
      tableName,
      region,
      status: description?.Table?.TableStatus,
      keySchema,
      describeWarning
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
