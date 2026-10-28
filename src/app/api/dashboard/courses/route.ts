import { createCoursesCollectionHandlers } from "@openmatrix/dashboard/next";
export const dynamic = "force-dynamic";
const handlers = createCoursesCollectionHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
