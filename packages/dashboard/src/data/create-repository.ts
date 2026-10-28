import { DynamoDbDashboardRepository } from "./dynamodb-repository";
import { JsonDashboardRepository } from "./json-repository";
import type { DashboardRepository, Level0BootstrapRepository, MembershipMutationRepository } from "./repositories";

export type DashboardStoreBackend = "json" | "dynamodb";

export function getDashboardStoreBackend(): DashboardStoreBackend {
  const configured = process.env.DASHBOARD_STORE?.trim().toLowerCase();
  if (!configured || configured === "json") return "json";
  if (configured === "dynamodb") return "dynamodb";
  throw new Error(`Unsupported DASHBOARD_STORE: ${configured}`);
}

export function createDashboardRepository(): DashboardRepository {
  if (getDashboardStoreBackend() === "json") {
    return new JsonDashboardRepository(process.env.DASHBOARD_DATA_PATH?.trim() || "./data/dashboard.json");
  }
  const region = process.env.AWS_REGION?.trim();
  const tableName = process.env.DYNAMODB_DASHBOARD_TABLE?.trim();
  if (!region) throw new Error("AWS_REGION is required when DASHBOARD_STORE=dynamodb");
  if (!tableName) throw new Error("DYNAMODB_DASHBOARD_TABLE is required when DASHBOARD_STORE=dynamodb");
  return new DynamoDbDashboardRepository({
    region,
    tableName,
    userIndexName: process.env.DYNAMODB_DASHBOARD_USER_INDEX?.trim() || "GSI1"
  });
}

export function createMembershipMutationRepository(): MembershipMutationRepository {
  if (getDashboardStoreBackend() !== "dynamodb") {
    throw new Error("Membership mutations require DASHBOARD_STORE=dynamodb");
  }
  const region = process.env.AWS_REGION?.trim();
  const tableName = process.env.DYNAMODB_DASHBOARD_TABLE?.trim();
  if (!region) throw new Error("AWS_REGION is required when DASHBOARD_STORE=dynamodb");
  if (!tableName) throw new Error("DYNAMODB_DASHBOARD_TABLE is required when DASHBOARD_STORE=dynamodb");
  return new DynamoDbDashboardRepository({
    region,
    tableName,
    userIndexName: process.env.DYNAMODB_DASHBOARD_USER_INDEX?.trim() || "GSI1"
  });
}

export function createLevel0BootstrapRepository(): Level0BootstrapRepository {
  if (getDashboardStoreBackend() !== "dynamodb") {
    throw new Error("Level 0 bootstrap requires DASHBOARD_STORE=dynamodb");
  }
  const region = process.env.AWS_REGION?.trim();
  const tableName = process.env.DYNAMODB_DASHBOARD_TABLE?.trim();
  if (!region) throw new Error("AWS_REGION is required when DASHBOARD_STORE=dynamodb");
  if (!tableName) throw new Error("DYNAMODB_DASHBOARD_TABLE is required when DASHBOARD_STORE=dynamodb");
  return new DynamoDbDashboardRepository({
    region,
    tableName,
    userIndexName: process.env.DYNAMODB_DASHBOARD_USER_INDEX?.trim() || "GSI1"
  });
}
