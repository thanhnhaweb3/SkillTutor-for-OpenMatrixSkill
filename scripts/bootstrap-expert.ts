// Creates (or returns) the Level 0 Expert workspace for an OMS account, the same thing /dashboard does on first visit
// when DASHBOARD_LEVEL0_BOOTSTRAP_ENABLED=true. Idempotent: an existing workspace is returned, never duplicated.
// Usage:
//   npx tsx --env-file=.env scripts/bootstrap-expert.ts --email admin@x.com
import { Level0BootstrapService } from "../packages/dashboard/src/core/level0-bootstrap-service";
import { createLevel0BootstrapRepository } from "../packages/dashboard/src/data/create-repository";
import { createUserStore, loadAcConfig } from "../packages/oms-ac-login/src";

async function main() {
  const i = process.argv.indexOf("--email");
  const email = i >= 0 ? process.argv[i + 1]?.trim().toLowerCase() : undefined;
  if (!email) throw new Error("Usage: npx tsx --env-file=.env scripts/bootstrap-expert.ts --email <admin email>");
  const user = await createUserStore(loadAcConfig()).findByEmail(email);
  if (!user) throw new Error(`No OMS account with email ${email} – sign in once with that account first`);
  const result = await new Level0BootstrapService(createLevel0BootstrapRepository()).bootstrap({ userId: user.id, requestId: "req_cli_bootstrap_expert" });
  console.log(`${result.created ? "✓ Created" : "✓ Already exists"}: Expert ${result.expert.id} (${result.expert.displayName}) · ${user.name} · roles ${result.membership.roles.join(", ")} · tier ${result.membership.tier}`);
  console.log(`\nNext: npm run seed:course -- <manifest.json> --author ${email} --reviewer <email> [--learner <email>] [--tier pro]`);
}

main().catch((error) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
