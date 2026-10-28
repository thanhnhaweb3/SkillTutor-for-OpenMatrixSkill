const baseUrl = (process.env.PHASE3_LIVE_BASE_URL ?? "https://dashboard.openmatrixskill.com").replace(/\/$/, "");
const expectedMode = process.env.PHASE3_LIVE_EXPECTED_MODE ?? "read-only";
const probes = [
  ["courses", "/api/dashboard/courses?expertId=probe"],
  ["cohorts", "/api/dashboard/cohorts?expertId=probe"],
  ["progress", "/api/dashboard/progress/me?expertId=probe&cohortId=probe"]
];
const results = [];
for (const [name, path] of probes) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual", headers: { accept: "application/json" } });
  const contentType = response.headers.get("content-type") ?? "";
  let body; try { body = contentType.includes("application/json") ? await response.json() : await response.text(); } catch { body = undefined; }
  const code = body && typeof body === "object" && "error" in body ? body.error?.code : undefined;
  const item = { name, path, status: response.status, code, cacheControl: response.headers.get("cache-control"), requestId: response.headers.get("x-request-id"), matchedPath: response.headers.get("x-matched-path") };
  results.push(item);
  if (response.status === 404 && item.matchedPath === "/_not-found") throw new Error(`${name} route is not deployed`);
  const disabledCode = name === "courses" ? "COURSES_DISABLED" : name === "cohorts" ? "ENROLLMENTS_DISABLED" : "PROGRESS_DISABLED";
  if (expectedMode === "disabled") {
    if (response.status !== 503 || code !== disabledCode) throw new Error(`${name} expected 503 ${disabledCode}, received ${response.status} ${code ?? "without error code"}`);
  } else if (response.status !== 401 || code !== "UNAUTHENTICATED") {
    throw new Error(`${name} expected 401 UNAUTHENTICATED, received ${response.status} ${code ?? "without error code"}`);
  }
  if (!item.cacheControl?.includes("no-store") || !item.requestId) throw new Error(`${name} is missing private no-store or request ID headers`);
}
console.log(JSON.stringify({ ok: true, baseUrl, expectedMode, probes: results }));
