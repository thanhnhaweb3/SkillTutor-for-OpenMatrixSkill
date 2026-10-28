import type { AuditEvent } from "../core/types";
import { SkillDomainError } from "./errors";
import type { CreateNextSkillVersionCommit, CreateSkillCommit, SeedSkillFrameworkCommit, SkillImportCommit, SkillListQuery, SkillRepository, SkillVersionMutationCommit } from "./repository";
import type { Skill, SkillFramework, SkillFrameworkVersion, SkillImportReceipt, SkillVersion } from "./types";

export class InMemorySkillRepository implements SkillRepository {
  readonly audits: AuditEvent[] = [];
  private readonly frameworks: SkillFramework[];
  private readonly frameworkVersions: SkillFrameworkVersion[];
  private readonly skills: Skill[];
  private readonly versions: SkillVersion[];
  private readonly importReceipts: SkillImportReceipt[] = [];

  constructor(seed: { frameworks?: SkillFramework[]; frameworkVersions?: SkillFrameworkVersion[]; skills?: Skill[]; versions?: SkillVersion[] } = {}) {
    this.frameworks = [...(seed.frameworks ?? [])];
    this.frameworkVersions = [...(seed.frameworkVersions ?? [])];
    this.skills = [...(seed.skills ?? [])];
    this.versions = [...(seed.versions ?? [])];
  }

  async getFramework(expertId: string, frameworkId: string) {
    return this.frameworks.find((item) => item.expertId === expertId && item.id === frameworkId) ?? null;
  }

  async getFrameworkVersion(expertId: string, frameworkId: string, versionNumber: number) {
    return this.frameworkVersions.find((item) =>
      item.expertId === expertId && item.frameworkId === frameworkId && item.versionNumber === versionNumber
    ) ?? null;
  }

