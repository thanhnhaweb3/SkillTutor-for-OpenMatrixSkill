import { DynamoDbSkillRepository } from "./dynamodb-repository";

export function createSkillRepository() {
  const region = process.env.AWS_REGION?.trim();
  const tableName = process.env.DYNAMODB_DASHBOARD_TABLE?.trim();
  const auditTableName = process.env.DYNAMODB_DASHBOARD_AUDIT_TABLE?.trim();
  if (!region) throw new Error("AWS_REGION is required for Skills repository");
  if (!tableName) throw new Error("DYNAMODB_DASHBOARD_TABLE is required for Skills repository");
  if (!auditTableName) throw new Error("DYNAMODB_DASHBOARD_AUDIT_TABLE is required for Skills repository");
  return new DynamoDbSkillRepository({
    region,
    tableName,
    auditTableName,
    skillIndexName: process.env.DYNAMODB_DASHBOARD_SKILLS_INDEX?.trim() || "GSI2"
  });
}
