import { createAcHandlers } from "@openmatrix/oms-ac-login/next";
import type { ConnectProviderId } from "@openmatrix/oms-ac-login";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createAcHandlers();

export function GET(
  request: NextRequest,
  { params }: { params: { provider: ConnectProviderId } }
) {
  return handlers.connectStatus(request, params.provider);
}
