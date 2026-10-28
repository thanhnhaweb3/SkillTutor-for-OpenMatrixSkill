import assert from "node:assert/strict";
import test from "node:test";
import { Level0BootstrapService } from "../src/core/level0-bootstrap-service";
import { MembershipMutationError, MembershipService } from "../src/core/membership-service";
import type { ExpertContext, ExpertRole } from "../src/core/types";
import { InMemoryDashboardRepository } from "../src/data/repositories";

function ids() {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

async function fixture() {
  const repository = new InMemoryDashboardRepository();
  const bootstrap = await new Level0BootstrapService(repository, () => new Date("2026-07-19T00:00:00.000Z"), ids())
    .bootstrap({ userId: "owner", requestId: "req_bootstrap" });
  const context: ExpertContext = {
    userId: "owner",
    expertId: bootstrap.expert.id,
    membershipId: bootstrap.membership.id,
    roles: bootstrap.membership.roles,
    permissions: ["expert:manage_members"]
  };
  return { repository, service: new MembershipService(repository), context };
}

async function invite(roles: ExpertRole[] = ["learner"]) {
  const state = await fixture();
  const membership = await state.service.invite({
    context: state.context,
    userId: "member",
    roles,
    requestId: "req_invite"
  });
  return { ...state, membership };
}

test("invites a Free member and writes an audit event", async () => {
  const { repository, membership } = await invite();

  assert.equal(membership.status, "invited");
  assert.equal(membership.tier, "free");
  assert.deepEqual(membership.roles, ["learner"]);
  assert.equal(repository.audits.at(-1)?.action, "membership:invite");
  assert.equal(repository.audits.at(-1)?.targetId, membership.id);
});

test("activates, suspends, reactivates and revokes with expected versions", async () => {
  const { repository, service, context, membership } = await invite();
  const active = await service.changeStatus({ context, userId: "member", status: "active", expectedVersion: membership.version, requestId: "req_active" });
  const suspended = await service.changeStatus({ context, userId: "member", status: "suspended", expectedVersion: active.version, requestId: "req_suspend" });
  const reactivated = await service.changeStatus({ context, userId: "member", status: "active", expectedVersion: suspended.version, requestId: "req_reactivate" });
  const revoked = await service.changeStatus({ context, userId: "member", status: "revoked", expectedVersion: reactivated.version, requestId: "req_revoke" });

  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.version, 5);
  assert.deepEqual(repository.audits.slice(1).map((event) => event.action), [
    "membership:invite", "membership:active", "membership:suspended", "membership:active", "membership:revoked"
  ]);
});

test("rejects invalid status transitions", async () => {
  const { service, context, membership } = await invite();

  await assert.rejects(
    service.changeStatus({ context, userId: "member", status: "suspended", expectedVersion: membership.version, requestId: "req_invalid" }),
    (error: unknown) => error instanceof MembershipMutationError && error.code === "VALIDATION_ERROR"
  );
});

test("rejects stale expected versions", async () => {
  const { service, context } = await invite();

  await assert.rejects(
    service.assignRoles({ context, userId: "member", roles: ["learner"], expectedVersion: 99, requestId: "req_stale" }),
    (error: unknown) => error instanceof MembershipMutationError && error.code === "VERSION_CONFLICT"
  );
});

test("assigns Expert-scoped roles and audits the change", async () => {
  const { repository, service, context, membership } = await invite();
  const updated = await service.assignRoles({
    context,
    userId: "member",
    roles: ["learner", "reviewer", "reviewer"],
    expectedVersion: membership.version,
    requestId: "req_roles"
  });

  assert.deepEqual(updated.roles, ["learner", "reviewer"]);
  assert.equal(updated.version, 2);
  assert.equal(repository.audits.at(-1)?.action, "membership:assign_roles");
});

test("never allows an Expert admin to grant platform_admin", async () => {
  const { service, context, membership } = await invite();

  await assert.rejects(
    service.assignRoles({ context, userId: "member", roles: ["platform_admin"], expectedVersion: membership.version, requestId: "req_platform" }),
    (error: unknown) => error instanceof MembershipMutationError && error.code === "MISSING_PERMISSION"
  );
});

test("prevents removing the final active Expert admin", async () => {
  const { repository, service, context } = await fixture();

  await assert.rejects(
    service.assignRoles({ context, userId: "owner", roles: ["learner"], expectedVersion: 1, requestId: "req_last_admin" }),
    (error: unknown) => error instanceof Error && error.name === "TransactionCanceledException"
  );
  assert.equal(repository.adminGuards.get(context.expertId), 1);
  assert.deepEqual((await repository.getMembership(context.expertId, "owner"))?.roles, ["expert_admin", "learner"]);
});

test("denies membership management without expert:manage_members", async () => {
  const { service, context } = await fixture();
  const learnerContext = { ...context, roles: ["learner"] as ExpertRole[], permissions: ["identity:read_self"] as ExpertContext["permissions"] };

  await assert.rejects(
    service.invite({ context: learnerContext, userId: "member", roles: ["learner"], requestId: "req_denied" }),
    (error: unknown) => error instanceof MembershipMutationError && error.code === "MISSING_PERMISSION"
  );
});

test("cannot mutate a membership from another Expert context", async () => {
  const { service, context } = await fixture();

  await assert.rejects(
    service.changeStatus({ context, userId: "outside-user", status: "revoked", expectedVersion: 1, requestId: "req_cross_expert" }),
    (error: unknown) => error instanceof MembershipMutationError && error.code === "VERSION_CONFLICT"
  );
});
