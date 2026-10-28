import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createUserStore, loadAcConfig, readSessionToken, SESSION_COOKIE, usesPersistentUserStore } from "@openmatrix/oms-ac-login";
import { DashboardContractError, resolveDashboardMe } from "../core/context";
import { createDashboardRepository } from "../data/create-repository";
import { createSkillRepository } from "../skills/create-repository";
import { SkillDomainError, type SkillErrorCode } from "../skills/errors";
import { SkillService } from "../skills/service";
import { validateCanonicalSkillImport } from "../skills/import";
import type { SkillLifecycleStatus } from "../skills/types";
import { skillMutationRateLimiter } from "./skill-rate-limit";

type SkillApplication = Pick<SkillService, "list" | "listFrameworks" | "get" | "create" | "importSkills" | "update" | "submitReview" | "requestChanges" | "publish" | "nextDraft">;
export interface SkillHandlerRuntime {
  service: SkillApplication;
  context: Awaited<ReturnType<typeof resolveDashboardMe>>["context"];
  tier: Awaited<ReturnType<typeof resolveDashboardMe>>["me"]["memberships"][number]["tier"];
}
export type SkillRuntimeResolver = (request: NextRequest, expertId: string, mutation?: boolean) => Promise<SkillHandlerRuntime>;

const statuses = new Set<SkillLifecycleStatus>(["draft", "in_review", "published", "archived"]);

function errorResponse(code: string, status: number, requestId: string, message?: string) {
  return NextResponse.json({ error: { code, message: message ?? code, requestId } }, { status, headers: responseHeaders(requestId) });
}

function responseHeaders(requestId: string) {
  return { "x-request-id": requestId, "cache-control": "private, no-store" };
}

function skillStatus(code: SkillErrorCode) {
  if (code === "OUTSIDE_EXPERT") return 404;
  if (code === "VERSION_CONFLICT" || code === "INVALID_STATE_TRANSITION") return 409;
  if (code === "VALIDATION_ERROR") return 422;
  return 403;
}

export function requireSkillsFeature() {
  if (process.env.DASHBOARD_SKILLS_ENABLED !== "true") throw new SkillHttpError("SKILLS_DISABLED", 503);
}

export function skillsMutationsEnabledFor(expertId: string) {
  if (process.env.DASHBOARD_SKILLS_MUTATIONS_ENABLED !== "true") return false;
  const allowlist = (process.env.DASHBOARD_SKILLS_CANARY_EXPERT_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return allowlist.includes("*") || allowlist.includes(expertId);
}

export function requireSkillsMutationFeature(expertId: string) {
  if (!skillsMutationsEnabledFor(expertId)) throw new SkillHttpError("SKILL_MUTATIONS_DISABLED", 503);
}

export function validateSkillMutationRequest(request: NextRequest, appUrl: string) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) throw new SkillHttpError("VALIDATION_ERROR", 415);
  if (request.headers.get("origin") !== new URL(appUrl).origin) throw new SkillHttpError("MISSING_PERMISSION", 403);
}

export class SkillHttpError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

async function runtime(request: NextRequest, expertId: string, mutation = false): Promise<SkillHandlerRuntime> {
  const config = loadAcConfig();
  if (mutation) validateSkillMutationRequest(request, config.appUrl);
  const payload = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret);
  if (!payload) throw new SkillHttpError("UNAUTHENTICATED", 401);
  const userStore = createUserStore(config);
  const user = usesPersistentUserStore(config) ? await userStore.findById(payload.userId) : payload.user;
  if (!user) throw new SkillHttpError("UNAUTHENTICATED", 401);
  const dashboardRepository = createDashboardRepository();
  const { context, me } = await resolveDashboardMe({
    user: { id: user.id, displayName: user.name }, requestedExpertId: expertId, repository: dashboardRepository
  });
  const membership = me.memberships.find((item) => item.expertId === context.expertId);
  if (!membership) throw new SkillHttpError("NOT_MEMBER", 403);
  if (mutation) {
    const rate = skillMutationRateLimiter.take(`${context.userId}:${context.expertId}`);
    if (!rate.allowed) throw new SkillHttpError("RATE_LIMITED", 429);
  }
  return { service: new SkillService(createSkillRepository(), dashboardRepository), context, tier: membership.tier };
}

