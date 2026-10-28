import { createSkillsCollectionHandlers } from "@openmatrix/dashboard/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createSkillsCollectionHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
