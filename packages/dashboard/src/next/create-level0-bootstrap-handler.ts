import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createUserStore,
  loadAcConfig,
  readSessionToken,
  SESSION_COOKIE,
  usesPersistentUserStore
} from "@openmatrix/oms-ac-login";
import { Level0BootstrapError, Level0BootstrapService } from "../core/level0-bootstrap-service";
import type { DashboardErrorBody } from "../core/types";
import { createLevel0BootstrapRepository } from "../data/create-repository";
import type { Level0BootstrapRepository } from "../data/repositories";

type ErrorCode = DashboardErrorBody["error"]["code"];

const messages: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Authentication is required.",
  NOT_MEMBER: "You are not a member of an active Expert.",
  MEMBERSHIP_INACTIVE: "Your Expert membership is not active.",
  MISSING_PERMISSION: "You do not have permission to perform this action.",
  OUTSIDE_EXPERT: "The requested resource was not found.",
  RESOURCE_NOT_ASSIGNED: "The requested resource is not assigned to you.",
  VALIDATION_ERROR: "The request is invalid.",
  VERSION_CONFLICT: "The workspace changed; reload and try again.",
  MUTATIONS_DISABLED: "Dashboard membership changes are not enabled.",
  BOOTSTRAP_DISABLED: "Level 0 workspace activation is not enabled.",
  BOOTSTRAP_UNAVAILABLE: "Level 0 workspace activation is not configured on the server.",
  INTERNAL_ERROR: "The request could not be completed."
};

function errorResponse(code: ErrorCode, status: number, requestId: string) {
  return NextResponse.json({ error: { code, message: messages[code], requestId } }, {
    status,
    headers: { "x-request-id": requestId }
  });
}

export function createLevel0BootstrapHandler(repository?: Level0BootstrapRepository) {
  return async function POST(request: NextRequest) {
    const requestId = request.headers.get("x-request-id")?.trim() || `req_${randomUUID()}`;
    try {
      if (process.env.DASHBOARD_LEVEL0_BOOTSTRAP_ENABLED !== "true") {
        return errorResponse("BOOTSTRAP_DISABLED", 503, requestId);
      }
      const config = loadAcConfig();
      const origin = request.headers.get("origin");
      if (!origin || origin !== new URL(config.appUrl).origin) {
        return errorResponse("MISSING_PERMISSION", 403, requestId);
      }
      const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.startsWith("application/json")) {
        return errorResponse("VALIDATION_ERROR", 415, requestId);
      }
      const body = await request.json();
      if (!body || typeof body !== "object" || Object.keys(body as object).length !== 0) {
        return errorResponse("VALIDATION_ERROR", 422, requestId);
      }

      const payload = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret);
      if (!payload) return errorResponse("UNAUTHENTICATED", 401, requestId);
      const userStore = createUserStore(config);
      const user = usesPersistentUserStore(config) ? await userStore.findById(payload.userId) : payload.user;
      if (!user) return errorResponse("UNAUTHENTICATED", 401, requestId);

      const service = new Level0BootstrapService(repository ?? createLevel0BootstrapRepository());
      const result = await service.bootstrap({ userId: user.id, requestId });
      return NextResponse.json(result, {
        status: result.created ? 201 : 200,
        headers: { "x-request-id": requestId }
      });
    } catch (error) {
      if (error instanceof Level0BootstrapError) {
        console.error("dashboard_level0_bootstrap_inconsistent", { requestId, code: error.code });
        return errorResponse("INTERNAL_ERROR", 500, requestId);
      }
      if (error instanceof Error && error.name === "AccessDeniedException") {
        console.error("dashboard_level0_bootstrap_access_denied", { requestId, error });
        return errorResponse("BOOTSTRAP_UNAVAILABLE", 503, requestId);
      }
      console.error("dashboard_level0_bootstrap_failed", { requestId, error });
      return errorResponse("INTERNAL_ERROR", 500, requestId);
    }
  };
}
