import type { AuditEvent } from "../core/types";
import { CourseDomainError } from "./errors";
import type { CourseRepository, CourseListQuery, CreateCourseCommit, CourseVersionMutationCommit, CreateNextCourseVersionCommit } from "./repository";
import type { Course, CourseVersion } from "./types";

export class InMemoryCourseRepository implements CourseRepository {
  readonly audits: AuditEvent[] = [];
  private readonly courses: Course[];
  private readonly versions: CourseVersion[];
  private readonly skillMaps: import("../skills/types").CourseSkillMap[] = [];

  constructor(seed: { courses?: Course[]; versions?: CourseVersion[] } = {}) {
    this.courses = structuredClone(seed.courses ?? []);
    this.versions = structuredClone(seed.versions ?? []);
  }
  async getCourse(expertId: string, courseId: string) { return structuredClone(this.courses.find((x) => x.expertId === expertId && x.id === courseId) ?? null); }
  async getCourseVersion(expertId: string, courseId: string, versionNumber: number) {
    return structuredClone(this.versions.find((x) => x.expertId === expertId && x.courseId === courseId && x.versionNumber === versionNumber) ?? null);
  }
  async listCourses(input: CourseListQuery) {
    const offset = cursor(input.cursor, input.limit);
    if (input.ownerUserId && !input.status) throw new CourseDomainError("VALIDATION_ERROR");
    const matches = this.courses.filter((x) => x.expertId === input.expertId)
      .filter((x) => !input.status || x.latestStatus === input.status)
      .filter((x) => !input.ownerUserId || x.latestOwnerUserId === input.ownerUserId)
      .sort((a, b) => a.latestTitle.localeCompare(b.latestTitle) || a.id.localeCompare(b.id));
    const items = matches.slice(offset, offset + input.limit);
    return { items: structuredClone(items), cursor: offset + items.length < matches.length ? String(offset + items.length) : undefined };
  }
  async listCourseVersions(input: { expertId: string; courseId: string; cursor?: string; limit: number }) {
    const offset = cursor(input.cursor, input.limit);
    const matches = this.versions.filter((x) => x.expertId === input.expertId && x.courseId === input.courseId).sort((a, b) => b.versionNumber - a.versionNumber);
    const items = matches.slice(offset, offset + input.limit);
    return { items: structuredClone(items), cursor: offset + items.length < matches.length ? String(offset + items.length) : undefined };
  }
  async listCoursesBySkill(input: { expertId: string; skillId: string; status?: Course["latestStatus"]; cursor?: string; limit: number }) {
    const offset = cursor(input.cursor, input.limit);
    const ids = new Set(this.skillMaps.filter((x) => x.expertId === input.expertId && x.skillId === input.skillId).map((x) => x.courseId));
    const matches = this.courses.filter((x) => x.expertId === input.expertId && ids.has(x.id) && (!input.status || x.latestStatus === input.status)).sort((a, b) => a.latestTitle.localeCompare(b.latestTitle));
    const items = matches.slice(offset, offset + input.limit);
    return { items: structuredClone(items), cursor: offset + items.length < matches.length ? String(offset + items.length) : undefined };
  }
  async getQuotaUsage(expertId: string) {
    const courses = this.courses.filter((x) => x.expertId === expertId);
    return { courseCount: courses.length, publishedCourseCount: courses.filter((x) => !!x.currentPublishedVersionId).length, activeCohortCount: 0 };
  }
  async commitCreateCourse(input: CreateCourseCommit) {
    if (input.course.expertId !== input.version.expertId || input.course.id !== input.version.courseId ||
      this.courses.some((x) => x.expertId === input.course.expertId && (x.id === input.course.id || x.code === input.course.code))) throw conflict();
    this.courses.push(structuredClone(input.course)); this.versions.push(structuredClone(input.version)); this.audits.push(structuredClone(input.audit));
  }
  async commitVersionMutation(input: CourseVersionMutationCommit) {
    const ci = this.courses.findIndex((x) => x.expertId === input.previousCourse.expertId && x.id === input.previousCourse.id);
    const vi = this.versions.findIndex((x) => x.expertId === input.previousVersion.expertId && x.courseId === input.previousVersion.courseId && x.versionNumber === input.previousVersion.versionNumber);
    const course = this.courses[ci], version = this.versions[vi];
    if (!course || !version || course.version !== input.previousCourse.version || version.version !== input.previousVersion.version ||
      input.nextCourse.expertId !== course.expertId || input.nextVersion.expertId !== course.expertId || input.nextVersion.courseId !== course.id || input.nextVersion.id !== version.id) throw conflict();
    this.courses[ci] = structuredClone(input.nextCourse); this.versions[vi] = structuredClone(input.nextVersion);
    this.skillMaps.push(...structuredClone(input.skillMaps ?? [])); this.audits.push(structuredClone(input.audit));
  }
  async commitCreateNextVersion(input: CreateNextCourseVersionCommit) {
    const ci = this.courses.findIndex((x) => x.expertId === input.previousCourse.expertId && x.id === input.previousCourse.id);
    const course = this.courses[ci];
    if (!course || course.version !== input.previousCourse.version || input.nextCourse.expertId !== course.expertId ||
      input.version.expertId !== course.expertId || input.version.courseId !== course.id || input.version.versionNumber !== course.latestVersionNumber + 1 ||
      this.versions.some((x) => x.expertId === input.version.expertId && x.courseId === input.version.courseId && (x.id === input.version.id || x.versionNumber === input.version.versionNumber))) throw conflict();
    this.courses[ci] = structuredClone(input.nextCourse); this.versions.push(structuredClone(input.version)); this.audits.push(structuredClone(input.audit));
  }
}

function cursor(value: string | undefined, limit: number) {
  const offset = value ? Number.parseInt(value, 10) : 0;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new CourseDomainError("VALIDATION_ERROR");
  return offset;
}
function conflict() { const error = new Error("Course repository transaction conflict"); error.name = "TransactionCanceledException"; return error; }
