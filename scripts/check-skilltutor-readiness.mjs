// Read-only readiness check for a SkillTutor deployment. Prints ✓ / ✗ per item and never sends messages.
// Usage: node --env-file=.env scripts/check-skilltutor-readiness.mjs
import { DescribeTableCommand, DescribeTimeToLiveCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";

const env = (k) => process.env[k]?.trim() ?? "";
const region = env("AWS_REGION") || "us-east-1";
let failures = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const bad = (msg, hint) => { failures++; console.log(`✗ ${msg}${hint ? `\n    → ${hint}` : ""}`); };
const warn = (msg) => console.log(`! ${msg}`);

console.log("SkillTutor readiness\n");

env("SKILLTUTOR_ENABLED") === "true" ? ok("SKILLTUTOR_ENABLED=true") : bad("SkillTutor is disabled", "set SKILLTUTOR_ENABLED=true");
if (env("SKILLTUTOR_DEMO") === "true") warn("SKILLTUTOR_DEMO=true – demo data in memory, not for production");

const appUrl = env("NEXT_PUBLIC_APP_URL");
appUrl.startsWith("https://") ? ok(`NEXT_PUBLIC_APP_URL=${appUrl}`) : bad("NEXT_PUBLIC_APP_URL should be the public https URL", "SNS webhooks and verify links use it");
const redirect = env("COGNITO_REDIRECT_URI");
if (redirect && !redirect.endsWith("/api/ac/auth/callback")) bad(`COGNITO_REDIRECT_URI=${redirect}`, "should end with /api/ac/auth/callback (or remove it to use the default)");

// --- Sign-in (Cognito) ---
const cogRegion = env("COGNITO_REGION"), pool = env("COGNITO_USER_POOL_ID"), domain = env("COGNITO_DOMAIN");
if (env("AC_PRIMARY_ADAPTER") === "cognito" || pool) {
  pool && cogRegion && pool.startsWith(`${cogRegion}_`) ? ok(`Cognito pool ${pool}`) : bad(`COGNITO_USER_POOL_ID (${pool || "missing"}) must start with COGNITO_REGION (${cogRegion || "missing"})_`);
  env("COGNITO_CLIENT_ID") ? ok("COGNITO_CLIENT_ID set") : bad("COGNITO_CLIENT_ID missing");
  domain && domain.includes(`.auth.${cogRegion}.amazoncognito.com`) ? ok(`Cognito domain ${domain}`) : bad(`COGNITO_DOMAIN (${domain || "missing"}) should be <prefix>.auth.${cogRegion}.amazoncognito.com`, "copy it from Cognito → App integration → Domain, without https://");
  const scopes = env("COGNITO_SCOPES") || "openid email profile";
  warn(`Cognito scopes requested: "${scopes}" – every one must be ticked in the app client's OpenID Connect scopes`);
  if (cogRegion && cogRegion !== region) warn(`COGNITO_REGION=${cogRegion} differs from AWS_REGION=${region} (fine if intended)`);
}

env("SKILLTUTOR_CRON_SECRET").length >= 16 ? ok("SKILLTUTOR_CRON_SECRET set") : bad("SKILLTUTOR_CRON_SECRET missing or shorter than 16 chars", "EventBridge sends it as x-cron-secret");
env("SKILLTUTOR_VERIFY_SNS") === "false" ? bad("SKILLTUTOR_VERIFY_SNS=false", "never disable SNS signature checks in production") : ok("SNS signature verification on");

const llm = env("SKILLTUTOR_LLM_MODE") || "mock";
llm === "bedrock" ? (env("SKILLTUTOR_BEDROCK_MODEL_ID").startsWith("us.") && !region.startsWith("us-") ? bad(`SKILLTUTOR_BEDROCK_MODEL_ID uses a us. inference profile but AWS_REGION=${region}`, "use the global. or regional profile ID shown in Bedrock → Cross-region inference") : ok(`LLM: Bedrock ${env("SKILLTUTOR_BEDROCK_MODEL_ID") || "(default model for the region)"}`)) : warn("SKILLTUTOR_LLM_MODE=mock – rule-based replies");
if (env("SKILLTUTOR_AGENT_MODE") === "agentcore") env("SKILLTUTOR_AGENTCORE_RUNTIME_ARN") ? ok("AgentCore runtime ARN set") : bad("SKILLTUTOR_AGENT_MODE=agentcore without SKILLTUTOR_AGENTCORE_RUNTIME_ARN");

const live = env("SKILLTUTOR_CHANNELS_MODE") === "live";
if (!live) warn("SKILLTUTOR_CHANNELS_MODE=dryrun – messages go to the Outbox, not to WhatsApp/SMS/SES");
else {
  env("SKILLTUTOR_WHATSAPP_PHONE_NUMBER_ID").startsWith("phone-number-id-") ? ok("WhatsApp phone number id set") : bad("SKILLTUTOR_WHATSAPP_PHONE_NUMBER_ID missing", "End User Messaging Social → phone numbers");
  const apiVersion = env("SKILLTUTOR_WHATSAPP_META_API_VERSION") || "v25.0";
  Number(/^v(\d+)/.exec(apiVersion)?.[1] ?? 0) >= 21 ? ok(`Meta API version ${apiVersion}`) : bad(`SKILLTUTOR_WHATSAPP_META_API_VERSION=${apiVersion} is retired by Meta`, "v20.0 ended 2026-09-24 – use v25.0 or remove the variable");
  ok(`WhatsApp template ${env("SKILLTUTOR_WHATSAPP_NUDGE_TEMPLATE") || "skilltutor_comeback"} (${env("SKILLTUTOR_WHATSAPP_TEMPLATE_LANG_EN") || "en"}/${env("SKILLTUTOR_WHATSAPP_TEMPLATE_LANG") || "vi"}) with variables: ${env("SKILLTUTOR_WHATSAPP_TEMPLATE_PARAMS") || "name,lesson"}`);
  env("SKILLTUTOR_WHATSAPP_DISPLAY_NUMBER") ? ok("WhatsApp display number set") : bad("SKILLTUTOR_WHATSAPP_DISPLAY_NUMBER missing", "shown to learners on the link card");
  env("SKILLTUTOR_SES_FROM_EMAIL") ? ok(`SES from: ${env("SKILLTUTOR_SES_FROM_EMAIL")}`) : bad("SKILLTUTOR_SES_FROM_EMAIL missing");
  env("SKILLTUTOR_SMS_ORIGINATION_IDENTITY") ? ok("SMS origination identity set") : warn("No SMS origination identity – SMS rung of Drop-out Rescue will fail");
}

env("DASHBOARD_PROGRESS_ENABLED") === "true" ? ok("DASHBOARD_PROGRESS_ENABLED=true") : bad("DASHBOARD_PROGRESS_ENABLED is not true", "SkillTutor cannot record lesson completion in OMS");
env("DASHBOARD_DELIVERY_CANARY_EXPERT_IDS") ? ok(`Delivery canary Experts: ${env("DASHBOARD_DELIVERY_CANARY_EXPERT_IDS")}`) : bad("DASHBOARD_DELIVERY_CANARY_EXPERT_IDS empty", "list the Expert ids (or *) allowed to record progress");

if (env("SKILLTUTOR_STORE") !== "dynamodb") bad("SKILLTUTOR_STORE is not dynamodb", "memory store loses links, progress state and certificates on restart");
else {
  const TableName = env("DYNAMODB_SKILLTUTOR_TABLE");
  if (!TableName) bad("DYNAMODB_SKILLTUTOR_TABLE missing", "run npm run setup:skilltutor-dynamodb");
  else {
    try {
      const client = new DynamoDBClient({ region });
      const t = await client.send(new DescribeTableCommand({ TableName }));
      const keys = t.Table?.KeySchema?.map((k) => k.AttributeName).join(",");
      keys === "pk,sk" ? ok(`Table ${TableName} (${t.Table?.TableStatus})`) : bad(`Table ${TableName} has keys ${keys}`, "expected pk/sk");
      const ttl = await client.send(new DescribeTimeToLiveCommand({ TableName }));
      ttl.TimeToLiveDescription?.AttributeName === "ttl" ? ok("TTL on 'ttl'") : bad("TTL not enabled on 'ttl'", "run npm run setup:skilltutor-dynamodb");
    } catch (error) {
      bad(`Cannot describe ${TableName}: ${error.name}`, "check credentials/region or run npm run setup:skilltutor-dynamodb");
    }
  }
}

// --- OMS tables in the same account/region ---
for (const key of ["DYNAMODB_DASHBOARD_TABLE", "DYNAMODB_DASHBOARD_AUDIT_TABLE", "DYNAMODB_USERS_TABLE"]) {
  const TableName = env(key);
  if (!TableName) { bad(`${key} missing`, "run npm run setup:aws-tables"); continue; }
  try {
    const t = await new DynamoDBClient({ region }).send(new DescribeTableCommand({ TableName }));
    ok(`${key}=${TableName} (${t.Table?.TableStatus}${t.Table?.GlobalSecondaryIndexes?.length ? `, ${t.Table.GlobalSecondaryIndexes.map((g) => g.IndexName).join("/")}` : ""})`);
  } catch (error) {
    bad(`Cannot describe ${key}=${TableName} in ${region}: ${error.name}`, "run npm run setup:aws-tables with the new account's keys");
  }
}

console.log(failures ? `\n${failures} issue(s) to fix.` : "\nAll required checks passed.");
process.exitCode = failures ? 1 : 0;
