import { SkillDomainError } from "./errors";
import type { SkillDraftContent } from "./types";
import { normalizeSkillCode, validateSkillDraft } from "./validation";

export interface CanonicalSkillImportItem extends Omit<SkillDraftContent, "ownerUserId"> { code: string }
export interface CanonicalSkillImport { schemaVersion: 1; frameworkId: string; skills: CanonicalSkillImportItem[] }
export interface SkillImportPreview { frameworkId: string; count: number; skills: CanonicalSkillImportItem[] }

const rootKeys = new Set(["schemaVersion", "frameworkId", "skills"]);
const skillKeys = new Set(["code", "name", "description", "outcomes", "tags"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SkillDomainError("VALIDATION_ERROR", `${label} must be an object`);
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new SkillDomainError("VALIDATION_ERROR", `${label} contains unknown field: ${unknown}`);
}

export function validateCanonicalSkillImport(value: unknown, ownerUserId: string): SkillImportPreview {
  const input = record(value, "manifest");
  rejectUnknown(input, rootKeys, "manifest");
  if (input.schemaVersion !== 1) throw new SkillDomainError("VALIDATION_ERROR", "schemaVersion must be 1");
  if (typeof input.frameworkId !== "string" || !input.frameworkId.trim()) throw new SkillDomainError("VALIDATION_ERROR", "frameworkId is required");
  if (!Array.isArray(input.skills) || input.skills.length < 1 || input.skills.length > 25) {
    throw new SkillDomainError("VALIDATION_ERROR", "skills must contain 1 to 25 items");
  }
  const codes = new Set<string>();
  const skills = input.skills.map((raw, index) => {
    const item = record(raw, `skills[${index}]`);
    rejectUnknown(item, skillKeys, `skills[${index}]`);
    if (typeof item.code !== "string" || typeof item.name !== "string" || typeof item.description !== "string" ||
      !Array.isArray(item.outcomes) || !Array.isArray(item.tags)) throw new SkillDomainError("VALIDATION_ERROR", `skills[${index}] has an invalid shape`);
    const code = normalizeSkillCode(item.code);
    if (codes.has(code)) throw new SkillDomainError("VALIDATION_ERROR", `Duplicate skill code: ${code}`);
    codes.add(code);
    const content = validateSkillDraft({
      name: item.name, description: item.description, outcomes: item.outcomes as string[],
      tags: item.tags as string[], ownerUserId
    });
    return { code, name: content.name, description: content.description, outcomes: content.outcomes, tags: content.tags };
  });
  return { frameworkId: input.frameworkId.trim(), count: skills.length, skills };
}
