import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { courseMutationsEnabledFor, createCoursesCollectionHandlers, requireCoursesFeature, requireCourseMutationFeature,
  validateCourseMutationRequest, type CourseHandlerRuntime } from "../src/next/create-course-handlers";

async function env<T>(values: Record<string, string | undefined>, run: () => T | Promise<T>): Promise<T> { const old = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) v === undefined ? delete process.env[k] : process.env[k] = v;
  try { return await run(); } finally { for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : process.env[k] = v; } }

test("course read and mutation flags are independently default-off", async () => {
  await env({ DASHBOARD_COURSES_ENABLED: undefined, DASHBOARD_COURSES_MUTATIONS_ENABLED: undefined }, () => {
    assert.throws(() => requireCoursesFeature()); assert.throws(() => requireCourseMutationFeature("expert-a"));
  });
});

test("course mutation canary is exact-Expert and default-deny", async () => {
  await env({ DASHBOARD_COURSES_MUTATIONS_ENABLED: "true", DASHBOARD_COURSES_CANARY_EXPERT_IDS: "expert-a" }, () => {
    assert.equal(courseMutationsEnabledFor("expert-a"), true); assert.equal(courseMutationsEnabledFor("expert-b"), false);
  });
});

test("course mutations require JSON, exact origin and bounded payload", () => {
  const request = (headers: Record<string, string>) => new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/courses", { method: "POST", headers: { "idempotency-key": "course:req:1", ...headers } });
  assert.doesNotThrow(() => validateCourseMutationRequest(request({ origin: "https://dashboard.openmatrixskill.com", "content-type": "application/json" }), "https://dashboard.openmatrixskill.com"));
  assert.throws(() => validateCourseMutationRequest(request({ origin: "https://evil.example", "content-type": "application/json" }), "https://dashboard.openmatrixskill.com"));
  assert.throws(() => validateCourseMutationRequest(request({ origin: "https://dashboard.openmatrixskill.com", "content-type": "text/plain" }), "https://dashboard.openmatrixskill.com"));
  assert.throws(() => validateCourseMutationRequest(request({ origin: "https://dashboard.openmatrixskill.com", "content-type": "application/json", "content-length": "320001" }), "https://dashboard.openmatrixskill.com"));
  assert.throws(() => validateCourseMutationRequest(new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/courses", { method: "POST",
    headers: { origin: "https://dashboard.openmatrixskill.com", "content-type": "application/json" } }), "https://dashboard.openmatrixskill.com"));
});

test("course transaction error maps to safe 409 envelope", async () => {
  await env({ DASHBOARD_COURSES_ENABLED: "true", DASHBOARD_COURSES_MUTATIONS_ENABLED: "true", DASHBOARD_COURSES_CANARY_EXPERT_IDS: "*" }, async () => {
    const conflict = new Error("secret table ARN and conditional details"); conflict.name = "TransactionCanceledException";
    const service = { create: async () => { throw conflict; } } as unknown as CourseHandlerRuntime["service"];
    const resolver = async () => ({ service, context: { userId: "user-a", expertId: "expert-a", membershipId: "m1", roles: ["expert_admin"] as const,
      permissions: ["course:create"] as const }, tier: "free" as const });
    const response = await createCoursesCollectionHandlers(resolver as never).POST(new NextRequest("https://dashboard.openmatrixskill.com/api/dashboard/courses", { method: "POST",
      headers: { origin: "https://dashboard.openmatrixskill.com", "content-type": "application/json" }, body: JSON.stringify({ expertId: "expert-a", code: "C1", title: "Course",
        description: "Course description.", ownerUserId: "user-a", modules: [] }) }));
    const body = await response.json(); assert.equal(response.status, 409); assert.equal(body.error.code, "VERSION_CONFLICT");
    assert.ok(!JSON.stringify(body).includes("secret table")); assert.match(response.headers.get("x-request-id") ?? "", /^req_/);
  });
});
