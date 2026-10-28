import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadAcConfig, readSessionToken, SESSION_COOKIE } from "@openmatrix/oms-ac-login";
import { createUserStore, usesPersistentUserStore } from "@openmatrix/oms-ac-login";
import { DashboardContractError, resolveDashboardMe } from "../core/context";
import type { DashboardErrorBody } from "../core/types";
import { createDashboardRepository } from "../data/create-repository";
import type { DashboardRepository } from "../data/repositories";

function errorResponse(code: DashboardErrorBody["error"]["code"], status: number, requestId: string) {
  const messages: Record<DashboardErrorBody["error"]["code"], string> = {
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
  return NextResponse.json({ error: { code, message: messages[code], requestId } }, { status });
}

export function createDashboardMeHandler(repository?: DashboardRepository) {
  return async function GET(request: NextRequest) {
    const requestId = request.headers.get("x-request-id")?.trim() || `req_${randomUUID()}`;
    try {
      const config = loadAcConfig();
      const payload = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value, config.sessionSecret);
      if (!payload) return errorResponse("UNAUTHENTICATED", 401, requestId);
      const store = createUserStore(config);
      const user = usesPersistentUserStore(config) ? await store.findById(payload.userId) : payload.user;
      if (!user) return errorResponse("UNAUTHENTICATED", 401, requestId);

      const dashboardRepository = repository ?? createDashboardRepository();
      const requestedExpertId = request.nextUrl.searchParams.get("expertId")?.trim() || undefined;
      const { me } = await resolveDashboardMe({
        user: { id: user.id, displayName: user.name },
        requestedExpertId,
        repository: dashboardRepository
      });
      return NextResponse.json(me, { headers: { "x-request-id": requestId } });
    } catch (error) {
      if (error instanceof DashboardContractError) {
        return errorResponse(error.code, error.status, requestId);
      }
      console.error("dashboard_me_failed", { requestId, error });
      return errorResponse("INTERNAL_ERROR", 500, requestId);
    }
  };
}
