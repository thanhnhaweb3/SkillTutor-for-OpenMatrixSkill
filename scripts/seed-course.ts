// Imports a course manifest (skills + course + cohort + enrollments) into OMS through the domain services.
// Dry-run by default; add --commit to write.
// Usage:
//   npm run seed:course -- docs/courses/ai-van-phong-nang-cao.json --author admin@x.com --reviewer reviewer@x.com --learner me@x.com [--learner ...] [--expert <expertId>] [--tier pro] [--commit]
//   The free plan allows 1 published course + 1 active cohort per Expert; add --tier pro for a second course.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDashboardRepository } from "../packages/dashboard/src/data/create-repository";
import { createSkillRepository } from "../packages/dashboard/src/skills/create-repository";
import { createCourseRepository } from "../packages/dashboard/src/courses/create-repository";
import { createDeliveryRepository } from "../packages/dashboard/src/delivery/create-repository";
import { createUserStore, loadAcConfig } from "../packages/oms-ac-login/src";
import { seedCourse, validateManifest, type CourseManifest } from "../packages/skilltutor/src/oms/course-seed";

function args(name: string) {
  const out: string[] = [];
  process.argv.forEach((a, i) => { if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]); });
  return out;
}

async function main() {
  const manifestPath = process.argv.slice(2).find((a) => a.endsWith(".json"));
  const commit = process.argv.includes("--commit");
  const [authorEmail] = args("author"), [reviewerEmail] = args("reviewer"), learnerEmails = args("learner"), [expertArg] = args("expert"), [tierArg] = args("tier");
  if (tierArg && !["free", "pro", "enterprise"].includes(tierArg)) throw new Error("--tier must be free, pro or enterprise");
  if (!manifestPath || !authorEmail || !reviewerEmail) {
    throw new Error("Usage: npm run seed:course -- <manifest.json> --author <email> --reviewer <email> [--learner <email>]... [--expert <expertId>] [--tier pro] [--commit]");
  }
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8")) as CourseManifest;
  const checked = validateManifest(manifest);
  console.log(`✓ Manifest valid: ${manifest.skills.length} skills, ${checked.lessonCount} lessons, levels ${checked.levels.join("/")}`);

  const users = createUserStore(loadAcConfig());
  const byEmail = async (email: string) => {
    const user = await users.findByEmail(email.trim().toLowerCase());
    if (!user) throw new Error(`No OMS account with email ${email} – sign in once with that account first`);
    return user;
  };
  const author = await byEmail(authorEmail), reviewer = await byEmail(reviewerEmail);
  const learners = await Promise.all(learnerEmails.map(byEmail));

  const dashboard = createDashboardRepository();
  let expertId = expertArg;
  if (!expertId) {
    const admin = (await dashboard.listMembershipsByUser(author.id)).filter((m) => m.status === "active" && m.roles.some((r) => r === "expert_admin" || r === "platform_admin"));
    if (admin.length !== 1) throw new Error(`Author is admin of ${admin.length} Experts (${admin.map((m) => m.expertId).join(", ") || "none"}); pass --expert <expertId>`);
    expertId = admin[0].expertId;
  }
  console.log(`Expert ${expertId} · author ${author.name} · reviewer ${reviewer.name} · learners ${learners.map((l) => l.name).join(", ") || "(none)"}`);
  console.log(commit ? "Mode: COMMIT (writes to OMS)\n" : "Mode: dry-run (no writes; add --commit)\n");

  const result = await seedCourse({
    repos: { dashboard, skills: createSkillRepository(), courses: createCourseRepository(), delivery: createDeliveryRepository() },
    manifest, expertId, authorUserId: author.id, reviewerUserId: reviewer.id, learnerUserIds: learners.map((l) => l.id), commit,
    tier: tierArg as "free" | "pro" | "enterprise" | undefined,
    log: (line) => console.log(`  ${line}`)
  });
  console.log("\n" + JSON.stringify(result, null, 2));
  if (!commit) console.log("\nDry-run only. Re-run with --commit to create the course.");
  else console.log(`\nDone. Learners can now open Skill Tutor → Learn on web, or message the WhatsApp number with "học".`);
}

main().catch((error) => {
  console.error(`✗ ${error?.code ? `${error.code}: ` : ""}${error?.message ?? error}`);
  process.exitCode = 1;
});
