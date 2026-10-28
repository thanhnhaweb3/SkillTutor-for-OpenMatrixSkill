import { createHash } from "node:crypto";
import type { CourseVersion } from "@openmatrix/dashboard";
import type { SkillTutorRuntime } from "../runtime";
import { tr, type TutorLocale } from "../i18n";
import type { QuizQuestion, QuizSet } from "../types";
import { lessonsOf, type LessonView } from "./gateway";

const LETTERS = ["A", "B", "C", "D"];
const MAX_QUESTIONS = 6;

/** Evenly spaced picks so long courses are tested across every module, not just the first lessons. */
export function spread<T>(items: T[], k: number): T[] {
  if (items.length <= k) return items;
  return Array.from({ length: k }, (_, i) => items[Math.round((i * (items.length - 1)) / (k - 1))]);
}

function seededOrder<T>(items: T[], seed: string): T[] {
  return items
    .map((item, i) => ({ item, k: createHash("sha256").update(`${seed}:${i}`).digest("hex") }))
    .sort((a, b) => a.k.localeCompare(b.k))
    .map((x) => x.item);
}

/** Deterministic questions from OMS learning outcomes: "which outcome does lesson X deliver?". */
export const quizKey = (courseVersionId: string, locale: TutorLocale) => `${courseVersionId}#${locale}`;

export function rulesQuiz(lessons: LessonView[], locale: TutorLocale = "vi"): QuizQuestion[] {
  const withOutcome = lessons.filter((l) => l.outcomes.length > 0);
  if (withOutcome.length < 2) return [];
  return spread(withOutcome, MAX_QUESTIONS).map((lesson) => {
    const i = withOutcome.indexOf(lesson);
    const others = [1, 2].map((d) => withOutcome[(i + d) % withOutcome.length]).filter((o) => o.id !== lesson.id);
    const texts = seededOrder([lesson.outcomes[0].statement, ...[...new Set(others.map((o) => o.outcomes[0].statement))].filter((t) => t !== lesson.outcomes[0].statement)].slice(0, 3), lesson.id);
    const options = texts.map((text, j) => ({ id: LETTERS[j], text }));
    return {
      id: `q-${lesson.id}`,
      lessonId: lesson.id,
      prompt: tr(locale, "quiz.rulePrompt", { title: lesson.title }),
      options,
      correctOptionId: options.find((o) => o.text === lesson.outcomes[0].statement)!.id,
      explanation: lesson.summary
    };
  });
}

function validQuestions(raw: unknown, lessons: LessonView[]): QuizQuestion[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set(lessons.map((l) => l.id));
  const out: QuizQuestion[] = [];
  for (const [i, q] of raw.entries()) {
    const r = q as Record<string, unknown>;
    const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0).slice(0, 4) : [];
    const correct = Number(r.correctIndex);
    if (typeof r.prompt !== "string" || options.length < 2 || !Number.isInteger(correct) || correct < 0 || correct >= options.length) continue;
    const lessonId = typeof r.lessonId === "string" && ids.has(r.lessonId) ? r.lessonId : lessons[Math.min(i, lessons.length - 1)].id;
    out.push({
      id: `q-${i + 1}-${lessonId}`, lessonId, prompt: r.prompt.slice(0, 300),
      options: options.map((text, j) => ({ id: LETTERS[j], text: text.slice(0, 200) })),
      correctOptionId: LETTERS[correct], explanation: typeof r.explanation === "string" ? r.explanation.slice(0, 400) : ""
    });
  }
  return out.slice(0, MAX_QUESTIONS);
}

/** Bedrock writes grounded multiple-choice questions from lesson summaries + outcomes; falls back to rules. */
async function bedrockQuiz(rt: SkillTutorRuntime, lessons: LessonView[], locale: string): Promise<QuizQuestion[]> {
  const material = spread(lessons.filter((l) => l.outcomes.length > 0), MAX_QUESTIONS).map((l) => ({ lessonId: l.id, title: l.title, summary: l.summary, outcomes: l.outcomes.map((o) => o.statement) }));
  const res = await rt.llm.converse(
    "You write certification quiz questions for OpenMatrix Skill. Use ONLY the provided course material. Return ONLY a JSON array, no prose.",
    [{ role: "user", content: [{ text: `Language: ${locale === "en" ? "English" : "Vietnamese"}.\nWrite ${material.length} multiple-choice questions, one per lesson in the material, each testing that lesson's outcome. 3 options each, exactly one correct, options under 90 characters.\nFormat: [{"lessonId":"...","prompt":"...","options":["...","...","..."],"correctIndex":0,"explanation":"..."}]\nMaterial:\n${JSON.stringify(material)}` }] }],
    [],
    { maxTokens: 4000, temperature: 0.2 } // a full quiz is much longer than a chat reply
  );
  const text = res.content.map((b) => ("text" in b ? b.text : "")).join("");
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  return validQuestions(JSON.parse(json), lessons);
}

export async function getOrCreateQuiz(rt: SkillTutorRuntime, version: CourseVersion, locale: TutorLocale): Promise<QuizSet | null> {
  const key = quizKey(version.id, locale);
  const cached = await rt.store.getQuizSet(key);
  if (cached) return cached;
  const lessons = lessonsOf(version);
  let questions: QuizQuestion[] = [];
  let generatedBy: QuizSet["generatedBy"] = "rules";
  if (rt.config.llmMode === "bedrock") {
    try {
      questions = await bedrockQuiz(rt, lessons, locale);
      generatedBy = "bedrock";
    } catch (error) {
      console.error("skilltutor_quiz_generation_failed", { courseVersionId: version.id, error });
    }
  }
  if (questions.length < 2) {
    questions = rulesQuiz(lessons, locale);
    generatedBy = "rules";
  }
  if (questions.length === 0) return null;
  const set: QuizSet = { courseVersionId: key, generatedBy, questions, createdAt: rt.now().toISOString() };
  await rt.store.putQuizSet(set);
  return set;
}
