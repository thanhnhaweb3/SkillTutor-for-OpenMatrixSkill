import { NextRequest, NextResponse } from "next/server";
import type { ExpertContext } from "@openmatrix/dashboard";
import { deliver } from "../channels";
import { emailLayout } from "../channels/email";
import { pickLang } from "../bilingual";
import { tr } from "../i18n";
import type { CohortView, LearnerProfileView } from "../oms/gateway";
import { TEAM_ROLES, type TeamRole } from "../oms/team";
import { getSkillTutorRuntime, type SkillTutorRuntime } from "../runtime";
import { newId } from "../store";
import type { JoinRequest } from "../types";
import { fail, headers, rid, sameOrigin, sessionUser, signedIn, type RuntimeProvider, type SessionUserResolver } from "./handlers";

const MAX_EMAILS = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const joinUrl = (rt: SkillTutorRuntime, c: { expertId: string; id: string }) =>
  `${rt.config.appUrl.replace(/\/$/, "")}/dashboard/skilltutor/join?e=${encodeURIComponent(c.expertId)}&c=${encodeURIComponent(c.id)}`;

/** Tells a newly admitted learner where to start (email; dry-run puts it in the Outbox). */
async function notifyAdmitted(rt: SkillTutorRuntime, learner: LearnerProfileView, cohort: CohortView) {
  if (!learner.email) return;
  const l = learner.locale;
  const p = { name: learner.name, expert: cohort.expertName, cohort: pickLang(cohort.name, l), course: pickLang(cohort.courseTitle, l), lessons: cohort.lessonCount };
  const text = tr(l, "admit.body", p);
  await deliver(rt, learner.id, { channel: "email", to: { email: learner.email }, locale: l, subject: tr(l, "admit.subject", p), text,
    html: emailLayout(tr(l, "admit.subject", p), [text], { label: tr(l, "admit.cta"), url: `${rt.config.appUrl.replace(/\/$/, "")}/dashboard/skilltutor/learn` }, l) });
}

type StaffAuth = { error: string; status: number } | { user: { id: string; name: string }; context: ExpertContext };

async function staffContext(rt: SkillTutorRuntime, resolveUser: SessionUserResolver, request: NextRequest, expertId?: string): Promise<StaffAuth> {
  const user = await signedIn(rt, resolveUser, request);
  if (!user) return { error: "UNAUTHENTICATED", status: 401 } as const;
  const context = await rt.gateway.resolveContext({ id: user.id, displayName: user.name }, expertId);
  if (!context) return { error: "NOT_MEMBER", status: 403 } as const;
  if (!context.permissions.includes("expert:manage_members")) return { error: "MISSING_PERMISSION", status: 403 } as const;
  return { user, context };
}

/**
 * Expert admin page: pick a cohort, see its roster and pending join requests,
 * approve / reject requests or admit learners by email.
 */
