import { DynamoDbCourseRepository } from "./dynamodb-repository";

export function createCourseRepository() {
  const region = process.env.AWS_REGION?.trim(), tableName = process.env.DYNAMODB_DASHBOARD_TABLE?.trim();
  const auditTableName = process.env.DYNAMODB_DASHBOARD_AUDIT_TABLE?.trim();
  if (!region) throw new Error("AWS_REGION is required for Courses repository");
  if (!tableName) throw new Error("DYNAMODB_DASHBOARD_TABLE is required for Courses repository");
  if (!auditTableName) throw new Error("DYNAMODB_DASHBOARD_AUDIT_TABLE is required for Courses repository");
  return new DynamoDbCourseRepository({ region, tableName, auditTableName, courseIndexName: process.env.DYNAMODB_DASHBOARD_COURSES_INDEX?.trim() || "GSI2" });
}
