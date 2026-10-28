import type { ExpertContext, ExpertRole, Permission } from "./types";

const rolePermissions: Record<ExpertRole, readonly Permission[]> = {
  platform_admin: [
    "identity:read_self", "expert:manage_members", "skill:read", "skill:create", "skill:update", "skill:review", "skill:publish",
    "course:read", "course:create", "course:update", "course:approve", "course:publish", "progress:read_self", "progress:update_self",
    "report:read", "report:export", "audit:read"
  ],
  expert_admin: [
    "identity:read_self", "expert:manage_members", "skill:read", "skill:create", "skill:update", "skill:review", "skill:publish",
    "course:read", "course:create", "course:update", "course:approve", "course:publish", "progress:read_self", "progress:update_self",
    "report:read", "report:export", "audit:read"
  ],
  curriculum_manager: [
    "identity:read_self", "skill:read", "skill:create", "skill:update", "course:read", "course:create", "course:update", "report:read"
  ],
  instructor: ["identity:read_self", "skill:read", "skill:update", "course:read", "course:update", "progress:read_self", "report:read"],
  reviewer: ["identity:read_self", "skill:read", "skill:review", "skill:publish", "course:read", "course:approve", "course:publish", "report:read"],
  learner: ["identity:read_self", "skill:read", "course:read", "progress:read_self", "progress:update_self", "report:read"],
  auditor: ["identity:read_self", "skill:read", "course:read", "report:read", "report:export", "audit:read"]
};

export function permissionsForRoles(roles: readonly ExpertRole[]): Permission[] {
  return [...new Set(roles.flatMap((role) => rolePermissions[role] ?? []))].sort();
}

export function authorize(context: ExpertContext, permission: Permission) {
  return context.permissions.includes(permission)
    ? ({ allowed: true } as const)
    : ({ allowed: false, code: "MISSING_PERMISSION" } as const);
}
