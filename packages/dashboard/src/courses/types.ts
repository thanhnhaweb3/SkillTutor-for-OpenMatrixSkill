export type CourseLifecycleStatus = "draft" | "in_review" | "approved" | "published" | "archived";

export interface LearningOutcome {
  id: string;
  statement: string;
  skillId: string;
  skillVersionId: string;
  targetProficiencyCode: string;
}

export interface CourseLesson {
  id: string;
  title: string;
  summary: string;
  position: number;
  estimatedMinutes: number;
  outcomes: LearningOutcome[];
}

export interface CourseModule {
  id: string;
  title: string;
  position: number;
  lessons: CourseLesson[];
}

export interface CourseDraftContent {
  title: string;
  description: string;
  ownerUserId: string;
  modules: CourseModule[];
}

export interface Course {
  id: string;
  expertId: string;
  code: string;
  slug: string;
  latestVersionId: string;
  latestVersionNumber: number;
  latestStatus: CourseLifecycleStatus;
  latestTitle: string;
  latestOwnerUserId: string;
  currentPublishedVersionId?: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CourseVersion extends CourseDraftContent {
  id: string;
  expertId: string;
  courseId: string;
  versionNumber: number;
  status: CourseLifecycleStatus;
  submittedAt?: string;
  submittedBy?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  approvedAt?: string;
  approvedBy?: string;
  publishedAt?: string;
  publishedBy?: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CourseQuotaUsage {
  courseCount: number;
  publishedCourseCount: number;
  activeCohortCount: number;
}
