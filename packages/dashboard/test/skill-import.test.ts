import assert from "node:assert/strict";
import test from "node:test";
import { SkillDomainError } from "../src/skills/errors";
import { validateCanonicalSkillImport } from "../src/skills/import";

test("canonical skill import normalizes codes and excludes trusted owner fields", () => {
  const preview = validateCanonicalSkillImport({ schemaVersion: 1, frameworkId: " framework-a ", skills: [{
    code: " sys ", name: "Systems Thinking", description: "Understand connected systems.",
    outcomes: ["Model feedback loops"], tags: ["systems"]
  }] }, "user-a");
  assert.equal(preview.frameworkId, "framework-a");
  assert.equal(preview.skills[0].code, "SYS");
  assert.ok(!("ownerUserId" in preview.skills[0]));
});

test("canonical skill import rejects duplicate codes and unknown trust-boundary fields", () => {
  const base = { schemaVersion: 1, frameworkId: "framework-a", skills: [
    { code: "SYS", name: "Systems A", description: "Understand connected systems.", outcomes: ["Model systems"], tags: [] },
    { code: "sys", name: "Systems B", description: "Understand connected systems.", outcomes: ["Map systems"], tags: [] }
  ] };
  assert.throws(() => validateCanonicalSkillImport(base, "user-a"), SkillDomainError);
  assert.throws(() => validateCanonicalSkillImport({ ...base, actorUserId: "user-b", skills: [base.skills[0]] }, "user-a"), SkillDomainError);
});
