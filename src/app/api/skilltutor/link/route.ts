import { createLinkHandlers } from "@openmatrix/skilltutor/next";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const handlers = createLinkHandlers();
export const GET = handlers.GET; export const POST = handlers.POST; export const DELETE = handlers.DELETE;
