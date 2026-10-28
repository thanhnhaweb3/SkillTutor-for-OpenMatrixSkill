import type { AuditEvent } from "../core/types";
import type { Course, CourseVersion } from "./types";
import type { CourseSkillMap } from "../skills/types";

export interface CourseListQuery { expertId: string; status?: Course["latestStatus"]; ownerUserId?: string; cursor?: string; limit: number }
export interface CoursePage<T> { items: T[]; cursor?: string }
export interface CreateCourseCommit { course: Course; version: CourseVersion; audit: AuditEvent }
export interface CourseVersionMutationCommit { previousCourse: Course; nextCourse: Course; previousVersion: CourseVersion; nextVersion: CourseVersion; skillMaps?: CourseSkillMap[]; audit: AuditEvent }
export interface CreateNextCourseVersionCommit { previousCourse: Course; nextCourse: Course; version: CourseVersion; audit: AuditEvent }

export interface CourseRepository {
  getCourse(expertId: string, courseId: string): Promise<Course | null>;
  getCourseVersion(expertId: string, courseId: string, versionNumber: number): Promise<CourseVersion | null>;
  listCourses(input: CourseListQuery): Promise<CoursePage<Course>>;
  listCourseVersions(input: { expertId: string; courseId: string; cursor?: string; limit: number }): Promise<CoursePage<CourseVersion>>;
  listCoursesBySkill(input: { expertId: string; skillId: string; status?: Course["latestStatus"]; cursor?: string; limit: number }): Promise<CoursePage<Course>>;
  getQuotaUsage(expertId: string): Promise<import("./types").CourseQuotaUsage>;
  commitCreateCourse(input: CreateCourseCommit): Promise<void>;
  commitVersionMutation(input: CourseVersionMutationCommit): Promise<void>;
  commitCreateNextVersion(input: CreateNextCourseVersionCommit): Promise<void>;
}
