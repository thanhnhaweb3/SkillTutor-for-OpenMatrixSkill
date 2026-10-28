import type { AuditEvent } from "../core/types";
import type { Skill, SkillFramework, SkillFrameworkVersion, SkillImportReceipt, SkillVersion } from "./types";

export interface Page<T> {
  items: T[];
  cursor?: string;
}

export interface SkillListQuery {
  expertId: string;
  status?: SkillVersion["status"];
  ownerUserId?: string;
  cursor?: string;
  limit: number;
}

export interface CreateSkillCommit {
  skill: Skill;
  version: SkillVersion;
  audit: AuditEvent;
}

export interface SkillVersionMutationCommit {
  previousSkill: Skill;
  nextSkill: Skill;
  previousVersion: SkillVersion;
  nextVersion: SkillVersion;
  audit: AuditEvent;
}

export interface CreateNextSkillVersionCommit {
  previousSkill: Skill;
  nextSkill: Skill;
  version: SkillVersion;
  audit: AuditEvent;
}

export interface SeedSkillFrameworkCommit {
  framework: SkillFramework;
  version: SkillFrameworkVersion;
  audit: AuditEvent;
}

export interface SkillImportCommit {
  skills: Array<{ skill: Skill; version: SkillVersion }>;
  receipt: SkillImportReceipt;
  audit: AuditEvent;
}

export interface SkillRepository {
  getFramework(expertId: string, frameworkId: string): Promise<SkillFramework | null>;
  getFrameworkVersion(expertId: string, frameworkId: string, versionNumber: number): Promise<SkillFrameworkVersion | null>;
  listFrameworks(expertId: string): Promise<SkillFramework[]>;
  getSkill(expertId: string, skillId: string): Promise<Skill | null>;
  getSkillVersion(expertId: string, skillId: string, versionNumber: number): Promise<SkillVersion | null>;
  listSkills(input: SkillListQuery): Promise<Page<Skill>>;
  listSkillVersions(input: {
    expertId: string;
    skillId: string;
    cursor?: string;
    limit: number;
  }): Promise<Page<SkillVersion>>;
  getQuotaUsage(expertId: string): Promise<{ createdSkillCount: number; publishedSkillCount: number; completedCourseCount: number }>;
  getImportReceipt(expertId: string, idempotencyKey: string): Promise<SkillImportReceipt | null>;
  commitCreateSkill(input: CreateSkillCommit): Promise<void>;
  commitVersionMutation(input: SkillVersionMutationCommit): Promise<void>;
  commitCreateNextVersion(input: CreateNextSkillVersionCommit): Promise<void>;
  commitSeedFramework(input: SeedSkillFrameworkCommit): Promise<void>;
  commitSkillImport(input: SkillImportCommit): Promise<void>;
}
