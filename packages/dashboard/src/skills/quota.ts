import { SkillDomainError } from "./errors";

export interface FreeSkillQuotaUsage {
  createdSkillCount: number;
  publishedSkillCount: number;
  completedCourseCount: number;
}

export function freeSkillLimit(input: Pick<FreeSkillQuotaUsage, "publishedSkillCount" | "completedCourseCount">) {
  const published = Math.max(0, Math.trunc(input.publishedSkillCount));
  const completed = Math.max(0, Math.trunc(input.completedCourseCount));
  return 3 + (published + completed) * 3;
}

export function requireFreeSkillCapacity(input: FreeSkillQuotaUsage) {
  const limit = freeSkillLimit(input);
  if (!Number.isInteger(input.createdSkillCount) || input.createdSkillCount < 0 || input.createdSkillCount >= limit) {
    throw new SkillDomainError("QUOTA_EXCEEDED", `Free skill quota reached (${limit})`);
  }
  return { allowed: true as const, limit, remainingAfterCreate: limit - input.createdSkillCount - 1 };
}
