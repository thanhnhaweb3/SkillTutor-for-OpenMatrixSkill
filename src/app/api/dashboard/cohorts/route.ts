import { createCohortHandlers } from "@openmatrix/dashboard/next";
export const dynamic = "force-dynamic"; const handlers = createCohortHandlers(); export const GET = handlers.GET; export const POST = handlers.POST;
