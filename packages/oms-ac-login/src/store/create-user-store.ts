import { AcError } from "../core/errors";
import type { AcConfig } from "../core/types";
import { DynamoDbUserStore } from "./dynamodb-user-store";
import { JsonUserStore } from "./json-user-store";
import type { UserStore } from "./user-store";

export type UserStoreBackend = "json" | "session" | "dynamodb";

export function getUserStoreBackend(config: AcConfig): UserStoreBackend {
  const configured = process.env.AC_USER_STORE?.trim().toLowerCase();
  if (configured === "dynamodb" || configured === "json" || configured === "session") {
    return configured;
  }
  return config.localDataStorage ? "json" : "session";
}

export function createUserStore(config: AcConfig): UserStore {
  const backend = getUserStoreBackend(config);
  if (backend === "dynamodb") {
    const tableName = process.env.DYNAMODB_USERS_TABLE?.trim();
    if (!tableName) throw new AcError("user_store_misconfigured", 500, "DYNAMODB_USERS_TABLE is required");
    return new DynamoDbUserStore({
      region: process.env.AWS_REGION?.trim() || "us-east-1",
      tableName
    });
  }
  return new JsonUserStore(config.userStorePath);
}

export function usesPersistentUserStore(config: AcConfig) {
  return getUserStoreBackend(config) !== "session";
}
