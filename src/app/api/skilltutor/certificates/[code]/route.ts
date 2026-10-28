import { createCertificateVerifyHandler } from "@openmatrix/skilltutor/next";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export const GET = createCertificateVerifyHandler();
