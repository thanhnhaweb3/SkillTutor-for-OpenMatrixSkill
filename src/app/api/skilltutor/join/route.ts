import { createJoinHandlers } from "@openmatrix/skilltutor/next";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const handlers = createJoinHandlers();
export const GET = handlers.GET; export const POST = handlers.POST;
