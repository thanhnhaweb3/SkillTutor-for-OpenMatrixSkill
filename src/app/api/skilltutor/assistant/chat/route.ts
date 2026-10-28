import { createAssistantChatHandlers } from "@openmatrix/skilltutor/next";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
// SkillTutor AI: Claude on Amazon Bedrock with tool use; allow up to 60 s on Vercel.
export const maxDuration = 60;
const handlers = createAssistantChatHandlers();
export const GET = handlers.GET; export const POST = handlers.POST;
