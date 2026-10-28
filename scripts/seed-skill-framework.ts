import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDashboardRepository } from "../packages/dashboard/src/data/create-repository";
import { createSkillRepository } from "../packages/dashboard/src/skills/create-repository";
import type { SkillFramework, SkillFrameworkVersion } from "../packages/dashboard/src/skills/types";
import { validateFrameworkInput } from "../packages/dashboard/src/skills/validation";

async function main() {
  const manifestPath = process.argv.find((argument) => argument.endsWith(".json"));
  const commit = process.argv.includes("--commit");
  if (!manifestPath) throw new Error("Usage: npm run seed:skill-framework -- <manifest.json> [--commit]");
  const parsed = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as Record<string, unknown>;
  if (typeof parsed.expertId !== "string" || !parsed.expertId.trim()) throw new Error("expertId is required");
  if (typeof parsed.actorUserId !== "string" || !parsed.actorUserId.trim()) throw new Error("actorUserId is required");
  if (typeof parsed.name !== "string" || parsed.description !== undefined && typeof parsed.description !== "string" || !Array.isArray(parsed.proficiencyLevels)) {
    throw new Error("Invalid framework manifest shape");
  }
  const expertId = parsed.expertId.trim();
  const actorUserId = parsed.actorUserId.trim();
  const validated = validateFrameworkInput({
    name: parsed.name,
    description: parsed.description as string | undefined,
    proficiencyLevels: parsed.proficiencyLevels as Array<{ code: string; rank: number; name: string; description: string }>
  });
  const dashboardRepository = createDashboardRepository();
  const [expert, actorMembership] = await Promise.all([
    dashboardRepository.getExpert(expertId),
    dashboardRepository.getMembership(expertId, actorUserId)
  ]);
  if (!expert || expert.status !== "active") throw new Error("Expert must exist and be active");
  if (!actorMembership || actorMembership.status !== "active" ||
    !actorMembership.roles.some((role) => role === "expert_admin" || role === "platform_admin")) {
    throw new Error("Seed actor must be an active Expert admin");
  }
  const now = new Date().toISOString();
  const frameworkId = `framework_${randomUUID()}`;
  const versionId = `frameworkv_${randomUUID()}`;
  const framework: SkillFramework = {
    id: frameworkId, expertId, name: validated.name, currentVersionNumber: 1, version: 1,
    createdAt: now, createdBy: actorUserId, updatedAt: now, updatedBy: actorUserId
  };
  const version: SkillFrameworkVersion = {
    id: versionId, expertId, frameworkId, versionNumber: 1, name: validated.name,
    description: validated.description, proficiencyLevels: validated.proficiencyLevels,
    publishedAt: now, publishedBy: actorUserId, createdAt: now, createdBy: actorUserId
  };
  const summary = {
    ok: true, expertId, actorUserId, frameworkId, versionId, name: framework.name,
    proficiencyCodes: version.proficiencyLevels.map((level) => level.code), committed: false
  };
  if (!commit) {
    console.log(JSON.stringify({ ...summary, mode: "dry-run" }));
    return;
  }
  if (process.env.ALLOW_SKILL_FRAMEWORK_SEED !== "true") throw new Error("ALLOW_SKILL_FRAMEWORK_SEED=true is required for commit");
  const repository = createSkillRepository();
  await repository.commitSeedFramework({
    framework,
    version,
    audit: {
      eventId: `audit_${randomUUID()}`, occurredAt: now, requestId: `seed_${randomUUID()}`,
      actorUserId, expertId, action: "skill_framework:seed_v1", targetType: "skill_framework",
      targetId: frameworkId, result: "allowed",
      afterHash: createHash("sha256").update(JSON.stringify(version)).digest("hex")
    }
  });
  console.log(JSON.stringify({ ...summary, mode: "commit", committed: true }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
