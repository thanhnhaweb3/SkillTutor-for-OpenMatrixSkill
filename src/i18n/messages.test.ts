import assert from "node:assert/strict";
import test from "node:test";
import { en, vi } from "./messages";

test("Vietnamese and English catalogs have identical keys and no blank values", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(vi).sort());
  for (const [key, value] of Object.entries(vi)) assert.ok(value.trim(), `blank vi key: ${key}`);
  for (const [key, value] of Object.entries(en)) assert.ok(value.trim(), `blank en key: ${key}`);
});

test("API error catalogs are bilingual", async () => {
  const { apiErrorMessages } = await import("./messages");
  assert.deepEqual(Object.keys(apiErrorMessages.en).sort(), Object.keys(apiErrorMessages.vi).sort());
});
