import { SkillDomainError } from "./errors";
import type { ProficiencyLevel, SkillDraftContent } from "./types";

function text(value: string, field: string, min: number, max: number) {
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max || /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(normalized)) {
    throw new SkillDomainError("VALIDATION_ERROR", `Invalid ${field}`);
  }
  return normalized;
}

export function normalizeSkillCode(value: string) {
  const code = value.normalize("NFKC").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(code)) {
    throw new SkillDomainError("VALIDATION_ERROR", "Invalid skill code");
  }
  return code;
}

export function validateSkillDraft(input: SkillDraftContent): SkillDraftContent {
  if (!Array.isArray(input.outcomes) || input.outcomes.length < 1 || input.outcomes.length > 20) {
    throw new SkillDomainError("VALIDATION_ERROR", "A skill requires 1 to 20 outcomes");
  }
  if (!Array.isArray(input.tags) || input.tags.length > 10) {
    throw new SkillDomainError("VALIDATION_ERROR", "A skill supports at most 10 tags");
  }
  const tags = new Map<string, string>();
  for (const rawTag of input.tags) {
    const tag = text(rawTag, "tag", 1, 32);
    tags.set(tag.toLocaleLowerCase("en-US"), tag);
  }
  return {
    name: text(input.name, "name", 2, 120),
    description: text(input.description, "description", 3, 4000),
    outcomes: input.outcomes.map((outcome) => text(outcome, "outcome", 3, 500)),
    tags: [...tags.values()],
    ownerUserId: text(input.ownerUserId, "ownerUserId", 1, 128)
  };
}

export function validateProficiencyLevels(input: ProficiencyLevel[]) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 10) {
    throw new SkillDomainError("VALIDATION_ERROR", "A framework requires 2 to 10 proficiency levels");
  }
  const ranks = new Set<number>();
  const codes = new Set<string>();
  const levels = input.map((level) => {
    if (!Number.isInteger(level.rank) || level.rank < 1 || ranks.has(level.rank)) {
      throw new SkillDomainError("VALIDATION_ERROR", "Proficiency ranks must be unique positive integers");
    }
    const code = normalizeSkillCode(level.code);
    if (codes.has(code)) throw new SkillDomainError("VALIDATION_ERROR", "Proficiency codes must be unique");
    ranks.add(level.rank);
    codes.add(code);
    return {
      code,
      rank: level.rank,
      name: text(level.name, "proficiency name", 1, 80),
      description: text(level.description, "proficiency description", 3, 500)
    };
  });
  return levels.sort((a, b) => a.rank - b.rank);
}

export function validateFrameworkInput(input: { name: string; description?: string; proficiencyLevels: ProficiencyLevel[] }) {
  return {
    name: text(input.name, "framework name", 2, 120),
    description: input.description === undefined ? undefined : text(input.description, "framework description", 3, 2000),
    proficiencyLevels: validateProficiencyLevels(input.proficiencyLevels)
  };
}
