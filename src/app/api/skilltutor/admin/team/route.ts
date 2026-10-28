import { createTeamAdminHandlers } from "@openmatrix/skilltutor/next";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const handlers = createTeamAdminHandlers();
export const GET = handlers.GET; export const POST = handlers.POST;