export function createLearnerAdminHandlers(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return {
    GET: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      const auth = await staffContext(rt, resolveUser, request, request.nextUrl.searchParams.get("expertId")?.trim() || undefined);
      if ("error" in auth) return fail(auth.error, auth.status, requestId);
      const { context } = auth;
      const cohorts = await rt.gateway.listCohorts(context.expertId);
      const wanted = request.nextUrl.searchParams.get("cohortId")?.trim();
      const cohort = cohorts.find((c) => c.id === wanted) ?? cohorts.find((c) => c.status === "active") ?? cohorts[0];
      if (!cohort) return NextResponse.json({ expertId: context.expertId, cohorts: [], roster: [], requests: [] }, { headers: headers(requestId) });
      const roster = await Promise.all((await rt.gateway.listRoster(context.expertId, cohort.id)).map(async (r) => {
        const [link, certs] = await Promise.all([rt.store.getLinkByUser(r.userId), rt.store.listCertificatesByUser(r.userId)]);
        return { ...r, channel: link?.channel, certificate: certs.find((c) => c.courseId === cohort.courseId)?.code };
      }));
      const requests = (await rt.store.listJoinRequests(context.expertId)).filter((q) => q.cohortId === cohort.id)
        .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.requestedAt.localeCompare(a.requestedAt));
      return NextResponse.json({ expertId: context.expertId, cohorts, cohortId: cohort.id, joinUrl: joinUrl(rt, cohort), roster, requests }, { headers: headers(requestId) });
    },

    POST: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      if (!sameOrigin(request)) return fail("MISSING_PERMISSION", 403, requestId);
      const body = (await request.json().catch(() => null)) as { action?: string; expertId?: string; cohortId?: string; userId?: string; emails?: unknown } | null;
      if (!body || typeof body.cohortId !== "string" || !["admit", "approve", "reject"].includes(String(body.action))) return fail("VALIDATION_ERROR", 422, requestId);
      const auth = await staffContext(rt, resolveUser, request, body.expertId?.trim() || undefined);
      if ("error" in auth) return fail(auth.error, auth.status, requestId);
      const { context } = auth;
      const cohort = (await rt.gateway.listCohorts(context.expertId)).find((c) => c.id === body.cohortId);
      if (!cohort) return fail("OUTSIDE_EXPERT", 404, requestId);
      const now = rt.now().toISOString();

      const admitOne = async (learner: LearnerProfileView) => {
        const r = await rt.gateway.admit(context, cohort.id, learner.id);
        if (r.outcome === "enrolled") {
          await rt.store.addEvent({ id: newId(), at: now, type: "learner_admitted", userId: learner.id, expertId: context.expertId });
          await notifyAdmitted(rt, learner, cohort).catch((e) => console.error("[skilltutor] admit email failed", (e as Error).message));
        }
        const pending = await rt.store.getJoinRequest(context.expertId, cohort.id, learner.id);
        if (pending && pending.status !== "approved" && (r.outcome === "enrolled" || r.outcome === "already_enrolled")) {
          await rt.store.putJoinRequest({ ...pending, status: "approved", decidedAt: now, decidedBy: context.userId });
        }
        return r.outcome;
      };

      try {
        if (body.action === "admit") {
          const emails = Array.isArray(body.emails) ? [...new Set(body.emails.filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase()).filter(Boolean))] : [];
          if (!emails.length || emails.length > MAX_EMAILS) return fail("VALIDATION_ERROR", 422, requestId);
          const results = [];
          for (const email of emails) {
            if (!EMAIL.test(email)) { results.push({ email, status: "invalid_email" }); continue; }
            const learner = await rt.gateway.findUserByEmail(email);
            if (!learner) { results.push({ email, status: "no_account" }); continue; }
            try { results.push({ email, name: learner.name, status: await admitOne(learner) }); }
            catch (e) { results.push({ email, name: learner.name, status: "error", detail: (e as { code?: string }).code ?? (e as Error).message }); }
          }
          return NextResponse.json({ results }, { headers: headers(requestId) });
        }

        if (typeof body.userId !== "string") return fail("VALIDATION_ERROR", 422, requestId);
        const pending = await rt.store.getJoinRequest(context.expertId, cohort.id, body.userId);
        if (!pending) return fail("OUTSIDE_EXPERT", 404, requestId);
        if (body.action === "reject") {
          await rt.store.putJoinRequest({ ...pending, status: "rejected", decidedAt: now, decidedBy: context.userId });
          await rt.store.addEvent({ id: newId(), at: now, type: "join_rejected", userId: pending.userId, expertId: context.expertId });
          return NextResponse.json({ status: "rejected" }, { headers: headers(requestId) });
        }
        const learner = (await rt.gateway.getUser(pending.userId)) ?? { id: pending.userId, name: pending.name, email: pending.email, locale: "vi" as const };
        return NextResponse.json({ status: await admitOne(learner) }, { headers: headers(requestId) });
      } catch (e) {
        const code = (e as { code?: string }).code;
        console.error("[skilltutor] learner admin failed", code, (e as Error).message);
        return fail(code ?? "INTERNAL_ERROR", code === "MISSING_PERMISSION" ? 403 : code ? 409 : 500, requestId);
      }
    }
  };
}

/**
 * Expert team on the learners admin page: list staff, give an account a role by email (hackathon judges → reviewer)
 * or remove it. Same permission as admitting learners (expert:manage_members).
 */
