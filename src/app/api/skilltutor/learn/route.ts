import { createLearnHandlers } from "@openmatrix/skilltutor/next";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
// "Learn on the web" = the WhatsApp conversation in the browser (rules engine).
export const maxDuration = 60;
const handlers = createLearnHandlers();
export const GET = handlers.GET; export const POST = handlers.POST;
