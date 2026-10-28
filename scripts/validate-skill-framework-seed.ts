import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateFrameworkInput } from "../packages/dashboard/src/skills/validation";

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error("Usage: npm run validate:skill-framework-seed -- <manifest.json>");
  const parsed = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as Record<string, unknown>;
  if (typeof parsed.expertId !== "string" || !parsed.expertId.trim()) throw new Error("expertId is required");
  if (typeof parsed.actorUserId !== "string" || !parsed.actorUserId.trim()) throw new Error("actorUserId is required");
  if (typeof parsed.name !== "string" || parsed.description !== undefined && typeof parsed.description !== "string" ||
    !Array.isArray(parsed.proficiencyLevels)) throw new Error("Invalid framework manifest shape");
  const framework = validateFrameworkInput({
    name: parsed.name,
    description: parsed.description as string | undefined,
    proficiencyLevels: parsed.proficiencyLevels as Array<{ code: string; rank: number; name: string; description: string }>
  });
  console.log(JSON.stringify({
    ok: true,
    mode: "dry-run",
    expertIdPresent: true,
    actorUserIdPresent: true,
    framework: {
      name: framework.name,
      descriptionPresent: framework.description !== undefined,
      proficiencyLevelCount: framework.proficiencyLevels.length,
      proficiencyCodes: framework.proficiencyLevels.map((level) => level.code)
    },
    committed: false
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
