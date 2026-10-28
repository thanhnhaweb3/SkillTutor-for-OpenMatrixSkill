import assert from "node:assert/strict";
import test from "node:test";
import { enrollmentEnabledFor, progressEnabledFor } from "../src/next/create-delivery-handlers";
function restore(key: string, value?: string) { value === undefined ? delete process.env[key] : process.env[key] = value; }
test("enrollment and progress flags are independent and exact-Expert", () => { const e = process.env.DASHBOARD_ENROLLMENTS_ENABLED, p = process.env.DASHBOARD_PROGRESS_ENABLED, a = process.env.DASHBOARD_DELIVERY_CANARY_EXPERT_IDS;
  try { process.env.DASHBOARD_ENROLLMENTS_ENABLED = "true"; delete process.env.DASHBOARD_PROGRESS_ENABLED; process.env.DASHBOARD_DELIVERY_CANARY_EXPERT_IDS = "expert-a";
    assert.equal(enrollmentEnabledFor("expert-a"), true); assert.equal(progressEnabledFor("expert-a"), false); assert.equal(enrollmentEnabledFor("expert-b"), false);
    process.env.DASHBOARD_PROGRESS_ENABLED = "true"; delete process.env.DASHBOARD_ENROLLMENTS_ENABLED; assert.equal(progressEnabledFor("expert-a"), true); assert.equal(enrollmentEnabledFor("expert-a"), false);
  } finally { restore("DASHBOARD_ENROLLMENTS_ENABLED", e); restore("DASHBOARD_PROGRESS_ENABLED", p); restore("DASHBOARD_DELIVERY_CANARY_EXPERT_IDS", a); } });