function handle(error: unknown, requestId: string) {
  if (error instanceof SkillHttpError) return errorResponse(error.code, error.status, requestId);
  if (error instanceof DashboardContractError) return errorResponse(error.code, error.status, requestId);
  if (error instanceof SkillDomainError) return errorResponse(error.code, skillStatus(error.code), requestId, error.message);
  if (error instanceof Error && error.name === "TransactionCanceledException") return errorResponse("VERSION_CONFLICT", 409, requestId);
  console.error("dashboard_skill_request_failed", { requestId, error });
  return errorResponse("INTERNAL_ERROR", 500, requestId);
}

function requestId(request: NextRequest) {
  return request.headers.get("x-request-id")?.trim() || `req_${randomUUID()}`;
}

export function createSkillsCollectionHandlers(resolveRuntime: SkillRuntimeResolver = runtime) {
  return {
    GET: async (request: NextRequest) => {
      const id = requestId(request);
      try {
        requireSkillsFeature();
        const expertId = request.nextUrl.searchParams.get("expertId")?.trim();
        if (!expertId) throw new SkillHttpError("VALIDATION_ERROR", 422);
        const rawStatus = request.nextUrl.searchParams.get("status")?.trim();
        if (rawStatus && !statuses.has(rawStatus as SkillLifecycleStatus)) throw new SkillHttpError("VALIDATION_ERROR", 422);
        const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
        const { service, context } = await resolveRuntime(request, expertId);
        const page = await service.list({ context, query: {
          status: rawStatus as SkillLifecycleStatus | undefined,
          ownerUserId: request.nextUrl.searchParams.get("ownerUserId")?.trim() || undefined,
          cursor: request.nextUrl.searchParams.get("cursor") || undefined,
          limit
        } });
        return NextResponse.json(page, { headers: responseHeaders(id) });
      } catch (error) { return handle(error, id); }
    },
    POST: async (request: NextRequest) => {
      const id = requestId(request);
      try {
        requireSkillsFeature();
        const body = await request.json() as Record<string, unknown>;
        if (typeof body.expertId !== "string" || typeof body.frameworkId !== "string" || typeof body.code !== "string" ||
          typeof body.name !== "string" || typeof body.description !== "string" || !Array.isArray(body.outcomes) ||
          !Array.isArray(body.tags) || typeof body.ownerUserId !== "string") throw new SkillHttpError("VALIDATION_ERROR", 422);
        requireSkillsMutationFeature(body.expertId.trim());
        const { service, context, tier } = await resolveRuntime(request, body.expertId.trim(), true);
        const result = await service.create({
          context, tier, frameworkId: body.frameworkId.trim(), code: body.code,
          content: { name: body.name, description: body.description, outcomes: body.outcomes as string[], tags: body.tags as string[], ownerUserId: body.ownerUserId }, requestId: id
        });
        return NextResponse.json(result, { status: 201, headers: responseHeaders(id) });
      } catch (error) { return handle(error, id); }
    }
  };
}

export function createSkillFrameworksHandler(resolveRuntime: SkillRuntimeResolver = runtime) {
  return async (request: NextRequest) => {
    const id = requestId(request);
    try {
      requireSkillsFeature();
      const expertId = request.nextUrl.searchParams.get("expertId")?.trim();
      if (!expertId) throw new SkillHttpError("VALIDATION_ERROR", 422);
      const { service, context } = await resolveRuntime(request, expertId);
      return NextResponse.json({ frameworks: await service.listFrameworks(context), capabilities: { mutations: skillsMutationsEnabledFor(context.expertId) } }, { headers: responseHeaders(id) });
    } catch (error) { return handle(error, id); }
  };
}

export function createSkillImportDryRunHandler(resolveRuntime: SkillRuntimeResolver = runtime) {
  return async (request: NextRequest) => {
    const id = requestId(request);
    try {
      requireSkillsFeature();
      const body = await request.json() as Record<string, unknown>;
      if (typeof body.expertId !== "string" || body.manifest === undefined) throw new SkillHttpError("VALIDATION_ERROR", 422);
      const { service, context } = await resolveRuntime(request, body.expertId.trim(), true);
      if (!context.permissions.includes("skill:create")) throw new SkillDomainError("MISSING_PERMISSION");
      const preview = validateCanonicalSkillImport(body.manifest, context.userId);
      const frameworks = await service.listFrameworks(context);
      if (!frameworks.some((framework) => framework.id === preview.frameworkId)) throw new SkillDomainError("OUTSIDE_EXPERT");
      return NextResponse.json({ mode: "dry-run", valid: true, preview }, { headers: responseHeaders(id) });
    } catch (error) { return handle(error, id); }
  };
}

