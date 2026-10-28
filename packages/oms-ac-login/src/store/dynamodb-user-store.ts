import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";
import { AcError } from "../core/errors";
import type {
  AcUser,
  ConnectProviderId,
  LinkedIdentity,
  LearnerProfilePatch,
  PrimaryAdapterId,
  PrimaryAuthResult
} from "../core/types";
import type { UserStore } from "./user-store";
import { applyLearnerProfile } from "../core/profile";

type StoredUser = AcUser & { pk: string; sk: "PROFILE"; entityType: "USER"; version: number };

function userKey(id: string) {
  return { pk: `USER#${id}`, sk: "PROFILE" as const };
}

function emailKey(email: string) {
  return { pk: `EMAIL#${email.trim().toLowerCase()}`, sk: "LOCK" };
}

function primaryKey(adapter: PrimaryAdapterId, subject: string) {
  return { pk: `PRIMARY#${adapter}#${subject}`, sk: "LOCK" };
}

function identityKey(provider: ConnectProviderId, subject: string) {
  return { pk: `IDENTITY#${provider}#${subject}`, sk: "LOCK" };
}

function fromItem(item: Record<string, unknown> | undefined): AcUser | null {
  if (!item) return null;
  const { pk, sk, entityType, version, normalizedEmail, ...user } = item;
  return user as unknown as AcUser;
}

function toItem(user: AcUser, version: number): StoredUser & { normalizedEmail: string } {
  return {
    ...userKey(user.id),
    entityType: "USER",
    version,
    normalizedEmail: user.email.trim().toLowerCase(),
    ...user
  };
}

function isTransactionConflict(error: unknown) {
  return error instanceof Error && error.name === "TransactionCanceledException";
}

function initials(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return (parts[0]?.slice(0, 2) ?? email.slice(0, 2)).toUpperCase();
}

export class DynamoDbUserStore implements UserStore {
  private readonly client: DynamoDBDocumentClient;

