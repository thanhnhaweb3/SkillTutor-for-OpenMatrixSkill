import type { AuditEvent } from "../core/types";
import { SkillDomainError } from "./errors";
import type { Skill, SkillFramework, SkillFrameworkVersion, SkillImportReceipt, SkillLifecycleStatus, SkillVersion } from "./types";

const SKILL_STATUSES = new Set<SkillLifecycleStatus>(["draft", "in_review", "published", "archived"]);

export function expertKey(expertId: string) {
  return { pk: `EXPERT#${expertId}`, sk: "META" };
}

export function frameworkKey(expertId: string, frameworkId: string) {
  return { pk: `EXPERT#${expertId}`, sk: `FRAMEWORK#${frameworkId}#META` };
}

export function frameworkVersionKey(expertId: string, frameworkId: string, versionNumber: number) {
  return {
    pk: `EXPERT#${expertId}`,
    sk: `FRAMEWORK#${frameworkId}#VERSION#${String(versionNumber).padStart(10, "0")}`
  };
}

export function frameworkItem(framework: SkillFramework) {
  return { ...frameworkKey(framework.expertId, framework.id), entityType: "SKILL_FRAMEWORK", ...framework };
}

export function frameworkVersionItem(version: SkillFrameworkVersion) {
  return { ...frameworkVersionKey(version.expertId, version.frameworkId, version.versionNumber), entityType: "SKILL_FRAMEWORK_VERSION", ...version };
}

export function skillKey(expertId: string, skillId: string) {
  return { pk: `EXPERT#${expertId}`, sk: `SKILL#${skillId}#META` };
}

export function skillVersionKey(expertId: string, skillId: string, versionNumber: number) {
  return {
    pk: `EXPERT#${expertId}`,
    sk: `SKILL#${skillId}#VERSION#${String(versionNumber).padStart(10, "0")}`
  };
}

export function skillCodeLockKey(expertId: string, frameworkId: string, code: string) {
  return { pk: `EXPERT#${expertId}`, sk: `SKILLCODE#${frameworkId}#${code}` };
}

export function skillImportReceiptKey(expertId: string, idempotencyKey: string) {
  return { pk: `EXPERT#${expertId}`, sk: `SKILLIMPORT#${idempotencyKey}` };
}

export function skillImportReceiptItem(receipt: SkillImportReceipt) {
  return { ...skillImportReceiptKey(receipt.expertId, receipt.idempotencyKey), entityType: "SKILL_IMPORT_RECEIPT", ...receipt };
}

export function toSkillImportReceipt(item: Record<string, unknown> | undefined): SkillImportReceipt | null {
  if (!item || item.entityType !== "SKILL_IMPORT_RECEIPT" || typeof item.expertId !== "string" ||
    typeof item.idempotencyKey !== "string" || typeof item.manifestHash !== "string" || !strings(item.skillIds) ||
    !strings(item.skillCodes) || typeof item.createdAt !== "string" || typeof item.createdBy !== "string") return null;
  return { expertId: item.expertId, idempotencyKey: item.idempotencyKey, manifestHash: item.manifestHash,
    skillIds: item.skillIds, skillCodes: item.skillCodes, createdAt: item.createdAt, createdBy: item.createdBy };
}

function indexText(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/#/g, "_");
}

export function skillIndexKey(skill: Skill) {
  return {
    gsi2pk: `EXPERT#${skill.expertId}#SKILLS`,
    gsi2sk: `STATUS#${skill.latestStatus}#OWNER#${skill.latestOwnerUserId}#NAME#${indexText(skill.latestName)}#SKILL#${skill.id}`
  };
}

export function skillItem(skill: Skill) {
  return { ...skillKey(skill.expertId, skill.id), ...skillIndexKey(skill), entityType: "SKILL", ...skill };
}

export function skillVersionItem(version: SkillVersion) {
  return { ...skillVersionKey(version.expertId, version.skillId, version.versionNumber), entityType: "SKILL_VERSION", ...version };
}

export function skillCodeLockItem(skill: Skill) {
  return {
    ...skillCodeLockKey(skill.expertId, skill.frameworkId, skill.code),
    entityType: "SKILL_CODE_LOCK",
    expertId: skill.expertId,
    frameworkId: skill.frameworkId,
    code: skill.code,
    skillId: skill.id,
    createdAt: skill.createdAt
  };
}

export function auditItem(auditTableName: string, audit: AuditEvent) {
  return {
    TableName: auditTableName,
    Item: {
      pk: `EXPERT#${audit.expertId}`,
      sk: `AUDIT#${audit.occurredAt}#${audit.eventId}`,
      entityType: "AUDIT_EVENT",
      ...audit
    },
    ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)"
  };
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function toSkill(item: Record<string, unknown> | undefined): Skill | null {
  if (!item || item.entityType !== "SKILL") return null;
  if (
    typeof item.id !== "string" || typeof item.expertId !== "string" || typeof item.frameworkId !== "string" ||
    typeof item.code !== "string" || typeof item.slug !== "string" || typeof item.latestVersionId !== "string" ||
    typeof item.latestVersionNumber !== "number" || !Number.isInteger(item.latestVersionNumber) ||
    typeof item.latestStatus !== "string" || !SKILL_STATUSES.has(item.latestStatus as SkillLifecycleStatus) ||
    typeof item.latestName !== "string" || typeof item.latestOwnerUserId !== "string" ||
    typeof item.version !== "number" || typeof item.createdAt !== "string" || typeof item.createdBy !== "string" ||
    typeof item.updatedAt !== "string" || typeof item.updatedBy !== "string"
  ) return null;
  return {
    id: item.id,
    expertId: item.expertId,
    frameworkId: item.frameworkId,
    code: item.code,
    slug: item.slug,
    currentPublishedVersionId: typeof item.currentPublishedVersionId === "string" ? item.currentPublishedVersionId : undefined,
    latestVersionId: item.latestVersionId,
    latestVersionNumber: item.latestVersionNumber,
    latestStatus: item.latestStatus as SkillLifecycleStatus,
    latestName: item.latestName,
    latestOwnerUserId: item.latestOwnerUserId,
    archivedAt: typeof item.archivedAt === "string" ? item.archivedAt : undefined,
    version: item.version,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy
  };
}

