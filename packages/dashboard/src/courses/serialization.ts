import type { CourseSkillMap } from "../skills/types";
import { CourseDomainError } from "./errors";
import type { Course, CourseLifecycleStatus, CourseVersion } from "./types";

const STATUSES = new Set<CourseLifecycleStatus>(["draft", "in_review", "approved", "published", "archived"]);
const string = (v: unknown): v is string => typeof v === "string";
const integer = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const optionalString = (v: unknown) => v === undefined || string(v);
const indexText = (v: string) => v.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/#/g, "_");

export const courseKey = (expertId: string, courseId: string) => ({ pk: `EXPERT#${expertId}`, sk: `COURSE#${courseId}#META` });
export const courseVersionKey = (expertId: string, courseId: string, versionNumber: number) =>
  ({ pk: `EXPERT#${expertId}`, sk: `COURSE#${courseId}#VERSION#${String(versionNumber).padStart(10, "0")}` });
export const courseCodeLockKey = (expertId: string, code: string) => ({ pk: `EXPERT#${expertId}`, sk: `COURSECODE#${code}` });
export const courseIndexKey = (course: Course) => ({ gsi2pk: `EXPERT#${course.expertId}#COURSES`,
  gsi2sk: `STATUS#${course.latestStatus}#OWNER#${course.latestOwnerUserId}#TITLE#${indexText(course.latestTitle)}#COURSE#${course.id}` });
export const courseItem = (course: Course) => ({ ...courseKey(course.expertId, course.id), ...courseIndexKey(course), entityType: "COURSE", ...course });
export const courseVersionItem = (version: CourseVersion) => ({ ...courseVersionKey(version.expertId, version.courseId, version.versionNumber), entityType: "COURSE_VERSION", ...version });
export const courseCodeLockItem = (course: Course) => ({ ...courseCodeLockKey(course.expertId, course.code), entityType: "COURSE_CODE_LOCK",
  expertId: course.expertId, code: course.code, courseId: course.id, createdAt: course.createdAt });
export const courseSkillMapKey = (map: CourseSkillMap, versionNumber: number) => ({ pk: `EXPERT#${map.expertId}`,
  sk: `COURSEMAP#SKILL#${map.skillId}#COURSE#${map.courseId}#VERSION#${String(versionNumber).padStart(10, "0")}` });
export const courseSkillMapItem = (map: CourseSkillMap, versionNumber: number) => ({ ...courseSkillMapKey(map, versionNumber),
  gsi2pk: `EXPERT#${map.expertId}#COURSES_BY_SKILL#${map.skillId}`, gsi2sk: `COURSE#${map.courseId}#VERSION#${String(versionNumber).padStart(10, "0")}`,
  entityType: "COURSE_SKILL_MAP", versionNumber, ...map });

export function toCourse(item: Record<string, unknown> | undefined): Course | null {
  if (!item || item.entityType !== "COURSE" || !string(item.id) || !string(item.expertId) || !string(item.code) || !string(item.slug) ||
    !string(item.latestVersionId) || !integer(item.latestVersionNumber) || !string(item.latestStatus) || !STATUSES.has(item.latestStatus as CourseLifecycleStatus) ||
    !string(item.latestTitle) || !string(item.latestOwnerUserId) || !optionalString(item.currentPublishedVersionId) || !integer(item.version) ||
    !string(item.createdAt) || !string(item.createdBy) || !string(item.updatedAt) || !string(item.updatedBy)) return null;
  return { id: item.id, expertId: item.expertId, code: item.code, slug: item.slug, latestVersionId: item.latestVersionId,
    latestVersionNumber: item.latestVersionNumber, latestStatus: item.latestStatus as CourseLifecycleStatus, latestTitle: item.latestTitle,
    latestOwnerUserId: item.latestOwnerUserId, currentPublishedVersionId: item.currentPublishedVersionId as string | undefined,
    version: item.version, createdAt: item.createdAt, createdBy: item.createdBy, updatedAt: item.updatedAt, updatedBy: item.updatedBy };
}

