// Creates (idempotently) the SkillTutor DynamoDB table and enables TTL on `ttl`.
// Usage: node --env-file=.env scripts/setup-skilltutor-dynamodb.mjs
import { CreateTableCommand, DescribeTableCommand, DescribeTimeToLiveCommand, DynamoDBClient, UpdateTimeToLiveCommand, waitUntilTableExists } from "@aws-sdk/client-dynamodb";

const region = process.env.AWS_REGION?.trim() || "us-east-1";
const TableName = process.env.DYNAMODB_SKILLTUTOR_TABLE?.trim() || "OpenMatrixSkillTutor";
const client = new DynamoDBClient({ region });

async function exists() {
  try { await client.send(new DescribeTableCommand({ TableName })); return true; }
  catch (error) { if (error.name === "ResourceNotFoundException") return false; throw error; }
}

async function main() {
  if (await exists()) {
    console.log(`✓ Table ${TableName} already exists in ${region}`);
  } else {
    await client.send(new CreateTableCommand({
      TableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }],
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }],
      Tags: [{ Key: "app", Value: "skilltutor" }]
    }));
    await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName });
    console.log(`✓ Created ${TableName} in ${region}`);
  }

  const ttl = await client.send(new DescribeTimeToLiveCommand({ TableName }));
  if (ttl.TimeToLiveDescription?.TimeToLiveStatus === "ENABLED" || ttl.TimeToLiveDescription?.TimeToLiveStatus === "ENABLING") {
    console.log("✓ TTL already enabled on attribute 'ttl'");
  } else {
    await client.send(new UpdateTimeToLiveCommand({ TableName, TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" } }));
    console.log("✓ Enabled TTL on attribute 'ttl' (one-time link codes expire automatically)");
  }
  console.log(`\nAdd to .env:\nSKILLTUTOR_STORE=dynamodb\nDYNAMODB_SKILLTUTOR_TABLE=${TableName}`);
}

main().catch((error) => {
  if (error?.name !== "AccessDeniedException") { console.error(error); process.exit(1); }
  const account = error.message.match(/arn:aws:iam::(\d{12})/)?.[1] ?? "<ACCOUNT_ID>";
  const arn = `arn:aws:dynamodb:${region}:${account}:table/${TableName}`;
  console.error(`✗ ${error.message}\n\nAttach this IAM policy to that user/role (IAM → Users → Add permissions → Create inline policy → JSON), then run again:\n`);
  console.error(JSON.stringify({ Version: "2012-10-17", Statement: [
    { Sid: "SkillTutorSetup", Effect: "Allow", Action: ["dynamodb:CreateTable", "dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive", "dynamodb:UpdateTimeToLive", "dynamodb:TagResource"], Resource: arn },
    { Sid: "SkillTutorRuntime", Effect: "Allow", Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"], Resource: arn }
  ] }, null, 2));
  process.exit(1);
});
