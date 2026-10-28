import { CourseDomainError } from "./errors";
import type { CourseQuotaUsage } from "./types";

export const FREE_COURSE_QUOTA = { courses: 3, publishedCourses: 1, activeCohorts: 1 } as const;

export function requireFreeCourseCapacity(usage: CourseQuotaUsage) {
  if (usage.courseCount >= FREE_COURSE_QUOTA.courses) throw new CourseDomainError("QUOTA_EXCEEDED", "Free course quota exceeded");
  return { allowed: true as const, limit: FREE_COURSE_QUOTA.courses, remainingAfterCreate: FREE_COURSE_QUOTA.courses - usage.courseCount - 1 };
}

export function requireFreePublishCapacity(usage: CourseQuotaUsage, alreadyPublished: boolean) {
  if (!alreadyPublished && usage.publishedCourseCount >= FREE_COURSE_QUOTA.publishedCourses) {
    throw new CourseDomainError("QUOTA_EXCEEDED", "Free published course quota exceeded");
  }
}

export function requireFreeActiveCohortCapacity(usage: CourseQuotaUsage) {
  if (usage.activeCohortCount >= FREE_COURSE_QUOTA.activeCohorts) throw new CourseDomainError("QUOTA_EXCEEDED", "Free active cohort quota exceeded");
}
