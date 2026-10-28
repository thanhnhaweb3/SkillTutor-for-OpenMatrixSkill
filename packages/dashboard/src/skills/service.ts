import { createHash, randomUUID } from "node:crypto";
import type { DashboardRepository } from "../data/repositories";
import type { AuditEvent, ExpertContext, MembershipTier, Permission } from "../core/types";
import { SkillDomainError } from "./errors";
import { freeSkillLimit, requireFreeSkillCapacity } from "./quota";
import type { SkillListQuery, SkillRepository } from "./repository";
import type { Skill, SkillDraftContent, SkillVersion } from "./types";
import { normalizeSkillCode, validateSkillDraft } from "./validation";
import { validateCanonicalSkillImport } from "./import";
import { createNextDraft, publishVersion, requestChanges, submitForReview, updateDraft } from "./workflow";

function requirePermission(context: ExpertContext, permission: Permission) {
  if (!context.permissions.includes(permission)) throw new SkillDomainError("MISSING_PERMISSION");
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function slug(name: string, suffix: string) {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "skill";
  return `${base}-${suffix.slice(0, 8)}`;
}

export class SkillService {
  constructor(
    private readonly repository: SkillRepository,
    private readonly dashboardRepository: DashboardRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID
  ) {}

  async list(input: { context: ExpertContext; query: Omit<SkillListQuery, "expertId"> }) {
    requirePermission(input.context, "skill:read");
    const elevated = input.context.roles.some((role) => ["platform_admin", "expert_admin", "curriculum_manager", "reviewer", "auditor"].includes(role));
    const query = elevated ? input.query : { ...input.query, status: "published" as const, ownerUserId: undefined };
    return this.repository.listSkills({ ...query, expertId: input.context.expertId });
  }

  async listFrameworks(context: ExpertContext) {
    requirePermission(context, "skill:read");
    return this.repository.listFrameworks(context.expertId);
  }

  async get(input: { context: ExpertContext; skillId: string; versionNumber?: number }) {
    requirePermission(input.context, "skill:read");
    const skill = await this.repository.getSkill(input.context.expertId, input.skillId);
    if (!skill) throw new SkillDomainError("OUTSIDE_EXPERT");
    const number = input.versionNumber ?? skill.latestVersionNumber;
    const version = await this.repository.getSkillVersion(input.context.expertId, skill.id, number);
    if (!version) throw new SkillDomainError("OUTSIDE_EXPERT");
    const elevated = input.context.roles.some((role) => ["platform_admin", "expert_admin", "curriculum_manager", "reviewer", "auditor"].includes(role));
    if (!elevated && version.status !== "published" && version.ownerUserId !== input.context.userId) {
      throw new SkillDomainError("OUTSIDE_EXPERT");
    }
    return { skill, version };
  }

  async create(input: {
    context: ExpertContext;
    tier: MembershipTier;
    frameworkId: string;
    code: string;
    content: SkillDraftContent;
    requestId: string;
  }) {
    requirePermission(input.context, "skill:create");
    const framework = await this.repository.getFramework(input.context.expertId, input.frameworkId);
    if (!framework) throw new SkillDomainError("OUTSIDE_EXPERT");
    await this.requireActiveOwner(input.context.expertId, input.content.ownerUserId);
    if (input.tier === "free") requireFreeSkillCapacity(await this.repository.getQuotaUsage(input.context.expertId));
    const content = validateSkillDraft(input.content);
    const code = normalizeSkillCode(input.code);
    const createdAt = this.now().toISOString();
    const skillId = `skill_${this.id()}`;
    const versionId = `skillv_${this.id()}`;
    const skill: Skill = {
      id: skillId, expertId: input.context.expertId, frameworkId: framework.id, code,
      slug: slug(content.name, skillId), latestVersionId: versionId, latestVersionNumber: 1,
      latestStatus: "draft", latestName: content.name, latestOwnerUserId: content.ownerUserId,
      version: 1, createdAt, createdBy: input.context.userId, updatedAt: createdAt, updatedBy: input.context.userId
    };
    const version: SkillVersion = {
      id: versionId, expertId: skill.expertId, skillId, versionNumber: 1, status: "draft",
      ...content, version: 1, createdAt, createdBy: input.context.userId, updatedAt: createdAt, updatedBy: input.context.userId
    };
    await this.repository.commitCreateSkill({ skill, version, audit: this.audit(input.context, input.requestId, "skill:create", skill.id, undefined, version) });
    return { skill, version };
  }

  async importSkills(input: { context: ExpertContext; tier: MembershipTier; manifest: unknown; idempotencyKey: string; requestId: string }) {
    requirePermission(input.context, "skill:create");
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(input.idempotencyKey)) throw new SkillDomainError("VALIDATION_ERROR", "Invalid idempotency key");
    const preview = validateCanonicalSkillImport(input.manifest, input.context.userId);
    const manifestHash = hash(preview);
    const prior = await this.repository.getImportReceipt(input.context.expertId, input.idempotencyKey);
    if (prior) {
      if (prior.manifestHash !== manifestHash) throw new SkillDomainError("VERSION_CONFLICT", "Idempotency key was used for a different manifest");
      return { receipt: prior, replayed: true };
    }
    const framework = await this.repository.getFramework(input.context.expertId, preview.frameworkId);
    if (!framework) throw new SkillDomainError("OUTSIDE_EXPERT");
    await this.requireActiveOwner(input.context.expertId, input.context.userId);
    if (input.tier === "free") {
      const usage = await this.repository.getQuotaUsage(input.context.expertId);
      const limit = freeSkillLimit(usage);
      if (usage.createdSkillCount + preview.count > limit) throw new SkillDomainError("QUOTA_EXCEEDED", `Free skill quota reached (${limit})`);
    }
    const createdAt = this.now().toISOString();
    const records = preview.skills.map((item) => {
      const skillId = `skill_${this.id()}`; const versionId = `skillv_${this.id()}`;
      const skill: Skill = { id: skillId, expertId: input.context.expertId, frameworkId: framework.id, code: item.code,
        slug: slug(item.name, skillId), latestVersionId: versionId, latestVersionNumber: 1, latestStatus: "draft",
        latestName: item.name, latestOwnerUserId: input.context.userId, version: 1, createdAt, createdBy: input.context.userId,
        updatedAt: createdAt, updatedBy: input.context.userId };
      const version: SkillVersion = { id: versionId, expertId: skill.expertId, skillId, versionNumber: 1, status: "draft",
        name: item.name, description: item.description, outcomes: item.outcomes, tags: item.tags, ownerUserId: input.context.userId,
        version: 1, createdAt, createdBy: input.context.userId, updatedAt: createdAt, updatedBy: input.context.userId };
      return { skill, version };
    });
    const receipt = { expertId: input.context.expertId, idempotencyKey: input.idempotencyKey, manifestHash,
      skillIds: records.map(({ skill }) => skill.id), skillCodes: records.map(({ skill }) => skill.code), createdAt, createdBy: input.context.userId };
    try {
      await this.repository.commitSkillImport({ skills: records, receipt,
        audit: this.audit(input.context, input.requestId, "skill:import", input.idempotencyKey, undefined, { manifestHash, count: records.length }) });
      return { receipt, replayed: false };
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TransactionCanceledException") throw error;
      const raced = await this.repository.getImportReceipt(input.context.expertId, input.idempotencyKey);
      if (raced?.manifestHash === manifestHash) return { receipt: raced, replayed: true };
      throw error;
    }
  }

  async update(input: { context: ExpertContext; skillId: string; versionNumber: number; expectedVersion: number; content: SkillDraftContent; requestId: string }) {
    await this.requireActiveOwner(input.context.expertId, input.content.ownerUserId);
    return this.mutate(input, (current) => updateDraft({ ...input, current, now: this.now().toISOString() }), "skill:update_draft");
  }

  async submitReview(input: { context: ExpertContext; skillId: string; versionNumber: number; expectedVersion: number; requestId: string }) {
    return this.mutate(input, (current) => submitForReview({ ...input, current, now: this.now().toISOString() }), "skill:submit_review");
  }

  async requestChanges(input: { context: ExpertContext; skillId: string; versionNumber: number; expectedVersion: number; note: string; requestId: string }) {
    return this.mutate(input, (current) => requestChanges({ ...input, current, now: this.now().toISOString() }), "skill:changes_requested");
  }

  async publish(input: { context: ExpertContext; skillId: string; versionNumber: number; expectedVersion: number; requestId: string }) {
    return this.mutate(input, (current) => publishVersion({ ...input, current, now: this.now().toISOString() }), "skill:publish", true);
  }

  async nextDraft(input: { context: ExpertContext; skillId: string; requestId: string }) {
    const { skill, version: published } = await this.get({ context: input.context, skillId: input.skillId });
    const now = this.now().toISOString();
    const version = createNextDraft({ context: input.context, published, id: `skillv_${this.id()}`, now });
    const nextSkill: Skill = { ...skill, latestVersionId: version.id, latestVersionNumber: version.versionNumber, latestStatus: "draft", latestName: version.name, latestOwnerUserId: version.ownerUserId, version: skill.version + 1, updatedAt: now, updatedBy: input.context.userId };
    await this.repository.commitCreateNextVersion({ previousSkill: skill, nextSkill, version, audit: this.audit(input.context, input.requestId, "skill:create_next_version", skill.id, skill, nextSkill) });
    return { skill: nextSkill, version };
  }

  private async mutate(
    input: { context: ExpertContext; skillId: string; versionNumber: number; requestId: string },
    transition: (current: SkillVersion) => SkillVersion,
    action: string,
    published = false
  ) {
    const skill = await this.repository.getSkill(input.context.expertId, input.skillId);
    const current = await this.repository.getSkillVersion(input.context.expertId, input.skillId, input.versionNumber);
    if (!skill || !current || skill.latestVersionNumber !== current.versionNumber) throw new SkillDomainError("OUTSIDE_EXPERT");
    const version = transition(current);
    const nextSkill: Skill = {
      ...skill, latestStatus: version.status, latestName: version.name, latestOwnerUserId: version.ownerUserId,
      currentPublishedVersionId: published ? version.id : skill.currentPublishedVersionId,
      version: skill.version + 1, updatedAt: version.updatedAt, updatedBy: input.context.userId
    };
    await this.repository.commitVersionMutation({ previousSkill: skill, nextSkill, previousVersion: current, nextVersion: version, audit: this.audit(input.context, input.requestId, action, skill.id, current, version) });
    return { skill: nextSkill, version };
  }

  private async requireActiveOwner(expertId: string, userId: string) {
    const membership = await this.dashboardRepository.getMembership(expertId, userId);
    if (!membership || membership.status !== "active") throw new SkillDomainError("VALIDATION_ERROR", "Owner must be an active Expert member");
  }

  private audit(context: ExpertContext, requestId: string, action: string, targetId: string, before: unknown, after: unknown): AuditEvent {
    return {
      eventId: `audit_${this.id()}`, occurredAt: this.now().toISOString(), requestId,
      actorUserId: context.userId, expertId: context.expertId, action, targetType: "skill", targetId,
      result: "allowed", beforeHash: before ? hash(before) : undefined, afterHash: hash(after)
    };
  }
}
