import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import type { AuthenticatedActor } from "@/lib/auth";
import { BreakpointLifecycleError } from "@/lib/breakpoint-lifecycle";
import { prisma } from "@/lib/prisma";

export function breakpointJsonError(code: string, message: string, status: number, details?: unknown): NextResponse {
  return NextResponse.json(
    details === undefined ? { error: { code, message } } : { error: { code, message }, details },
    { status },
  );
}

export function breakpointErrorResponse(error: unknown): NextResponse | null {
  const auth = authErrorResponse(error);
  if (auth) return auth;
  if (error instanceof BreakpointLifecycleError) {
    return breakpointJsonError(error.code, error.message, error.status);
  }
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
    return breakpointJsonError("BREAKPOINT_CONFLICT", "同じ版またはruleが既に存在します。", 409);
  }
  return null;
}

export function breakpointAuditJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function auditBreakpoint(
  actor: AuthenticatedActor,
  action: string,
  breakpointSetId: string,
  values: {
    before?: unknown;
    after?: Record<string, unknown>;
    entityType?: "BreakpointSet" | "BreakpointRule";
    entityId?: string;
  } = {},
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: actor.userId,
      actorLabel: actor.userId,
      action,
      entityType: values.entityType ?? "BreakpointSet",
      entityId: values.entityId ?? breakpointSetId,
      beforeJson: values.before == null ? undefined : breakpointAuditJson(values.before),
      afterJson: breakpointAuditJson({
        actorUserId: actor.userId,
        organizationId: actor.organizationId,
        breakpointSetId,
        timestamp: new Date().toISOString(),
        sessionId: actor.sessionId,
        ...values.after,
      }),
    },
  });
}

export async function auditImmutabilityViolation(
  actor: AuthenticatedActor,
  breakpointSetId: string,
  reason: string,
  entityType: "BreakpointSet" | "BreakpointRule" = "BreakpointSet",
  entityId = breakpointSetId,
): Promise<void> {
  await auditBreakpoint(actor, "BREAKPOINT_IMMUTABILITY_VIOLATION", breakpointSetId, {
    entityType,
    entityId,
    after: { reason },
  }).catch(() => undefined);
}

export function serializeBreakpointSet(set: Record<string, unknown> & {
  createdAt?: Date;
  updatedAt?: Date;
  approvedAt?: Date | null;
  retiredAt?: Date | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
}) {
  const date = (value: Date | null | undefined) => value?.toISOString() ?? null;
  return {
    ...set,
    createdAt: date(set.createdAt),
    updatedAt: date(set.updatedAt),
    approvedAt: date(set.approvedAt),
    retiredAt: date(set.retiredAt),
    effectiveFrom: date(set.effectiveFrom),
    effectiveTo: date(set.effectiveTo),
  };
}
