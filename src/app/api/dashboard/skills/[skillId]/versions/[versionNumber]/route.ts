import { createSkillVersionMutationHandler } from "@openmatrix/dashboard/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const PATCH = createSkillVersionMutationHandler("update");
