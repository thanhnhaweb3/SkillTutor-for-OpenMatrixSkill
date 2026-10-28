// Creates (idempotently) every DynamoDB table OpenMatrix Skill + SkillTutor needs, in AWS_REGION of the account
// whose credentials are in .env. Use it when moving to a new AWS account or region.
// Usage:
//   node --env-file=.env scripts/setup-aws-tables.mjs            # create what is missing
//   node --env-file=.env scripts/setup-aws-tables.mjs --dry-run  # only show the plan
import {
  CreateTableCommand, DescribeContinuousBackupsCommand, DescribeTableCommand, DescribeTimeToLiveCommand, DynamoDBClient,
  UpdateContinuousBackupsCommand, UpdateTimeToLiveCommand, waitUntilTableExists
} from "@aws-sdk/client-dynamodb";

const env = (k, fallback) => process.env[k]?.trim() || fallback;
const region = env("AWS_REGION");
if (!region) { console.error("✗ AWS_REGION is required (e.g. ap-southeast-2)"); process.exit(1); }
const dryRun = process.argv.includes("--dry-run");
const client = new DynamoDBClient({ region });

const S = (name) => ({ AttributeName: name, AttributeType: "S" });
const gsi = (name, pk, sk) => ({ IndexName: name, KeySchema: [{ AttributeName: pk, KeyType: "HASH" }, { AttributeName: sk, KeyType: "RANGE" }], Projection: { ProjectionType: "ALL" } });

/** Key schemas mirror the repositories in packages/dashboard, packages/oms-ac-login and packages/skilltutor. */
const tables = [
  { env: "DYNAMODB_DASHBOARD_TABLE", name: env("DYNAMODB_DASHBOARD_TABLE", "OpenMatrixDashboard"), purpose: "Experts, memberships, skills, courses, cohorts, enrollments, progress",
    attrs: ["pk", "sk", "gsi1pk", "gsi1sk", "gsi2pk", "gsi2sk"],
    indexes: [gsi(env("DYNAMODB_DASHBOARD_USER_INDEX", "GSI1"), "gsi1pk", "gsi1sk"), gsi(env("DYNAMODB_DASHBOARD_SKILLS_INDEX", "GSI2"), "gsi2pk", "gsi2sk")], pitr: true },
  { env: "DYNAMODB_DASHBOARD_AUDIT_TABLE", name: env("DYNAMODB_DASHBOARD_AUDIT_TABLE", "OpenMatrixDashboardAudit"), purpose: "Audit log (append-only)", attrs: ["pk", "sk"], pitr: true },
  { env: "DYNAMODB_USERS_TABLE", name: env("DYNAMODB_USERS_TABLE", "OpenMatrixUsers"), purpose: "OMS accounts and linked identities", attrs: ["pk", "sk"], pitr: true },
  { env: "DYNAMODB_SKILLTUTOR_TABLE", name: env("DYNAMODB_SKILLTUTOR_TABLE", "OpenMatrixSkillTutor"), purpose: "SkillTutor links, chat, quizzes, certificates, join requests", attrs: ["pk", "sk"], ttl: "ttl" }
];

// The dashboard repositories default every secondary index to GSI2 (skills, courses, delivery) – keep one GSI2.
const dash = tables[0];
dash.indexes = dash.indexes.filter((x, i, all) => all.findIndex((y) => y.IndexName === x.IndexName) === i);

async function describe(TableName) {
  try { return (await client.send(new DescribeTableCommand({ TableName }))).Table; }
  catch (error) { if (error.name === "ResourceNotFoundException") return null; throw error; }
}

async function main() {
  console.log(`DynamoDB setup in ${region}${dryRun ? " (dry-run)" : ""}\n`);
  for (const t of tables) {
    const existing = await describe(t.name);
    if (existing) {
      const keys = existing.KeySchema.map((k) => k.AttributeName).join(",");
      const missing = (t.indexes ?? []).map((i) => i.IndexName).filter((n) => !(existing.GlobalSecondaryIndexes ?? []).some((g) => g.IndexName === n));
      console.log(`✓ ${t.name} exists (keys ${keys})${missing.length ? ` – ✗ missing index ${missing.join(", ")}: recreate the table or add the GSI in the console` : ""}`);
    } else if (dryRun) {
      console.log(`+ would create ${t.name} – ${t.purpose}${t.indexes ? ` [${t.indexes.map((i) => i.IndexName).join(", ")}]` : ""}`);
      continue;
    } else {
      await client.send(new CreateTableCommand({
        TableName: t.name, BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: t.attrs.map(S),
        KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }],
        GlobalSecondaryIndexes: t.indexes,
        Tags: [{ Key: "app", Value: "openmatrix-skill" }]
      }));
      await waitUntilTableExists({ client, maxWaitTime: 300 }, { TableName: t.name });
      console.log(`✓ created ${t.name} – ${t.purpose}`);
    }
    if (dryRun) continue;
    if (t.pitr) {
      const b = await client.send(new DescribeContinuousBackupsCommand({ TableName: t.name }));
      if (b.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus !== "ENABLED") {
        await client.send(new UpdateContinuousBackupsCommand({ TableName: t.name, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } }));
        console.log(`  ✓ point-in-time recovery enabled on ${t.name}`);
      }
    }
    if (t.ttl) {
      const ttl = await client.send(new DescribeTimeToLiveCommand({ TableName: t.name }));
      if (!["ENABLED", "ENABLING"].includes(ttl.TimeToLiveDescription?.TimeToLiveStatus ?? "")) {
        await client.send(new UpdateTimeToLiveCommand({ TableName: t.name, TimeToLiveSpecification: { Enabled: true, AttributeName: t.ttl } }));
        console.log(`  ✓ TTL enabled on ${t.name}.${t.ttl}`);
      }
    }
  }
  console.log(`\nPut these in .env and on Vercel:\nAWS_REGION=${region}\nDASHBOARD_STORE=dynamodb\nAC_USER_STORE=dynamodb\nSKILLTUTOR_STORE=dynamodb`);
  for (const t of tables) console.log(`${t.env}=${t.name}`);
  console.log(`DYNAMODB_DASHBOARD_USER_INDEX=GSI1\nDYNAMODB_DASHBOARD_SKILLS_INDEX=GSI2\nDYNAMODB_DASHBOARD_COURSES_INDEX=GSI2\nDYNAMODB_DASHBOARD_DELIVERY_INDEX=GSI2`);
}

main().catch((error) => {
  if (error?.name !== "AccessDeniedException") { console.error(error); process.exit(1); }
  const account = error.message.match(/arn:aws:(?:iam|sts)::(\d{12})/)?.[1] ?? "<ACCOUNT_ID>";
  console.error(`✗ ${error.message}\n\nAttach this policy to that IAM user (IAM → Users → Add permissions → Create inline policy → JSON), then run again:\n`);
  console.error(JSON.stringify({ Version: "2012-10-17", Statement: [{
    Sid: "OpenMatrixTablesSetupAndRuntime", Effect: "Allow",
    Action: ["dynamodb:CreateTable", "dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive", "dynamodb:UpdateTimeToLive", "dynamodb:DescribeContinuousBackups",
      "dynamodb:UpdateContinuousBackups", "dynamodb:TagResource", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
      "dynamodb:Query", "dynamodb:ConditionCheckItem", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"],
    Resource: tables.flatMap((t) => [`arn:aws:dynamodb:${region}:${account}:table/${t.name}`, `arn:aws:dynamodb:${region}:${account}:table/${t.name}/index/*`])
  }] }, null, 2));
  process.exit(1);
});
