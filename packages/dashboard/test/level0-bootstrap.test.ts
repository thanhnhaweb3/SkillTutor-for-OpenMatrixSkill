import assert from "node:assert/strict";
import test from "node:test";
import { resolveDashboardMe } from "../src/core/context";
import { Level0BootstrapService } from "../src/core/level0-bootstrap-service";
import { InMemoryDashboardRepository } from "../src/data/repositories";

const fixedDate = () => new Date("2026-07-19T00:00:00.000Z");

function ids() {
  const values = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444"
  ];
  return () => values.shift() ?? "55555555-5555-4555-8555-555555555555";
}

test("creates an active Level 0 / Free workspace with canonical AcUser.id", async () => {
  const repository = new InMemoryDashboardRepository();
  const service = new Level0BootstrapService(repository, fixedDate, ids());
  const result = await service.bootstrap({ userId: "user-canonical", requestId: "req_test" });

  assert.equal(result.created, true);
  assert.equal(result.expert.displayName, "Level 0");
  assert.equal(result.expert.level, 0);
  assert.equal(result.expert.status, "active");
  assert.equal(result.expert.ownerUserId, "user-canonical");
  assert.equal(result.membership.userId, "user-canonical");
  assert.equal(result.membership.status, "active");
  assert.equal(result.membership.tier, "free");
  assert.deepEqual(result.membership.roles, ["expert_admin", "learner"]);
  assert.equal(await repository.getLevel0ExpertIdByUser("user-canonical"), result.expert.id);
  assert.equal(repository.adminGuards.get(result.expert.id), 1);
  assert.equal(repository.audits[0]?.action, "expert:bootstrap_level_0_free");
  assert.equal(repository.audits[0]?.actorUserId, "user-canonical");
});

test("is idempotent and does not create a second Expert on retry", async () => {
  const repository = new InMemoryDashboardRepository();
  const service = new Level0BootstrapService(repository, fixedDate, ids());
  const first = await service.bootstrap({ userId: "user-retry", requestId: "req_first" });
  const second = await service.bootstrap({ userId: "user-retry", requestId: "req_retry" });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.expert.id, first.expert.id);
  assert.equal((await repository.listMembershipsByUser("user-retry")).length, 1);
  assert.equal(repository.audits.length, 1);
});

test("keeps personal Expert data scoped to its canonical user", async () => {
  const repository = new InMemoryDashboardRepository();
  const sharedIds = ids();
  const serviceA = new Level0BootstrapService(repository, fixedDate, sharedIds);
  const serviceB = new Level0BootstrapService(repository, fixedDate, sharedIds);
  const a = await serviceA.bootstrap({ userId: "user-a", requestId: "req_a" });
  const b = await serviceB.bootstrap({ userId: "user-b", requestId: "req_b" });

  assert.notEqual(a.expert.id, b.expert.id);
  assert.deepEqual(await repository.listMembershipsByUser("user-a"), [a.membership]);
  assert.deepEqual(await repository.listMembershipsByUser("user-b"), [b.membership]);
  assert.equal(await repository.getMembership(a.expert.id, "user-b"), null);
  assert.equal(await repository.getMembership(b.expert.id, "user-a"), null);
});

test("resolves DashboardMe with Level 0, Free tier, membership and permissions", async () => {
  const repository = new InMemoryDashboardRepository();
  const service = new Level0BootstrapService(repository, fixedDate, ids());
  await service.bootstrap({ userId: "user-dashboard", requestId: "req_dashboard" });

  const { me } = await resolveDashboardMe({
    user: { id: "user-dashboard", displayName: "Dashboard User" },
    repository
  });
  assert.deepEqual(me.activeExpert.level, 0);
  assert.equal(me.activeExpert.displayName, "Level 0");
  assert.equal(me.memberships.length, 1);
  assert.equal(me.memberships[0]?.tier, "free");
  assert.ok(me.permissions.length > 0);
  assert.ok(me.permissions.includes("expert:manage_members"));
  assert.ok(me.permissions.includes("progress:read_self"));
});

test("uses the strongly consistent Level 0 lock fallback while GSI is propagating", async () => {
  const repository = new InMemoryDashboardRepository();
  const result = await new Level0BootstrapService(repository, fixedDate, ids())
    .bootstrap({ userId: "user-gsi-lag", requestId: "req_gsi_lag" });
  const laggingRepository = {
    getExpert: repository.getExpert.bind(repository),
    getMembership: repository.getMembership.bind(repository),
    listMembershipsByUser: async () => [],
    getLevel0ExpertIdByUser: repository.getLevel0ExpertIdByUser.bind(repository)
  };

  const { me } = await resolveDashboardMe({
    user: { id: "user-gsi-lag", displayName: "GSI Lag" },
    repository: laggingRepository
  });
  assert.equal(me.activeExpert.id, result.expert.id);
  assert.equal(me.memberships[0]?.tier, "free");
});

test("returns an existing active workspace instead of creating Level 0", async () => {
  const repository = new InMemoryDashboardRepository({
    experts: [{
      id: "expert-existing",
      slug: "existing",
      displayName: "Existing",
      status: "active",
      ownerUserId: "user-existing",
      level: 2,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      version: 1
    }],
    memberships: [{
      id: "membership-existing",
      expertId: "expert-existing",
      userId: "user-existing",
      status: "active",
      roles: ["learner"],
      tier: "free",
      joinedAt: "2026-07-18T00:00:00.000Z",
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      version: 1
    }]
  });
  const result = await new Level0BootstrapService(repository, fixedDate, ids())
    .bootstrap({ userId: "user-existing", requestId: "req_existing" });

  assert.equal(result.created, false);
  assert.equal(result.expert.id, "expert-existing");
  assert.equal(await repository.getLevel0ExpertIdByUser("user-existing"), null);
  assert.equal(repository.audits.length, 0);
});
