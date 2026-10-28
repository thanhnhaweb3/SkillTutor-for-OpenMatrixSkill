import { NextRequest, NextResponse } from "next/server";
import { lessonsOf, type CohortView } from "../oms/gateway";
import { DEMO_EXPERT_ID } from "../oms/demo";
import { getSkillTutorRuntime, type SkillTutorRuntime } from "../runtime";
import { fail, headers, rid, sessionUser, signedIn, type RuntimeProvider, type SessionUserResolver } from "./handlers";

export type CohortJoinStatus = "guest" | "none" | "pending" | "rejected" | "enrolled" | "closed";

const publicExperts = (rt: SkillTutorRuntime) =>
  rt.config.publicExpertIds.length ? rt.config.publicExpertIds : rt.config.demo ? [DEMO_EXPERT_ID] : [];

async function cohortCard(rt: SkillTutorRuntime, c: CohortView) {
  const version = await rt.gateway.getCourseVersion(c.expertId, c.courseId, c.courseVersionNumber).catch(() => null);
  const lessons = version ? lessonsOf(version) : [];
  const skillIds = [...new Set(lessons.flatMap((l) => l.outcomes.map((o) => o.skillId)))];
  const names = skillIds.length ? await rt.gateway.skillNames(c.expertId, skillIds) : {};
  return {
    expertId: c.expertId, expertName: c.expertName, cohortId: c.id, cohortName: c.name, courseCode: c.courseCode ?? "", courseTitle: c.courseTitle,
    courseDescription: version?.description ?? "", lessonCount: c.lessonCount, startDate: c.startDate,
    minutes: lessons.reduce((sum, l) => sum + (l.estimatedMinutes || 0), 0),
    skills: skillIds.map((id) => names[id] ?? id), open: c.status === "active"
  };
}

/**
 * Public course catalogue for the landing page: active cohorts of the Experts in SKILLTUTOR_PUBLIC_EXPERT_IDS.
 * For a signed-in visitor each cohort also carries their status (enrolled / pending / rejected / none).
 */
export function createCatalogHandler(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return async function GET(request: NextRequest) {
    const requestId = rid(request);
    const rt = await provider();
    if (!rt.config.enabled) return NextResponse.json({ signedIn: false, cohorts: [] }, { headers: headers(requestId) });
    const user = await signedIn(rt, resolveUser, request).catch(() => null);
    const cohorts = [];
    for (const expertId of publicExperts(rt)) {
      for (const c of await rt.gateway.listCohorts(expertId).catch(() => [])) {
        if (c.status !== "active") continue;
        cohorts.push(await cohortCard(rt, c));
      }
    }
    const enrolledIn = user ? new Set((await rt.gateway.listEnrollments(user.id)).map((e) => e.cohortId)) : new Set<string>();
    const withStatus = [];
    for (const c of cohorts) {
      let status: CohortJoinStatus = user ? "none" : "guest";
      if (user && enrolledIn.has(c.cohortId)) status = "enrolled";
      else if (user) {
        const req = await rt.store.getJoinRequest(c.expertId, c.cohortId, user.id);
        if (req?.status === "pending" || req?.status === "rejected") status = req.status;
        else if (req?.status === "approved") status = "enrolled";
      }
      if (!c.open && status !== "enrolled") status = "closed";
      withStatus.push({ ...c, status });
    }
    return NextResponse.json({ signedIn: !!user, cohorts: withStatus }, { headers: headers(requestId) });
  };
}

/** Signed-in summary for the landing page: WhatsApp link, enrolled courses with progress, certificates. */
export function createMeHandler(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return async function GET(request: NextRequest) {
    const requestId = rid(request);
    const rt = await provider();
    if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
    const user = await signedIn(rt, resolveUser, request);
    if (!user) return fail("UNAUTHENTICATED", 401, requestId);
    const [link, certificates, enrollments] = await Promise.all([
      rt.store.getLinkByUser(user.id), rt.store.listCertificatesByUser(user.id), rt.gateway.listEnrollments(user.id)
    ]);
    return NextResponse.json({
      name: user.name,
      whatsapp: link ? { linked: true, channel: link.channel, phone: `${link.phone.slice(0, 4)}•••${link.phone.slice(-3)}` } : { linked: false },
      enrollments: enrollments.map((e) => ({ courseTitle: e.courseTitle, cohortName: e.cohortName, expertName: e.expertName, percentComplete: e.percentComplete,
        completedLessonCount: e.completedLessonCount, requiredLessonCount: e.requiredLessonCount, completed: !!e.courseCompletedAt })),
      certificates: certificates.map((c) => ({ code: c.code, courseTitle: c.courseTitle }))
    }, { headers: headers(requestId) });
  };
}

