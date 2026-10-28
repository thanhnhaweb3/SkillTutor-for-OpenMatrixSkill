import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

const region = process.env.AWS_REGION;
const tableName = process.env.DYNAMODB_DASHBOARD_TABLE;
const auditTableName = process.env.DYNAMODB_DASHBOARD_AUDIT_TABLE;

async function main() {
  if (!region) throw new Error("AWS_REGION is required");
  if (!tableName) throw new Error("DYNAMODB_DASHBOARD_TABLE is required");
  if (!auditTableName) throw new Error("DYNAMODB_DASHBOARD_AUDIT_TABLE is required");
  const probe = randomUUID();
  const pk = `EXPERT#IAM_PROBE#${probe}`;
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: tableName,
            Key: { pk, sk: "META" },
            ConditionExpression: "attribute_exists(pk)"
          }
        },
        {
          Put: {
            TableName: tableName,
            Item: { pk, sk: "SKILL#IAM_PROBE#META", entityType: "IAM_PROBE" }
          }
        },
        {
          Put: {
            TableName: auditTableName,
            Item: { pk, sk: "AUDIT#IAM_PROBE", entityType: "IAM_PROBE" }
          }
        }
      ]
    }));
    throw new Error("Unsafe probe result: transaction unexpectedly committed");
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException") {
      console.log(JSON.stringify({
        ok: true,
        region,
        learningTable: tableName,
        auditTable: auditTableName,
        permissions: ["dynamodb:ConditionCheckItem", "dynamodb:PutItem"],
        committed: false
      }));
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