export function createTeamAdminHandlers(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  return {
    GET: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      const auth = await staffContext(rt, resolveUser, request, request.nextUrl.searchParams.get("expertId")?.trim() || undefined);
      if ("error" in auth) return fail(auth.error, auth.status, requestId);
      const members = await rt.gateway.listTeam(auth.context.expertId);
      return NextResponse.json({ expertId: auth.context.expertId, selfUserId: auth.context.userId, roles: TEAM_ROLES, members }, { headers: headers(requestId) });
    },

    POST: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      if (!sameOrigin(request)) return fail("MISSING_PERMISSION", 403, requestId);
      const body = (await request.json().catch(() => null)) as { action?: string; expertId?: string; email?: string; role?: string; userId?: string } | null;
      if (!body || !["add", "remove"].includes(String(body.action))) return fail("VALIDATION_ERROR", 422, requestId);
      const auth = await staffContext(rt, resolveUser, request, body.expertId?.trim() || undefined);
      if ("error" in auth) return fail(auth.error, auth.status, requestId);
      const { context } = auth;
      try {
        if (body.action === "add") {
          const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
          const role = (body.role ?? "reviewer") as TeamRole;
          if (!EMAIL.test(email) || !TEAM_ROLES.includes(role)) return fail("VALIDATION_ERROR", 422, requestId);
          const user = await rt.gateway.findUserByEmail(email);
          if (!user) return NextResponse.json({ email, status: "no_account" }, { headers: headers(requestId) });
          const status = await rt.gateway.addTeamMember(context, user.id, role);
          if (status === "added") await rt.store.addEvent({ id: newId(), at: rt.now().toISOString(), type: "team_added", userId: user.id, expertId: context.expertId });
          return NextResponse.json({ email, name: user.name, status }, { headers: headers(requestId) });
        }
        if (typeof body.userId !== "string" || !body.userId) return fail("VALIDATION_ERROR", 422, requestId);
        const status = await rt.gateway.removeTeamMember(context, body.userId);
        if (status === "removed") await rt.store.addEvent({ id: newId(), at: rt.now().toISOString(), type: "team_removed", userId: body.userId, expertId: context.expertId });
        return NextResponse.json({ status }, { headers: headers(requestId) });
      } catch (e) {
        const code = (e as { code?: string }).code ?? ((e as Error).name === "TransactionCanceledException" ? "VERSION_CONFLICT" : undefined);
        console.error("[skilltutor] team admin failed", code, (e as Error).message);
        return fail(code ?? "INTERNAL_ERROR", code === "MISSING_PERMISSION" ? 403 : code ? 409 : 500, requestId);
      }
    }
  };
}

/** Learner side of the join link: see the course, send a request, see its status. */
export function createJoinHandlers(provider: RuntimeProvider = getSkillTutorRuntime, resolveUser: SessionUserResolver = sessionUser) {
  async function load(rt: SkillTutorRuntime, expertId: string | null | undefined, cohortId: string | null | undefined) {
    if (!expertId || !cohortId) return null;
    return (await rt.gateway.listCohorts(expertId).catch(() => [])).find((c) => c.id === cohortId) ?? null;
  }
  async function statusOf(rt: SkillTutorRuntime, userId: string, cohort: CohortView) {
    if ((await rt.gateway.listEnrollments(userId)).some((e) => e.cohortId === cohort.id)) return "enrolled";
    const req = await rt.store.getJoinRequest(cohort.expertId, cohort.id, userId);
    if (req) return req.status === "approved" ? "enrolled" : req.status;
    return cohort.status === "active" ? "none" : "closed";
  }
  const view = (c: CohortView) => ({ expertId: c.expertId, expertName: c.expertName, cohortId: c.id, cohortName: c.name, courseTitle: c.courseTitle, lessonCount: c.lessonCount, startDate: c.startDate });

  return {
    GET: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      const user = await signedIn(rt, resolveUser, request);
      if (!user) return fail("UNAUTHENTICATED", 401, requestId);
      const cohort = await load(rt, request.nextUrl.searchParams.get("e"), request.nextUrl.searchParams.get("c"));
      if (!cohort) return fail("OUTSIDE_EXPERT", 404, requestId);
      return NextResponse.json({ ...view(cohort), status: await statusOf(rt, user.id, cohort) }, { headers: headers(requestId) });
    },
    POST: async (request: NextRequest) => {
      const requestId = rid(request);
      const rt = await provider();
      if (!rt.config.enabled) return fail("SKILLTUTOR_DISABLED", 503, requestId);
      if (!sameOrigin(request)) return fail("MISSING_PERMISSION", 403, requestId);
      const user = await signedIn(rt, resolveUser, request);
      if (!user) return fail("UNAUTHENTICATED", 401, requestId);
      const body = (await request.json().catch(() => null)) as { expertId?: string; cohortId?: string; note?: string } | null;
      const cohort = await load(rt, body?.expertId, body?.cohortId);
      if (!cohort) return fail("OUTSIDE_EXPERT", 404, requestId);
      const current = await statusOf(rt, user.id, cohort);
      if (current === "enrolled" || current === "pending" || current === "closed") return NextResponse.json({ ...view(cohort), status: current }, { headers: headers(requestId) });
      const profile = await rt.gateway.getUser(user.id);
      const note = typeof body?.note === "string" ? body.note.replace(/[<>]/g, "").trim().slice(0, 300) || undefined : undefined;
      const req: JoinRequest = { expertId: cohort.expertId, cohortId: cohort.id, userId: user.id, name: profile?.name ?? user.name, email: profile?.email,
        note, requestedAt: rt.now().toISOString(), status: "pending" };
      await rt.store.putJoinRequest(req);
      await rt.store.addEvent({ id: newId(), at: req.requestedAt, type: "join_requested", userId: user.id, expertId: cohort.expertId });
      return NextResponse.json({ ...view(cohort), status: "pending" }, { status: 201, headers: headers(requestId) });
    }
  };
}