  async listFrameworks(expertId: string) {
    return this.frameworks.filter((item) => item.expertId === expertId).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSkill(expertId: string, skillId: string) {
    return this.skills.find((item) => item.expertId === expertId && item.id === skillId) ?? null;
  }

  async getSkillVersion(expertId: string, skillId: string, versionNumber: number) {
    return this.versions.find(
      (item) => item.expertId === expertId && item.skillId === skillId && item.versionNumber === versionNumber
    ) ?? null;
  }

  async listSkills(input: SkillListQuery) {
    if (input.limit < 1 || input.limit > 100 || input.ownerUserId && !input.status) {
      throw new SkillDomainError("VALIDATION_ERROR");
    }
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new SkillDomainError("VALIDATION_ERROR");
    const matches = this.skills
      .filter((item) => item.expertId === input.expertId)
      .filter((item) => !input.status || item.latestStatus === input.status)
      .filter((item) => !input.ownerUserId || item.latestOwnerUserId === input.ownerUserId)
      .sort((a, b) => a.latestName.localeCompare(b.latestName) || a.id.localeCompare(b.id));
    const items = matches.slice(offset, offset + input.limit);
    const next = offset + items.length;
    return { items, cursor: next < matches.length ? String(next) : undefined };
  }

  async listSkillVersions(input: { expertId: string; skillId: string; cursor?: string; limit: number }) {
    if (input.limit < 1 || input.limit > 100) throw new SkillDomainError("VALIDATION_ERROR");
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new SkillDomainError("VALIDATION_ERROR");
    const matches = this.versions
      .filter((item) => item.expertId === input.expertId && item.skillId === input.skillId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
    const items = matches.slice(offset, offset + input.limit);
    const next = offset + items.length;
    return { items, cursor: next < matches.length ? String(next) : undefined };
  }

  async getQuotaUsage(expertId: string) {
    const skills = this.skills.filter((item) => item.expertId === expertId);
    return {
      createdSkillCount: skills.length,
      publishedSkillCount: skills.filter((item) => item.currentPublishedVersionId).length,
      completedCourseCount: 0
    };
  }

  async getImportReceipt(expertId: string, idempotencyKey: string) {
    return this.importReceipts.find((item) => item.expertId === expertId && item.idempotencyKey === idempotencyKey) ?? null;
  }

  async commitCreateSkill(input: CreateSkillCommit) {
    const duplicate = this.skills.some((item) =>
      item.expertId === input.skill.expertId &&
      (item.id === input.skill.id || item.frameworkId === input.skill.frameworkId && item.code === input.skill.code)
    );
    if (duplicate || input.version.expertId !== input.skill.expertId || input.version.skillId !== input.skill.id) {
      throw this.conflict();
    }
    this.skills.push(input.skill);
    this.versions.push(input.version);
    this.audits.push(input.audit);
  }

  async commitSeedFramework(input: SeedSkillFrameworkCommit) {
    const duplicate = this.frameworks.some((item) =>
      item.expertId === input.framework.expertId && (item.id === input.framework.id || item.name === input.framework.name)
    );
    if (duplicate || input.version.expertId !== input.framework.expertId ||
      input.version.frameworkId !== input.framework.id || input.version.versionNumber !== 1) throw this.conflict();
    this.frameworks.push(input.framework);
    this.frameworkVersions.push(input.version);
    this.audits.push(input.audit);
  }

  async commitSkillImport(input: SkillImportCommit) {
    if (await this.getImportReceipt(input.receipt.expertId, input.receipt.idempotencyKey) || input.skills.some(({ skill }) =>
      this.skills.some((current) => current.expertId === skill.expertId && (current.id === skill.id || current.frameworkId === skill.frameworkId && current.code === skill.code)))) throw this.conflict();
    for (const item of input.skills) { this.skills.push(item.skill); this.versions.push(item.version); }
    this.importReceipts.push(input.receipt); this.audits.push(input.audit);
  }

  async commitVersionMutation(input: SkillVersionMutationCommit) {
    const skillIndex = this.skills.findIndex(
      (item) => item.expertId === input.previousSkill.expertId && item.id === input.previousSkill.id
    );
    const versionIndex = this.versions.findIndex(
      (item) => item.expertId === input.previousVersion.expertId && item.skillId === input.previousVersion.skillId &&
        item.versionNumber === input.previousVersion.versionNumber
    );
    const currentSkill = this.skills[skillIndex];
    const currentVersion = this.versions[versionIndex];
    if (
      !currentSkill || !currentVersion || currentSkill.version !== input.previousSkill.version ||
      currentVersion.version !== input.previousVersion.version || input.nextSkill.expertId !== currentSkill.expertId ||
      input.nextVersion.expertId !== currentVersion.expertId || input.nextVersion.skillId !== currentSkill.id ||
      input.nextVersion.versionNumber !== currentVersion.versionNumber || input.nextVersion.id !== currentVersion.id
    ) throw this.conflict();
    this.skills[skillIndex] = input.nextSkill;
    this.versions[versionIndex] = input.nextVersion;
    this.audits.push(input.audit);
  }

  async commitCreateNextVersion(input: CreateNextSkillVersionCommit) {
    const skillIndex = this.skills.findIndex(
      (item) => item.expertId === input.previousSkill.expertId && item.id === input.previousSkill.id
    );
    const currentSkill = this.skills[skillIndex];
    const duplicateVersion = this.versions.some((item) =>
      item.expertId === input.version.expertId && item.skillId === input.version.skillId &&
      (item.id === input.version.id || item.versionNumber === input.version.versionNumber)
    );
    if (
      !currentSkill || currentSkill.version !== input.previousSkill.version || duplicateVersion ||
      input.nextSkill.expertId !== currentSkill.expertId || input.version.expertId !== currentSkill.expertId ||
      input.version.skillId !== currentSkill.id || input.version.versionNumber !== currentSkill.latestVersionNumber + 1
    ) throw this.conflict();
    this.skills[skillIndex] = input.nextSkill;
    this.versions.push(input.version);
    this.audits.push(input.audit);
  }

  private conflict() {
    const error = new Error("Skill repository transaction conflict");
    error.name = "TransactionCanceledException";
    return error;
  }
}
