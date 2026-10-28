import { createSmsWebhookHandler } from "@openmatrix/skilltutor/next";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export const maxDuration = 60; // Claude on Bedrock + tool calls
export const POST = createSmsWebhookHandler();
