import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
const region = process.env.AWS_REGION, tableName = process.env.DYNAMODB_DASHBOARD_TABLE;
const candidates = (process.env.DASHBOARD_COURSES_CANARY_EXPERT_IDS ?? process.env.DASHBOARD_SKILLS_CANARY_EXPERT_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
if (!region || !tableName) throw new Error("AWS_REGION and DYNAMODB_DASHBOARD_TABLE are required");
if (candidates.length !== 1 || candidates[0] === "*") throw new Error("Exactly one non-wildcard canary Expert ID is required");
const expertId = candidates[0], client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const expert = await client.send(new GetCommand({ TableName: tableName, Key: { pk: `EXPERT#${expertId}`, sk: "META" }, ConsistentRead: true, ProjectionExpression: "#status", ExpressionAttributeNames: { "#status": "status" } }));
const query = async (prefix) => { let items = [], cursor; do { const page = await client.send(new QueryCommand({ TableName: tableName, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":pk": `EXPERT#${expertId}`, ":prefix": prefix }, ExclusiveStartKey: cursor })); items.push(...(page.Items ?? [])); cursor = page.LastEvaluatedKey; } while (cursor); return items; };
const [frameworks, skills, versions, courses] = await Promise.all([query("FRAMEWORK#"), query("SKILL#"), query("SKILL#"), query("COURSE#")]);
const publishedSkillVersions = versions.filter((x) => x.entityType === "SKILL_VERSION" && x.status === "published");
const aggregates = skills.filter((x) => x.entityType === "SKILL");
const courseAggregates = courses.filter((x) => x.entityType === "COURSE");
const frameworkAggregates = frameworks.filter((x) => x.entityType === "SKILL_FRAMEWORK");
const ready = expert.Item?.status === "active" && frameworkAggregates.length > 0 && publishedSkillVersions.length > 0;
console.log(JSON.stringify({ ok: ready, candidateCount: 1, wildcard: false, expertActive: expert.Item?.status === "active", frameworkCount: frameworkAggregates.length,
  skillCount: aggregates.length, publishedSkillVersionCount: publishedSkillVersions.length, existingCourseCount: courseAggregates.length, rawIdsIncluded: false }));
if (!ready) process.exitCode = 1;