/** "us.anthropic.claude-haiku-4-5-20251001-v1:0" → "Haiku 4.5"; "anthropic.claude-3-5-sonnet-…" → "Sonnet 3.5". */
export function claudeModelLabel(modelId: string): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const modern = modelId.match(/claude-(opus|sonnet|haiku)-(\d+)(?:-(\d))?(?=-|$|:)/);
  if (modern) return `${cap(modern[1])} ${modern[2]}${modern[3] ? `.${modern[3]}` : ""}`;
  const legacy = modelId.match(/claude-(\d)(?:-(\d))?-(opus|sonnet|haiku)/);
  if (legacy) return `${cap(legacy[3])} ${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ""}`;
  return "Claude";
}

/** Public facts for the floating chat launcher: is SkillTutor on, and which engine answers (Claude on Bedrock or the demo mock). */
export function createAssistantInfoHandler(provider: RuntimeProvider = getSkillTutorRuntime) {
  return async function GET(request: NextRequest) {
    const requestId = rid(request);
    const rt = await provider();
    const bedrock = rt.config.llmMode === "bedrock";
    return NextResponse.json({
      enabled: rt.config.enabled,
      engine: bedrock ? "bedrock" : "mock",
      model: bedrock ? claudeModelLabel(rt.config.bedrockModelId) : null
    }, { headers: { ...headers(requestId), "cache-control": "public, max-age=300" } });
  };
}

/**
 * "My courses": every enrolled course with its lessons marked done / not done, the next lesson to study,
 * which course the tutor is currently on, and the certificate if one was issued.
 */
export function createMyCoursesHandler(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return async function GET(request: NextRequest) {
    const requestId = rid(request);
    const rt = await provider();
    if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
    const user = await signedIn(rt, resolveUser, request);
    if (!user) return fail("UNAUTHENTICATED", 401, requestId);
    const [enrollments, state, certificates, link] = await Promise.all([
      rt.gateway.listEnrollments(user.id), rt.store.getState(user.id), rt.store.listCertificatesByUser(user.id), rt.store.getLinkByUser(user.id)
    ]);
    const courses = [];
    for (const e of enrollments) {
      const lessons = await rt.gateway.getLessons(e.expertId, e.courseId, e.courseVersionNumber).catch(() => []);
      const done = new Set(e.completedLessonIds);
      const next = lessons.find((l) => !done.has(l.id));
      const cert = certificates.find((c) => c.expertId === e.expertId && c.courseId === e.courseId);
      courses.push({
        expertId: e.expertId, expertName: e.expertName, cohortId: e.cohortId, cohortName: e.cohortName, courseTitle: e.courseTitle,
        percentComplete: e.percentComplete, completedLessonCount: e.completedLessonCount, requiredLessonCount: e.requiredLessonCount || lessons.length,
        completed: !!e.courseCompletedAt, active: state?.active?.cohortId === e.cohortId && state?.active?.expertId === e.expertId,
        nextLessonId: next?.id ?? null, certificateCode: cert?.code ?? null,
        lessons: lessons.map((l) => ({ id: l.id, index: l.index, title: l.title, moduleTitle: l.moduleTitle, minutes: l.estimatedMinutes, done: done.has(l.id) }))
      });
    }
    // Unfinished courses first, then the one the tutor is on.
    courses.sort((a, b) => Number(a.completed) - Number(b.completed) || Number(b.active) - Number(a.active));
    const wa = rt.config.whatsapp.displayNumber.replace(/\D/g, "");
    return NextResponse.json({
      courses,
      whatsapp: { linked: !!link && link.channel === "whatsapp", url: wa ? `https://wa.me/${wa}` : null }
    }, { headers: headers(requestId) });
  };
}
