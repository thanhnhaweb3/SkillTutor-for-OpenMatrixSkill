import { createAcHandlers } from "@openmatrix/oms-ac-login/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createAcHandlers();

export const POST = handlers.authResendSignUpCode;