export function createSkillImportCommitHandler(resolveRuntime: SkillRuntimeResolver = runtime) {
  return async (request: NextRequest) => {
    const id = requestId(request);
    try {
      requireSkillsFeature();
      const body = await request.json() as Record<string, unknown>;
      if (typeof body.expertId !== "string" || typeof body.idempotencyKey !== "string" || body.manifest === undefined || body.confirm !== true) {
        throw new SkillHttpError("VALIDATION_ERROR", 422);
      }
      requireSkillsMutationFeature(body.expertId.trim());
      const { service, context, tier } = await resolveRuntime(request, body.expertId.trim(), true);
      const result = await service.importSkills({ context, tier, manifest: body.manifest, idempotencyKey: body.idempotencyKey, requestId: id });
      return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: responseHeaders(id) });
    } catch (error) { return handle(error, id); }
  };
}

export function createSkillDetailHandler(resolveRuntime: SkillRuntimeResolver = runtime) {
  return async (request: NextRequest, route: { params: { skillId: string } }) => {
    const id = requestId(request);
    try {
      requireSkillsFeature();
      const expertId = request.nextUrl.searchParams.get("expertId")?.trim();
      if (!expertId) throw new SkillHttpError("VALIDATION_ERROR", 422);
      const rawVersion = request.nextUrl.searchParams.get("version");
      const versionNumber = rawVersion ? Number(rawVersion) : undefined;
      if (versionNumber !== undefined && (!Number.isInteger(versionNumber) || versionNumber < 1)) throw new SkillHttpError("VALIDATION_ERROR", 422);
      const { service, context } = await resolveRuntime(request, expertId);
      return NextResponse.json({ ...await service.get({ context, skillId: route.params.skillId, versionNumber }), capabilities: { mutations: skillsMutationsEnabledFor(context.expertId) } }, { headers: responseHeaders(id) });
    } catch (error) { return handle(error, id); }
  };
}

type SkillAction = "update" | "submit-review" | "request-changes" | "publish";

export function createSkillVersionMutationHandler(action: SkillAction, resolveRuntime: SkillRuntimeResolver = runtime) {
  return async (request: NextRequest, route: { params: { skillId: string; versionNumber: string } }) => {
    const id = requestId(request);
    try {
      requireSkillsFeature();
      const body = await request.json() as Record<string, unknown>;
      const versionNumber = Number(route.params.versionNumber);
      if (typeof body.expertId !== "string" || !Number.isInteger(versionNumber) || versionNumber < 1 ||
        !Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) throw new SkillHttpError("VALIDATION_ERROR", 422);
      requireSkillsMutationFeature(body.expertId.trim());
      const { service, context } = await resolveRuntime(request, body.expertId.trim(), true);
      const common = { context, skillId: route.params.skillId, versionNumber, expectedVersion: body.expectedVersion as number, requestId: id };
      const result = action === "submit-review" ? await service.submitReview(common)
        : action === "publish" ? await service.publish(common)
          : action === "request-changes" && typeof body.note === "string" ? await service.requestChanges({ ...common, note: body.note })
            : action === "update" && typeof body.name === "string" && typeof body.description === "string" && Array.isArray(body.outcomes) && Array.isArray(body.tags) && typeof body.ownerUserId === "string"
              ? await service.update({ ...common, content: { name: body.name, description: body.description, outcomes: body.outcomes as string[], tags: body.tags as string[], ownerUserId: body.ownerUserId } })
              : (() => { throw new SkillHttpError("VALIDATION_ERROR", 422); })();
      return NextResponse.json(result, { headers: responseHeaders(id) });
    } catch (error) { return handle(error, id); }
  };
}

export function createNextSkillVersionHandler(resolveRuntime: SkillRuntimeResolver = runtime) {
  return async (request: NextRequest, route: { params: { skillId: string } }) => {
    const id = requestId(request);
    try {
      requireSkillsFeature();
      const body = await request.json() as Record<string, unknown>;
      if (typeof body.expertId !== "string") throw new SkillHttpError("VALIDATION_ERROR", 422);
      requireSkillsMutationFeature(body.expertId.trim());
      const { service, context } = await resolveRuntime(request, body.expertId.trim(), true);
      return NextResponse.json(await service.nextDraft({ context, skillId: route.params.skillId, requestId: id }), { status: 201, headers: responseHeaders(id) });
    } catch (error) { return handle(error, id); }
  };
}
