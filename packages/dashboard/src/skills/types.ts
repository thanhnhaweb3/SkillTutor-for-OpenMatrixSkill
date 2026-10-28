export type SkillLifecycleStatus = "draft" | "in_review" | "published" | "archived";
export type ReviewDecision = "approved" | "changes_requested";

export interface ProficiencyLevel {
  code: string;
  rank: number;
  name: string;
  description: string;
}

export interface SkillFramework {
  id: string;
  expertId: string;
  name: string;
  currentVersionNumber: number;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SkillFrameworkVersion {
  id: string;
  expertId: string;
  frameworkId: string;
  versionNumber: number;
  name: string;
  description?: string;
  proficiencyLevels: ProficiencyLevel[];
  publishedAt?: string;
  publishedBy?: string;
  createdAt: string;
  createdBy: string;
}

export interface Skill {
  id: string;
  expertId: string;
  frameworkId: string;
  code: string;
  slug: string;
  currentPublishedVersionId?: string;
  latestVersionId: string;
  latestVersionNumber: number;
  latestStatus: SkillLifecycleStatus;
  latestName: string;
  latestOwnerUserId: string;
  archivedAt?: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SkillVersion {
  id: string;
  expertId: string;
  skillId: string;
  versionNumber: number;
  status: SkillLifecycleStatus;
  name: string;
  description: string;
  outcomes: string[];
  tags: string[];
  ownerUserId: string;
  submittedAt?: string;
  submittedBy?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewDecision?: ReviewDecision;
  reviewNote?: string;
  publishedAt?: string;
  publishedBy?: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SkillRoadmapItem {
  id: string;
  expertId: string;
  skillId: string;
  ownerUserId: string;
  targetPeriod: string;
  milestone: string;
  status: "planned" | "in_progress" | "done" | "cancelled";
  version: number;
}

export interface CourseSkillMap {
  expertId: string;
  courseId: string;
  skillId: string;
  skillVersionId: string;
  targetProficiencyCode: string;
  createdAt: string;
  createdBy: string;
}

export interface SkillDraftContent {
  name: string;
  description: string;
  outcomes: string[];
  tags: string[];
  ownerUserId: string;
}

export interface SkillImportReceipt {
  expertId: string;
  idempotencyKey: string;
  manifestHash: string;
  skillIds: string[];
  skillCodes: string[];
  createdAt: string;
  createdBy: string;
}
