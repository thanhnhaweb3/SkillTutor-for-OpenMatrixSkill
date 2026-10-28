import { createSimulatorHandlers } from "@openmatrix/skilltutor/next";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export const maxDuration = 60; // Claude on Bedrock + tool calls
const handlers = createSimulatorHandlers();
export const GET = handlers.GET; export const POST = handlers.POST;
