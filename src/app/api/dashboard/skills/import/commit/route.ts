import { createSkillImportCommitHandler } from "@openmatrix/dashboard/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createSkillImportCommitHandler();
