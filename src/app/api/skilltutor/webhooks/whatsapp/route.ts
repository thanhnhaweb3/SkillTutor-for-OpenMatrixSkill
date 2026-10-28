import { createWebhookStatusHandler, createWhatsAppWebhookHandler } from "@openmatrix/skilltutor/next";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export const maxDuration = 60; // Claude on Bedrock + tool calls
export const POST = createWhatsAppWebhookHandler();
/** Open in a browser to check the WhatsApp setup (flags only, no secrets). */
export const GET = createWebhookStatusHandler();
