import { AuthError } from "@/lib/api-auth-error";
import type { AuthenticatedActor } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@/types/domain";

const permissions = {
  TECHNICIAN: [
    "sample:read", "sample:create", "sample:delete", "plate:read", "plate:write",
    "export:anonymized", "breakpoint:read", "breakpoint:write",
  ],
  REVIEWER: [
    "sample:read", "plate:read", "plate:review",
    "export:anonymized", "export:clinical", "breakpoint:read", "breakpoint:write",
  ],
  ADMIN: [
    "sample:read", "sample:create", "sample:delete", "plate:read", "plate:write", "plate:review",
    "export:anonymized", "export:clinical", "export:audit", "export:notes",
    "breakpoint:read", "breakpoint:write", "breakpoint:approve", "user:manage",
  ],
  AUDITOR: [
    "sample:read", "plate:read",
    "export:anonymized", "export:clinical", "export:audit", "export:notes",
    "breakpoint:read",
  ],
} as const satisfies Record<UserRole, readonly string[]>;

export type Permission = (typeof permissions)[UserRole][number];

export function requirePermission(actor: AuthenticatedActor, permission: Permission): void {
  if (!(permissions[actor.role] as readonly string[]).includes(permission)) {
    throw new AuthError("FORBIDDEN", "この操作を実行する権限がありません。");
  }
}

export interface OrganizationAccessStore {
  sample: {
    findFirst(args: { where: { id: string; organizationId: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  plate: {
    findFirst(args: { where: { id: string; organizationId: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  breakpointSet?: {
    findFirst(args: { where: { id: string; organizationId: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
}

export async function requireSampleAccess(
  actor: AuthenticatedActor,
  sampleId: string,
  store: OrganizationAccessStore = prisma,
): Promise<void> {
  const sample = await store.sample.findFirst({
    where: { id: sampleId, organizationId: actor.organizationId },
    select: { id: true },
  });
  if (!sample) throw new AuthError("NOT_FOUND", "対象のサンプルが見つかりません。");
}

export async function requirePlateAccess(
  actor: AuthenticatedActor,
  plateId: string,
  store: OrganizationAccessStore = prisma,
): Promise<void> {
  const plate = await store.plate.findFirst({
    where: { id: plateId, organizationId: actor.organizationId },
    select: { id: true },
  });
  if (!plate) throw new AuthError("NOT_FOUND", "対象のプレートが見つかりません。");
}

export async function requireBreakpointSetAccess(
  actor: AuthenticatedActor,
  breakpointSetId: string,
  store: OrganizationAccessStore = prisma,
): Promise<void> {
  if (!store.breakpointSet) throw new AuthError("NOT_FOUND", "対象のBreakpointSetが見つかりません。");
  const breakpointSet = await store.breakpointSet.findFirst({
    where: { id: breakpointSetId, organizationId: actor.organizationId },
    select: { id: true },
  });
  if (!breakpointSet) throw new AuthError("NOT_FOUND", "対象のBreakpointSetが見つかりません。");
}