export function toCourseVersion(item: Record<string, unknown> | undefined): CourseVersion | null {
  if (!item || item.entityType !== "COURSE_VERSION" || !string(item.id) || !string(item.expertId) || !string(item.courseId) ||
    !integer(item.versionNumber) || !string(item.status) || !STATUSES.has(item.status as CourseLifecycleStatus) || !string(item.title) ||
    !string(item.description) || !string(item.ownerUserId) || !Array.isArray(item.modules) || !integer(item.version) || !string(item.createdAt) ||
    !string(item.createdBy) || !string(item.updatedAt) || !string(item.updatedBy)) return null;
  const modules = item.modules.map((raw) => {
    if (!raw || typeof raw !== "object") return null; const m = raw as Record<string, unknown>;
    if (!string(m.id) || !string(m.title) || !integer(m.position) || !Array.isArray(m.lessons)) return null;
    const lessons = m.lessons.map((value) => {
      if (!value || typeof value !== "object") return null; const l = value as Record<string, unknown>;
      if (!string(l.id) || !string(l.title) || !string(l.summary) || !integer(l.position) || !integer(l.estimatedMinutes) || !Array.isArray(l.outcomes)) return null;
      const outcomes = l.outcomes.map((value) => { if (!value || typeof value !== "object") return null; const o = value as Record<string, unknown>;
        return string(o.id) && string(o.statement) && string(o.skillId) && string(o.skillVersionId) && string(o.targetProficiencyCode)
          ? { id: o.id, statement: o.statement, skillId: o.skillId, skillVersionId: o.skillVersionId, targetProficiencyCode: o.targetProficiencyCode } : null; });
      return outcomes.some((x) => !x) ? null : { id: l.id, title: l.title, summary: l.summary, position: l.position, estimatedMinutes: l.estimatedMinutes, outcomes: outcomes as NonNullable<typeof outcomes[number]>[] };
    });
    return lessons.some((x) => !x) ? null : { id: m.id, title: m.title, position: m.position, lessons: lessons as NonNullable<typeof lessons[number]>[] };
  });
  if (modules.some((x) => !x)) return null;
  const optional = ["submittedAt", "submittedBy", "reviewedAt", "reviewedBy", "reviewNote", "approvedAt", "approvedBy", "publishedAt", "publishedBy"] as const;
  if (optional.some((key) => !optionalString(item[key]))) return null;
  return { id: item.id, expertId: item.expertId, courseId: item.courseId, versionNumber: item.versionNumber,
    status: item.status as CourseLifecycleStatus, title: item.title, description: item.description, ownerUserId: item.ownerUserId,
    modules: modules as NonNullable<typeof modules[number]>[], submittedAt: item.submittedAt as string | undefined, submittedBy: item.submittedBy as string | undefined,
    reviewedAt: item.reviewedAt as string | undefined, reviewedBy: item.reviewedBy as string | undefined, reviewNote: item.reviewNote as string | undefined,
    approvedAt: item.approvedAt as string | undefined, approvedBy: item.approvedBy as string | undefined, publishedAt: item.publishedAt as string | undefined,
    publishedBy: item.publishedBy as string | undefined, version: item.version, createdAt: item.createdAt, createdBy: item.createdBy, updatedAt: item.updatedAt, updatedBy: item.updatedBy };
}

type CursorKey = Record<string, string | number>;
export function encodeCourseCursor(key: Record<string, unknown> | undefined) { return key ? Buffer.from(JSON.stringify({ v: 1, key }), "utf8").toString("base64url") : undefined; }
export function decodeCourseCursor(value: string | undefined): CursorKey | undefined {
  if (!value) return undefined;
  try { const p = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { v?: unknown; key?: unknown };
    if (p.v !== 1 || !p.key || typeof p.key !== "object" || Array.isArray(p.key)) throw new Error();
    const entries = Object.entries(p.key as Record<string, unknown>); if (!entries.length || entries.some(([, v]) => !string(v) && typeof v !== "number")) throw new Error();
    return Object.fromEntries(entries) as CursorKey;
  } catch { throw new CourseDomainError("VALIDATION_ERROR", "Invalid pagination cursor"); }
}