  constructor(private readonly config: { region: string; tableName: string }) {
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }), {
      marshallOptions: { removeUndefinedValues: true }
    });
  }

  private async get(key: { pk: string; sk: string }) {
    const response = await this.client.send(
      new GetCommand({ TableName: this.config.tableName, Key: key, ConsistentRead: true })
    );
    return response.Item as Record<string, unknown> | undefined;
  }

  private async findFromLock(key: { pk: string; sk: string }) {
    const lock = await this.get(key);
    return typeof lock?.userId === "string" ? this.findById(lock.userId) : null;
  }

  private async getStoredUser(id: string) {
    return (await this.get(userKey(id))) as StoredUser | undefined;
  }

  async findById(id: string) {
    return fromItem(await this.get(userKey(id)));
  }

  async findByEmail(email: string) {
    return this.findFromLock(emailKey(email));
  }

  async findByPrimarySubject(adapter: PrimaryAdapterId, subject: string) {
    return this.findFromLock(primaryKey(adapter, subject));
  }

  async findByConnectSubject(provider: ConnectProviderId, subject: string) {
    return this.findFromLock(identityKey(provider, subject));
  }

  async createFromPrimary(result: PrimaryAuthResult, adapter: PrimaryAdapterId) {
    const existing = await this.findByPrimarySubject(adapter, result.subject);
    if (existing) return existing;

    const byEmail = await this.findByEmail(result.email);
    if (byEmail) {
      if (byEmail.primaryAdapter === adapter && byEmail.primarySubject === result.subject) return byEmail;
      throw new AcError("email_already_exists", 409);
    }

    const now = new Date().toISOString();
    const name = result.name ?? result.email.split("@")[0];
    const user: AcUser = {
      id: `user-${randomUUID().slice(0, 8)}`,
      email: result.email.trim().toLowerCase(),
      name,
      role: "learner",
      avatarInitials: initials(name, result.email),
      primaryAdapter: adapter,
      primarySubject: result.subject,
      identities: [],
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.config.tableName,
                Item: toItem(user, 1),
                ConditionExpression: "attribute_not_exists(pk)"
              }
            },
            {
              Put: {
                TableName: this.config.tableName,
                Item: { ...emailKey(user.email), entityType: "EMAIL_LOCK", userId: user.id },
                ConditionExpression: "attribute_not_exists(pk)"
              }
            },
            {
              Put: {
                TableName: this.config.tableName,
                Item: {
                  ...primaryKey(adapter, result.subject),
                  entityType: "PRIMARY_LOCK",
                  userId: user.id
                },
                ConditionExpression: "attribute_not_exists(pk)"
              }
            }
          ]
        })
      );
      return user;
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      const retry = await this.findByPrimarySubject(adapter, result.subject);
      if (retry) return retry;
      if (await this.findByEmail(result.email)) throw new AcError("email_already_exists", 409);
      throw new AcError("identity_conflict", 409);
    }
  }

  async update(userId: string, patch: Partial<AcUser>) {
    const currentItem = await this.getStoredUser(userId);
    const current = fromItem(currentItem as unknown as Record<string, unknown> | undefined);
    if (!current || !currentItem) throw new AcError("user_not_found", 404);
    if (patch.email && patch.email.trim().toLowerCase() !== current.email.trim().toLowerCase()) {
      throw new AcError("immutable_identity_field", 400);
    }
    if (patch.primarySubject && patch.primarySubject !== current.primarySubject) {
      throw new AcError("immutable_identity_field", 400);
    }

    const updated: AcUser = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString()
    };
    const version = currentItem.version ?? 1;
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.config.tableName,
          Item: toItem(updated, version + 1),
          ConditionExpression: "#version = :version",
          ExpressionAttributeNames: { "#version": "version" },
          ExpressionAttributeValues: { ":version": version }
        })
      );
      return updated;
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
        throw new AcError("concurrent_update", 409);
      }
      throw error;
    }
  }

  async updateLearnerProfile(userId: string, patch: LearnerProfilePatch) {
    const user = await this.findById(userId);
    if (!user) throw new AcError("user_not_found", 404);
    return this.update(userId, applyLearnerProfile(user, patch));
  }

  async linkIdentity(userId: string, identity: LinkedIdentity) {
    const currentItem = await this.getStoredUser(userId);
    const current = fromItem(currentItem as unknown as Record<string, unknown> | undefined);
    if (!current || !currentItem) throw new AcError("user_not_found", 404);

    const lockKey = identityKey(identity.provider, identity.subject);
    const lock = await this.get(lockKey);
    if (lock?.userId && lock.userId !== userId) throw new AcError("identity_already_linked", 409);

    const updated: AcUser = {
      ...current,
      identities: [
        ...current.identities.filter((item) => item.provider !== identity.provider),
        identity
      ],
      updatedAt: new Date().toISOString()
    };
    if (identity.provider === "opencampus") {
      updated.ocid = identity.displayHandle ?? identity.subject;
      updated.ethAddress = identity.ethAddress;
    } else if (identity.provider === "github") {
      updated.githubLogin = identity.displayHandle;
    } else if (identity.provider === "metamask") {
      updated.evmAddress = identity.ethAddress ?? identity.displayHandle;
      updated.metamaskWalletId = identity.ethAddress ?? identity.displayHandle;
    }

    const version = currentItem.version ?? 1;
    const transactItems = [
      ...(!lock
        ? [
            {
              Put: {
                TableName: this.config.tableName,
                Item: {
                  ...lockKey,
                  entityType: "IDENTITY_LOCK",
                  provider: identity.provider,
                  subject: identity.subject,
                  userId
                },
                ConditionExpression: "attribute_not_exists(pk)"
              }
            }
          ]
        : []),
      {
        Put: {
          TableName: this.config.tableName,
          Item: toItem(updated, version + 1),
          ConditionExpression: "#version = :version",
          ExpressionAttributeNames: { "#version": "version" },
          ExpressionAttributeValues: { ":version": version }
        }
      }
    ];

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
      return updated;
    } catch (error) {
      if (isTransactionConflict(error)) {
        const owner = await this.findByConnectSubject(identity.provider, identity.subject);
        if (owner && owner.id !== userId) throw new AcError("identity_already_linked", 409);
        throw new AcError("concurrent_update", 409);
      }
      throw error;
    }
  }

  async unlinkIdentity(userId: string, provider: ConnectProviderId) {
    const currentItem = await this.getStoredUser(userId);
    const current = fromItem(currentItem as unknown as Record<string, unknown> | undefined);
    if (!current || !currentItem) throw new AcError("user_not_found", 404);
    const identity = current.identities.find((item) => item.provider === provider);
    if (!identity) return current;

    const updated: AcUser = {
      ...current,
      identities: current.identities.filter((item) => item.provider !== provider),
      updatedAt: new Date().toISOString()
    };
    if (provider === "opencampus") {
      delete updated.ocid;
      delete updated.ethAddress;
    } else if (provider === "github") {
      delete updated.githubLogin;
    } else if (provider === "metamask") {
      delete updated.evmAddress;
      delete updated.metamaskWalletId;
    }

    const version = currentItem.version ?? 1;
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: this.config.tableName,
                Key: identityKey(provider, identity.subject),
                ConditionExpression: "userId = :userId",
                ExpressionAttributeValues: { ":userId": userId }
              }
            },
            {
              Put: {
                TableName: this.config.tableName,
                Item: toItem(updated, version + 1),
                ConditionExpression: "#version = :version",
                ExpressionAttributeNames: { "#version": "version" },
                ExpressionAttributeValues: { ":version": version }
              }
            }
          ]
        })
      );
      return updated;
    } catch (error) {
      if (isTransactionConflict(error)) throw new AcError("concurrent_update", 409);
      throw error;
    }
  }
}
