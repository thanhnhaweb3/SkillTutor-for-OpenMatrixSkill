import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createUserStore, loadAcConfig, readSessionToken, SESSION_COOKIE, usesPersistentUserStore } from "@openmatrix/oms-ac-login";
import { DashboardContractError, resolveDashboardMe } from "../core/context";
import { createCourseRepository } from "../courses/create-repository";
import { CourseDomainError, type CourseErrorCode } from "../courses/errors";
import { CourseService } from "../courses/service";
import type { CourseDraftContent, CourseLifecycleStatus } from "../courses/types";
import { createDashboardRepository } from "../data/create-repository";
import { createSkillRepository } from "../skills/create-repository";
import { FixedWindowSkillRateLimiter } from "./skill-rate-limit";

type Application = Pick<CourseService, "list" | "get" | "create" | "update" | "submitReview" | "requestChanges" | "approve" | "publish" | "nextDraft">;
export interface CourseHandlerRuntime { service: Application; context: Awaited<ReturnType<typeof resolveDashboardMe>>["context"]; tier: Awaited<ReturnType<typeof resolveDashboardMe>>["me"]["memberships"][number]["tier"] }
export type CourseRuntimeResolver = (request: NextRequest, expertId: string, mutation?: boolean) => Promise<CourseHandlerRuntime>;
const statuses = new Set<CourseLifecycleStatus>(["draft", "in_review", "approved", "published", "archived"]);
const limiter = new FixedWindowSkillRateLimiter(Number(process.env.DASHBOARD_COURSES_RATE_LIMIT_PER_MINUTE) || 20, 60_000);
export class CourseHttpError extends Error { constructor(readonly code: string, readonly status: number) { super(code); } }
export function requireCoursesFeature() { if (process.env.DASHBOARD_COURSES_ENABLED !== "true") throw new CourseHttpError("COURSES_DISABLED", 503); }
export function courseMutationsEnabledFor(expertId: string) { if (process.env.DASHBOARD_COURSES_MUTATIONS_ENABLED !== "true") return false;
  const ids = (process.env.DASHBOARD_COURSES_CANARY_EXPERT_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean); return ids.includes("*") || ids.includes(expertId); }
export function requireCourseMutationFeature(expertId: string) { if (!courseMutationsEnabledFor(expertId)) throw new CourseHttpError("COURSE_MUTATIONS_DISABLED", 503); }
export function validateCourseMutationRequest(request: NextRequest, appUrl: string) {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new CourseHttpError("VALIDATION_ERROR", 415);
  if (request.headers.get("origin") !== new URL(appUrl).origin) throw new CourseHttpError("MISSING_PERMISSION", 403);
  const length = Number(request.headers.get("content-length") ?? 0); if (length > 320_000) throw new CourseHttpError("PAYLOAD_TOO_LARGE", 413);
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) throw new CourseHttpError("VALIDATION_ERROR", 422);
}
async function readBody(request: NextRequest) { const text = await request.text(); if (Buffer.byteLength(text, "utf8") > 320_000) throw new CourseHttpError("PAYLOAD_TOO_LARGE", 413);
  try { const value = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new CourseHttpError("VALIDATION_ERROR", 422); } }
async function runtime(request: NextRequest, expertId: string, mutation = false): Promise<CourseHandlerRuntime> {
  const config = loadAcConfig(); if (mutation) validateCourseMutationRequest(request, config.appUrl);
  const payload = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret); if (!payload) throw new CourseHttpError("UNAUTHENTICATED", 401);
  const store = createUserStore(config), user = usesPersistentUserStore(config) ? await store.findById(payload.userId) : payload.user; if (!user) throw new CourseHttpError("UNAUTHENTICATED", 401);
  const dashboard = createDashboardRepository(); const { context, me } = await resolveDashboardMe({ user: { id: user.id, displayName: user.name }, requestedExpertId: expertId, repository: dashboard });
  const membership = me.memberships.find((x) => x.expertId === context.expertId); if (!membership) throw new CourseHttpError("NOT_MEMBER", 403);
  if (mutation && !limiter.take(`${context.userId}:${context.expertId}`).allowed) throw new CourseHttpError("RATE_LIMITED", 429);
  return { service: new CourseService(createCourseRepository(), dashboard, createSkillRepository()), context, tier: membership.tier };
}
const headers = (id: string) => ({ "x-request-id": id, "cache-control": "private, no-store" });
const response = (code: string, status: number, id: string) => NextResponse.json({ error: { code, message: code, requestId: id } }, { status, headers: headers(id) });
function status(code: CourseErrorCode) { return code === "OUTSIDE_EXPERT" ? 404 : code === "VERSION_CONFLICT" || code === "INVALID_STATE_TRANSITION" ? 409 : code === "VALIDATION_ERROR" ? 422 : 403; }
function handle(e: unknown, id: string) { if (e instanceof CourseHttpError) return response(e.code, e.status, id); if (e instanceof DashboardContractError) return response(e.code, e.status, id);
  if (e instanceof CourseDomainError) return response(e.code, status(e.code), id); if (e instanceof Error && e.name === "TransactionCanceledException") return response("VERSION_CONFLICT", 409, id);
  console.error("dashboard_course_request_failed", { requestId: id, error: e }); return response("INTERNAL_ERROR", 500, id); }
