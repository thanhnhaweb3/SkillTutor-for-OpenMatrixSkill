import { createLevel0BootstrapHandler } from "@openmatrix/dashboard/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createLevel0BootstrapHandler();