export function toSkillVersion(item: Record<string, unknown> | undefined): SkillVersion | null {
  if (!item || item.entityType !== "SKILL_VERSION") return null;
  if (
    typeof item.id !== "string" || typeof item.expertId !== "string" || typeof item.skillId !== "string" ||
    typeof item.versionNumber !== "number" || !Number.isInteger(item.versionNumber) ||
    typeof item.status !== "string" || !SKILL_STATUSES.has(item.status as SkillLifecycleStatus) ||
    typeof item.name !== "string" || typeof item.description !== "string" || !strings(item.outcomes) || !strings(item.tags) ||
    typeof item.ownerUserId !== "string" || typeof item.version !== "number" ||
    typeof item.createdAt !== "string" || typeof item.createdBy !== "string" ||
    typeof item.updatedAt !== "string" || typeof item.updatedBy !== "string"
  ) return null;
  return {
    id: item.id,
    expertId: item.expertId,
    skillId: item.skillId,
    versionNumber: item.versionNumber,
    status: item.status as SkillLifecycleStatus,
    name: item.name,
    description: item.description,
    outcomes: item.outcomes as string[],
    tags: item.tags as string[],
    ownerUserId: item.ownerUserId,
    submittedAt: typeof item.submittedAt === "string" ? item.submittedAt : undefined,
    submittedBy: typeof item.submittedBy === "string" ? item.submittedBy : undefined,
    reviewedAt: typeof item.reviewedAt === "string" ? item.reviewedAt : undefined,
    reviewedBy: typeof item.reviewedBy === "string" ? item.reviewedBy : undefined,
    reviewDecision: item.reviewDecision === "approved" || item.reviewDecision === "changes_requested" ? item.reviewDecision : undefined,
    reviewNote: typeof item.reviewNote === "string" ? item.reviewNote : undefined,
    publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : undefined,
    publishedBy: typeof item.publishedBy === "string" ? item.publishedBy : undefined,
    version: item.version,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy
  };
}

export function toFramework(item: Record<string, unknown> | undefined): SkillFramework | null {
  if (!item || item.entityType !== "SKILL_FRAMEWORK") return null;
  if (
    typeof item.id !== "string" || typeof item.expertId !== "string" || typeof item.name !== "string" ||
    typeof item.currentVersionNumber !== "number" || typeof item.version !== "number" ||
    typeof item.createdAt !== "string" || typeof item.createdBy !== "string" ||
    typeof item.updatedAt !== "string" || typeof item.updatedBy !== "string"
  ) return null;
  return {
    id: item.id,
    expertId: item.expertId,
    name: item.name,
    currentVersionNumber: item.currentVersionNumber,
    version: item.version,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy
  };
}

export function toFrameworkVersion(item: Record<string, unknown> | undefined): SkillFrameworkVersion | null {
  if (!item || item.entityType !== "SKILL_FRAMEWORK_VERSION" || !Array.isArray(item.proficiencyLevels)) return null;
  if (
    typeof item.id !== "string" || typeof item.expertId !== "string" || typeof item.frameworkId !== "string" ||
    typeof item.versionNumber !== "number" || !Number.isInteger(item.versionNumber) || typeof item.name !== "string" ||
    typeof item.createdAt !== "string" || typeof item.createdBy !== "string"
  ) return null;
  const levels = item.proficiencyLevels.filter((level): level is { code: string; rank: number; name: string; description: string } => {
    if (!level || typeof level !== "object") return false;
    const value = level as Record<string, unknown>;
    return typeof value.code === "string" && typeof value.rank === "number" && Number.isInteger(value.rank) &&
      typeof value.name === "string" && typeof value.description === "string";
  });
  if (levels.length !== item.proficiencyLevels.length || levels.length < 2) return null;
  return {
    id: item.id,
    expertId: item.expertId,
    frameworkId: item.frameworkId,
    versionNumber: item.versionNumber,
    name: item.name,
    description: typeof item.description === "string" ? item.description : undefined,
    proficiencyLevels: levels,
    publishedAt: typeof item.publishedAt === "string" ? item.publishedAt : undefined,
    publishedBy: typeof item.publishedBy === "string" ? item.publishedBy : undefined,
    createdAt: item.createdAt,
    createdBy: item.createdBy
  };
}

type CursorKey = Record<string, string | number>;

export function encodeCursor(key: Record<string, unknown> | undefined) {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify({ v: 1, key }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): CursorKey | undefined {
  if (!cursor) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; key?: unknown };
    if (payload.v !== 1 || !payload.key || typeof payload.key !== "object" || Array.isArray(payload.key)) throw new Error();
    const entries = Object.entries(payload.key as Record<string, unknown>);
    if (entries.length === 0 || entries.some(([, value]) => typeof value !== "string" && typeof value !== "number")) throw new Error();
    return Object.fromEntries(entries) as CursorKey;
  } catch {
    throw new SkillDomainError("VALIDATION_ERROR", "Invalid pagination cursor");
  }
}
