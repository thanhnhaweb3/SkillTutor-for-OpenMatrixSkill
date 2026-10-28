import {
  DescribeContinuousBackupsCommand,
  DescribeTableCommand,
  DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION;
const tableName = process.env.DYNAMODB_DASHBOARD_AUDIT_TABLE;

async function main() {
  if (!region) throw new Error("AWS_REGION is required");
  if (!tableName) throw new Error("DYNAMODB_DASHBOARD_AUDIT_TABLE is required");

  const baseClient = new DynamoDBClient({ region });
  const description = await baseClient.send(new DescribeTableCommand({ TableName: tableName }));
  const keySchema = Object.fromEntries(
    (description.Table?.KeySchema ?? []).map((item) => [item.KeyType, item.AttributeName])
  );
  if (keySchema.HASH !== "pk" || keySchema.RANGE !== "sk") {
    throw new Error(`Invalid audit table key schema: ${JSON.stringify(keySchema)}`);
  }

  let pitrStatus;
  let backupWarning;
  try {
    const backups = await baseClient.send(new DescribeContinuousBackupsCommand({ TableName: tableName }));
    pitrStatus = backups.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus;
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AccessDeniedException") throw error;
    backupWarning = "dynamodb:DescribeContinuousBackups is not allowed";
  }

  const client = DynamoDBDocumentClient.from(baseClient);
  let getItemWarning;
  try {
    await client.send(new GetCommand({
      TableName: tableName,
      Key: { pk: "HEALTHCHECK", sk: "HEALTHCHECK" },
      ConsistentRead: true,
      ProjectionExpression: "pk"
    }));
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "AccessDeniedException") throw error;
    getItemWarning = "dynamodb:GetItem is not allowed; audit metadata verification still passed";
  }

  console.log(JSON.stringify({
    ok: true,
    tableName,
    region,
    tableStatus: description.Table?.TableStatus,
    keySchema,
    encryption: description.Table?.SSEDescription?.Status ?? "AWS_OWNED_OR_UNREPORTED",
    pitrStatus,
    backupWarning,
    getItemWarning
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