const requestId = (r: NextRequest) => r.headers.get("x-request-id")?.trim() || `req_${randomUUID()}`;
function expert(body: Record<string, unknown>) { if (typeof body.expertId !== "string" || !body.expertId.trim()) throw new CourseHttpError("VALIDATION_ERROR", 422); return body.expertId.trim(); }
function content(body: Record<string, unknown>): CourseDraftContent { if (typeof body.title !== "string" || typeof body.description !== "string" || typeof body.ownerUserId !== "string" || !Array.isArray(body.modules)) throw new CourseHttpError("VALIDATION_ERROR", 422);
  return { title: body.title, description: body.description, ownerUserId: body.ownerUserId, modules: body.modules as CourseDraftContent["modules"] }; }

export function createCoursesCollectionHandlers(resolve: CourseRuntimeResolver = runtime) { return {
  GET: async (request: NextRequest) => { const id = requestId(request); try { requireCoursesFeature(); const expertId = request.nextUrl.searchParams.get("expertId")?.trim(); if (!expertId) throw new CourseHttpError("VALIDATION_ERROR", 422);
    const raw = request.nextUrl.searchParams.get("status")?.trim(); if (raw && !statuses.has(raw as CourseLifecycleStatus)) throw new CourseHttpError("VALIDATION_ERROR", 422);
    const { service, context } = await resolve(request, expertId); const page = await service.list({ context, query: { status: raw as CourseLifecycleStatus | undefined,
      ownerUserId: request.nextUrl.searchParams.get("ownerUserId")?.trim() || undefined, skillId: request.nextUrl.searchParams.get("skillId")?.trim() || undefined,
      cursor: request.nextUrl.searchParams.get("cursor") || undefined, limit: Number(request.nextUrl.searchParams.get("limit") ?? 25) } });
    return NextResponse.json({ ...page, capabilities: { mutations: courseMutationsEnabledFor(context.expertId) } }, { headers: headers(id) }); } catch (e) { return handle(e, id); } },
  POST: async (request: NextRequest) => { const id = requestId(request); try { requireCoursesFeature(); const body = await readBody(request), expertId = expert(body); requireCourseMutationFeature(expertId);
    const { service, context, tier } = await resolve(request, expertId, true); if (typeof body.code !== "string") throw new CourseHttpError("VALIDATION_ERROR", 422);
    return NextResponse.json(await service.create({ context, tier, code: body.code, content: content(body), requestId: id }), { status: 201, headers: headers(id) }); } catch (e) { return handle(e, id); } }
}; }
export function createCourseDetailHandler(resolve: CourseRuntimeResolver = runtime) { return async (request: NextRequest, route: { params: { courseId: string } }) => { const id = requestId(request); try { requireCoursesFeature();
  const expertId = request.nextUrl.searchParams.get("expertId")?.trim(); if (!expertId) throw new CourseHttpError("VALIDATION_ERROR", 422); const raw = request.nextUrl.searchParams.get("version"), versionNumber = raw ? Number(raw) : undefined;
  if (versionNumber !== undefined && (!Number.isInteger(versionNumber) || versionNumber < 1)) throw new CourseHttpError("VALIDATION_ERROR", 422);
  const { service, context } = await resolve(request, expertId); return NextResponse.json({ ...await service.get({ context, courseId: route.params.courseId, versionNumber }), capabilities: { mutations: courseMutationsEnabledFor(context.expertId) } }, { headers: headers(id) }); } catch (e) { return handle(e, id); } }; }
type Action = "update" | "submit-review" | "request-changes" | "approve" | "publish";
export function createCourseVersionMutationHandler(action: Action, resolve: CourseRuntimeResolver = runtime) { return async (request: NextRequest, route: { params: { courseId: string; versionNumber: string } }) => { const id = requestId(request); try {
  requireCoursesFeature(); const body = await readBody(request), expertId = expert(body), versionNumber = Number(route.params.versionNumber); if (!Number.isInteger(versionNumber) || versionNumber < 1 || !Number.isInteger(body.expectedVersion)) throw new CourseHttpError("VALIDATION_ERROR", 422);
  requireCourseMutationFeature(expertId); const { service, context, tier } = await resolve(request, expertId, true); const common = { context, courseId: route.params.courseId, versionNumber, expectedVersion: body.expectedVersion as number, requestId: id };
  const result = action === "update" ? await service.update({ ...common, content: content(body) }) : action === "submit-review" ? await service.submitReview(common)
    : action === "request-changes" && typeof body.note === "string" ? await service.requestChanges({ ...common, note: body.note }) : action === "approve" ? await service.approve(common)
      : action === "publish" ? await service.publish({ ...common, tier }) : (() => { throw new CourseHttpError("VALIDATION_ERROR", 422); })();
  return NextResponse.json(result, { headers: headers(id) }); } catch (e) { return handle(e, id); } }; }
export function createNextCourseVersionHandler(resolve: CourseRuntimeResolver = runtime) { return async (request: NextRequest, route: { params: { courseId: string } }) => { const id = requestId(request); try {
  requireCoursesFeature(); const body = await readBody(request), expertId = expert(body); requireCourseMutationFeature(expertId); const { service, context } = await resolve(request, expertId, true);
  return NextResponse.json(await service.nextDraft({ context, courseId: route.params.courseId, requestId: id }), { status: 201, headers: headers(id) }); } catch (e) { return handle(e, id); } }; }
