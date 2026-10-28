import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createUserStore,
  loadAcConfig,
  readSessionToken,
  SESSION_COOKIE,
  usesPersistentUserStore
} from "@openmatrix/oms-ac-login";
import { DashboardContractError, resolveDashboardMe } from "../core/context";
import { MembershipMutationError, MembershipService } from "../core/membership-service";
import type { DashboardErrorBody, ExpertRole, MembershipStatus } from "../core/types";
import { createMembershipMutationRepository } from "../data/create-repository";

type ErrorCode = DashboardErrorBody["error"]["code"];

const messages: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Authentication is required.",
  NOT_MEMBER: "You are not a member of an active Expert.",
  MEMBERSHIP_INACTIVE: "Your Expert membership is not active.",
  MISSING_PERMISSION: "You do not have permission to perform this action.",
  OUTSIDE_EXPERT: "The requested resource was not found.",
  RESOURCE_NOT_ASSIGNED: "The requested resource is not assigned to you.",
  VALIDATION_ERROR: "The request is invalid.",
  VERSION_CONFLICT: "The membership changed; reload and try again.",
  MUTATIONS_DISABLED: "Dashboard membership changes are not enabled.",
  BOOTSTRAP_DISABLED: "Level 0 workspace activation is not enabled.",
  BOOTSTRAP_UNAVAILABLE: "Level 0 workspace activation is not configured on the server.",
  INTERNAL_ERROR: "The request could not be completed."
};

function responseError(code: ErrorCode, status: number, requestId: string) {
  return NextResponse.json({ error: { code, message: messages[code], requestId } }, { status });
}

function requireMutationRequest(request: NextRequest, appUrl: string) {
  if (process.env.DASHBOARD_MUTATIONS_ENABLED !== "true") {
    throw new MutationHttpError("MUTATIONS_DISABLED", 503);
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) throw new MutationHttpError("VALIDATION_ERROR", 415);
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(appUrl).origin) throw new MutationHttpError("MISSING_PERMISSION", 403);
}

class MutationHttpError extends Error {
  constructor(readonly code: ErrorCode, readonly status: number) {
    super(code);
  }
}

async function contextFor(request: NextRequest, expertId: string) {
  const config = loadAcConfig();
  requireMutationRequest(request, config.appUrl);
  const payload = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret);
  if (!payload) throw new MutationHttpError("UNAUTHENTICATED", 401);
  const userStore = createUserStore(config);
  const user = usesPersistentUserStore(config) ? await userStore.findById(payload.userId) : payload.user;
  if (!user) throw new MutationHttpError("UNAUTHENTICATED", 401);
  const repository = createMembershipMutationRepository();
  const { context } = await resolveDashboardMe({
    user: { id: user.id, displayName: user.name },
    requestedExpertId: expertId,
    repository
  });
  return { context, service: new MembershipService(repository) };
}

function statusForMutationError(code: MembershipMutationError["code"]) {
  if (code === "VERSION_CONFLICT") return 409;
  if (code === "VALIDATION_ERROR") return 422;
  return 403;
}

function handleError(error: unknown, requestId: string) {
  if (error instanceof MutationHttpError) return responseError(error.code, error.status, requestId);
  if (error instanceof DashboardContractError) return responseError(error.code, error.status, requestId);
  if (error instanceof MembershipMutationError) {
    return responseError(error.code, statusForMutationError(error.code), requestId);
  }
  if (error instanceof Error && error.name === "TransactionCanceledException") {
    return responseError("VERSION_CONFLICT", 409, requestId);
  }
  console.error("dashboard_membership_mutation_failed", { requestId, error });
  return responseError("INTERNAL_ERROR", 500, requestId);
}

export function createMembershipInviteHandler() {
  return async function POST(request: NextRequest) {
    const requestId = request.headers.get("x-request-id")?.trim() || `req_${randomUUID()}`;
    try {
      const body = await request.json() as { expertId?: unknown; userId?: unknown; roles?: unknown };
      if (typeof body.expertId !== "string" || typeof body.userId !== "string" || !Array.isArray(body.roles)) {
        throw new MutationHttpError("VALIDATION_ERROR", 422);
      }
      const { context, service } = await contextFor(request, body.expertId.trim());
      const membership = await service.invite({
        context,
        userId: body.userId.trim(),
        roles: body.roles as ExpertRole[],
        requestId
      });
      return NextResponse.json({ membership }, { status: 201, headers: { "x-request-id": requestId } });
    } catch (error) {
      return handleError(error, requestId);
    }
  };
}

export function createMembershipUpdateHandler() {
  return async function PATCH(request: NextRequest, route: { params: { userId: string } }) {
    const requestId = request.headers.get("x-request-id")?.trim() || `req_${randomUUID()}`;
    try {
      const body = await request.json() as {
        expertId?: unknown;
        action?: unknown;
        status?: unknown;
        roles?: unknown;
        expectedVersion?: unknown;
      };
      if (typeof body.expertId !== "string" || typeof body.action !== "string" ||
          !Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) {
        throw new MutationHttpError("VALIDATION_ERROR", 422);
      }
      const { context, service } = await contextFor(request, body.expertId.trim());
      const common = {
        context,
        userId: route.params.userId,
        expectedVersion: body.expectedVersion as number,
        requestId
      };
      const membership = body.action === "assign_roles" && Array.isArray(body.roles)
        ? await service.assignRoles({ ...common, roles: body.roles as ExpertRole[] })
        : body.action === "change_status" && typeof body.status === "string"
          ? await service.changeStatus({ ...common, status: body.status as MembershipStatus })
          : (() => { throw new MutationHttpError("VALIDATION_ERROR", 422); })();
      return NextResponse.json({ membership }, { headers: { "x-request-id": requestId } });
    } catch (error) {
      return handleError(error, requestId);
    }
  };
}
