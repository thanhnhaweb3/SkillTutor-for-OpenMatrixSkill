import type { CourseVersion } from "@openmatrix/dashboard";
import { pickLang } from "../bilingual";
import type { CohortView, EnrollmentView, LearningGateway, LessonView } from "./gateway";

/**
 * The gateway as one learner sees it: bilingual course text ("English / Tiếng Việt", ENGLISH/TIẾNG VIỆT blocks)
 * reduced to their language. Writes and ids pass through untouched; single-language courses are unchanged.
 */
export function localizeGateway(gateway: LearningGateway, locale: string | undefined): LearningGateway {
  const p = <T extends string | undefined>(text: T) => pickLang(text, locale);
  const enrollment = (e: EnrollmentView): EnrollmentView => ({ ...e, courseTitle: p(e.courseTitle), cohortName: p(e.cohortName) });
  const lesson = (l: LessonView): LessonView => ({ ...l, title: p(l.title), summary: p(l.summary), moduleTitle: p(l.moduleTitle),
    outcomes: l.outcomes.map((o) => ({ ...o, statement: p(o.statement) })) });
  const version = (v: CourseVersion): CourseVersion => ({ ...v, title: p(v.title), description: p(v.description),
    modules: v.modules.map((m) => ({ ...m, title: p(m.title), lessons: m.lessons.map((l) => ({ ...l, title: p(l.title), summary: p(l.summary),
      outcomes: l.outcomes.map((o) => ({ ...o, statement: p(o.statement) })) })) })) });
  const cohort = (c: CohortView): CohortView => ({ ...c, name: p(c.name), courseTitle: p(c.courseTitle) });

  const map: Partial<Record<keyof LearningGateway, (value: never) => unknown>> = {
    listEnrollments: (rows: EnrollmentView[]) => rows.map(enrollment),
    getLessons: (rows: LessonView[]) => rows.map(lesson),
    getCourseVersion: (v: CourseVersion | null) => (v ? version(v) : v),
    skillNames: (names: Record<string, string>) => Object.fromEntries(Object.entries(names).map(([id, name]) => [id, p(name)])),
    listCohorts: (rows: CohortView[]) => rows.map(cohort)
  };
  return new Proxy(gateway, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = (value as (...a: unknown[]) => Promise<unknown>).bind(target);
      const after = map[prop as keyof LearningGateway];
      return after ? async (...args: unknown[]) => after((await fn(...args)) as never) : fn;
    }
  });
}
