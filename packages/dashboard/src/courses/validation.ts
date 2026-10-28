import { CourseDomainError } from "./errors";
import type { CourseDraftContent, CourseLesson, CourseModule, LearningOutcome } from "./types";

export const COURSE_LIMITS = {
  modules: 20,
  lessonsPerModule: 30,
  outcomesPerLesson: 10,
  skillMappings: 20,
  estimatedMinutesPerLesson: 1440,
  serializedBytes: 300_000
} as const;

function text(value: string, field: string, min: number, max: number) {
  if (typeof value !== "string") throw new CourseDomainError("VALIDATION_ERROR", `Invalid ${field}`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < min || normalized.length > max || /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(normalized)) {
    throw new CourseDomainError("VALIDATION_ERROR", `Invalid ${field}`);
  }
  return normalized;
}

export function normalizeCourseCode(value: string) {
  const code = value.normalize("NFKC").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(code)) throw new CourseDomainError("VALIDATION_ERROR", "Invalid course code");
  return code;
}

function outcome(value: LearningOutcome): LearningOutcome {
  return {
    id: text(value.id, "outcome id", 1, 128),
    statement: text(value.statement, "outcome statement", 3, 500),
    skillId: text(value.skillId, "skill id", 1, 128),
    skillVersionId: text(value.skillVersionId, "skill version id", 1, 128),
    targetProficiencyCode: text(value.targetProficiencyCode, "target proficiency code", 1, 32)
  };
}

function lesson(value: CourseLesson): CourseLesson {
  if (!Number.isInteger(value.position) || value.position < 1) throw new CourseDomainError("VALIDATION_ERROR", "Invalid lesson position");
  if (!Number.isInteger(value.estimatedMinutes) || value.estimatedMinutes < 1 || value.estimatedMinutes > COURSE_LIMITS.estimatedMinutesPerLesson) {
    throw new CourseDomainError("VALIDATION_ERROR", "Invalid estimated minutes");
  }
  if (!Array.isArray(value.outcomes) || value.outcomes.length > COURSE_LIMITS.outcomesPerLesson) {
    throw new CourseDomainError("VALIDATION_ERROR", "Too many lesson outcomes");
  }
  return { id: text(value.id, "lesson id", 1, 128), title: text(value.title, "lesson title", 2, 160),
    summary: text(value.summary, "lesson summary", 3, 4000), position: value.position,
    estimatedMinutes: value.estimatedMinutes, outcomes: uniqueIds(value.outcomes.map(outcome), "outcome") };
}

function module(value: CourseModule): CourseModule {
  if (!Number.isInteger(value.position) || value.position < 1) throw new CourseDomainError("VALIDATION_ERROR", "Invalid module position");
  if (!Array.isArray(value.lessons) || value.lessons.length < 1 || value.lessons.length > COURSE_LIMITS.lessonsPerModule) {
    throw new CourseDomainError("VALIDATION_ERROR", "A module requires 1 to 30 lessons");
  }
  return { id: text(value.id, "module id", 1, 128), title: text(value.title, "module title", 2, 160),
    position: value.position, lessons: positions(uniqueIds(value.lessons.map(lesson), "lesson"), "lesson") };
}

function uniqueIds<T extends { id: string }>(items: T[], name: string) {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new CourseDomainError("VALIDATION_ERROR", `Duplicate ${name} id`);
  return items;
}

function positions<T extends { position: number }>(items: T[], name: string) {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  if (sorted.some((item, index) => item.position !== index + 1)) {
    throw new CourseDomainError("VALIDATION_ERROR", `${name} positions must be contiguous and start at 1`);
  }
  return sorted;
}

export function serializedCourseVersionBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function validateCourseDraft(input: CourseDraftContent): CourseDraftContent {
  if (!Array.isArray(input.modules) || input.modules.length < 1 || input.modules.length > COURSE_LIMITS.modules) {
    throw new CourseDomainError("VALIDATION_ERROR", "A course requires 1 to 20 modules");
  }
  const result = { title: text(input.title, "title", 2, 160), description: text(input.description, "description", 3, 4000),
    ownerUserId: text(input.ownerUserId, "ownerUserId", 1, 128), modules: positions(uniqueIds(input.modules.map(module), "module"), "module") };
  const outcomes = result.modules.flatMap((m) => m.lessons.flatMap((l) => l.outcomes));
  const versionsBySkill = new Map<string, string>();
  for (const outcome of outcomes) {
    const existing = versionsBySkill.get(outcome.skillId);
    if (existing && existing !== outcome.skillVersionId) throw new CourseDomainError("VALIDATION_ERROR", "A course version must pin one version per skill");
    versionsBySkill.set(outcome.skillId, outcome.skillVersionId);
  }
  const skillMappings = new Set(outcomes.map((o) => `${o.skillId}#${o.skillVersionId}`));
  if (skillMappings.size > COURSE_LIMITS.skillMappings) throw new CourseDomainError("VALIDATION_ERROR", "A course supports at most 20 skill mappings");
  if (serializedCourseVersionBytes(result) > COURSE_LIMITS.serializedBytes) {
    throw new CourseDomainError("VALIDATION_ERROR", "Course version exceeds 300000 serialized bytes");
  }
  return result;
}
