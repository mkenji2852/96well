import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  auditImmutabilityViolation,
  breakpointAuditJson,
  breakpointErrorResponse,
  breakpointJsonError,
} from "@/lib/breakpoint-api";
import { requireAuthenticatedUser, type AuthenticatedActor } from "@/lib/auth";
import { assertDraft, BreakpointLifecycleError } from "@/lib/breakpoint-lifecycle";
import { prisma } from "@/lib/prisma";
import { requireBreakpointSetAccess, requirePermission } from "@/lib/rbac";
import { updateBreakpointRuleSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string; ruleId: string }> };
const deleteSchema = z.object({ expectedRevision: z.number().int().min(0) }).strict();

async function mutableContext(
  actor: AuthenticatedActor,
  id: string,
  ruleId: string,
  expectedRevision: number,
) {
  const set = await prisma.breakpointSet.findFirst({
    where: { id, organizationId: actor.organizationId },
  });
  if (!set) throw new BreakpointLifecycleError("NOT_FOUND", "対象のBreakpointSetが見つかりません。", 404);
  assertDraft(set.status);
  if (set.revision !== expectedRevision) {
    throw new BreakpointLifecycleError("REVISION_CONFLICT", "他のユーザーが先に更新しました。再読込してください。", 409);
  }
  const rule = await prisma.breakpointRule.findFirst({
    where: { id: ruleId, breakpointSetId: id, organizationId: actor.organizationId },
  });
  if (!rule) throw new BreakpointLifecycleError("NOT_FOUND", "対象のruleが見つかりません。", 404);
  return { set, rule };
}

export async function PATCH(request: Request, { params }: RouteContext) {
  let actor: AuthenticatedActor | null = null;
  let id = "";
  let ruleId = "";
  try {
    actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:write");
    ({ id, ruleId } = await params);
    await requireBreakpointSetAccess(actor, id);
    const parsed = updateBreakpointRuleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return breakpointJsonError("INVALID_REQUEST", "ruleの入力内容を確認してください。", 400, parsed.error.flatten());
    }
    const currentActor = actor;
    const { set, rule } = await mutableContext(currentActor, id, ruleId, parsed.data.expectedRevision);
    const next = {
      drugName: parsed.data.drugName ?? rule.drugName,
      organism: parsed.data.organism === undefined ? rule.organism : parsed.data.organism || null,
      susceptibleMax: parsed.data.susceptibleMax ?? rule.susceptibleMax,
      resistantMin: parsed.data.resistantMin ?? rule.resistantMin,
      intermediateMin: parsed.data.intermediateMin === undefined ? rule.intermediateMin : parsed.data.intermediateMin,
      intermediateMax: parsed.data.intermediateMax === undefined ? rule.intermediateMax : parsed.data.intermediateMax,
      unit: parsed.data.unit ?? rule.unit,
      method: parsed.data.method ?? rule.method,
    };
    if ((next.organism ?? null) !== (set.organism ?? null) || next.unit !== set.unit || next.method !== set.method) {
      throw new BreakpointLifecycleError("BREAKPOINT_RULE_MISMATCH", "ruleのorganism/unit/methodをBreakpointSetと一致させてください。", 400);
    }
    if (next.susceptibleMax >= next.resistantMin) {
      throw new BreakpointLifecycleError("BREAKPOINT_BOUNDARY_INVALID", "S/R境界値が矛盾しています。", 400);
    }
    if (next.intermediateMin != null && next.intermediateMin <= next.susceptibleMax) {
      throw new BreakpointLifecycleError("BREAKPOINT_BOUNDARY_INVALID", "intermediateMinはS境界より大きくしてください。", 400);
    }
    if (next.intermediateMax != null && next.intermediateMax >= next.resistantMin) {
      throw new BreakpointLifecycleError("BREAKPOINT_BOUNDARY_INVALID", "intermediateMaxはR境界より小さくしてください。", 400);
    }
    if (next.intermediateMin != null && next.intermediateMax != null && next.intermediateMin > next.intermediateMax) {
      throw new BreakpointLifecycleError("BREAKPOINT_BOUNDARY_INVALID", "intermediate境界が逆転しています。", 400);
    }
    const result = await prisma.$transaction(async (tx) => {
      const reserved = await tx.breakpointSet.updateMany({
        where: { id, organizationId: currentActor.organizationId, status: "DRAFT", revision: set.revision },
        data: { revision: { increment: 1 } },
      });
      if (reserved.count !== 1) throw new BreakpointLifecycleError("REVISION_CONFLICT", "他のユーザーが先に更新しました。再読込してください。", 409);
      const updateData: Prisma.BreakpointRuleUpdateInput = { ...next };
      if (parsed.data.exceptionJson !== undefined) {
        updateData.exceptionJson = parsed.data.exceptionJson === null
          ? Prisma.JsonNull
          : parsed.data.exceptionJson as Prisma.InputJsonValue;
      }
      const updated = await tx.breakpointRule.update({ where: { id: ruleId }, data: updateData });
      await tx.auditLog.create({
        data: {
          actorId: currentActor.userId,
          actorLabel: currentActor.userId,
          action: "BREAKPOINT_RULE_UPDATED",
          entityType: "BreakpointRule",
          entityId: ruleId,
          beforeJson: breakpointAuditJson(rule),
          afterJson: breakpointAuditJson({
            actorUserId: currentActor.userId,
            organizationId: currentActor.organizationId,
            breakpointSetId: id,
            before: rule,
            after: updated,
            timestamp: new Date().toISOString(),
            sessionId: currentActor.sessionId,
          }),
        },
      });
      return { rule: updated, revision: set.revision + 1 };
    });
    return NextResponse.json(result);
  } catch (error) {
    if (actor && error instanceof BreakpointLifecycleError && error.code === "BREAKPOINT_IMMUTABLE") {
      await auditImmutabilityViolation(actor, id, error.message, "BreakpointRule", ruleId || id);
    }
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "ruleの更新に失敗しました。", 500);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  let actor: AuthenticatedActor | null = null;
  let id = "";
  let ruleId = "";
  try {
    actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:write");
    ({ id, ruleId } = await params);
    await requireBreakpointSetAccess(actor, id);
    const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return breakpointJsonError("INVALID_REQUEST", "expectedRevisionが必要です。", 400, parsed.error.flatten());
    const currentActor = actor;
    const { set, rule } = await mutableContext(currentActor, id, ruleId, parsed.data.expectedRevision);
    const result = await prisma.$transaction(async (tx) => {
      const reserved = await tx.breakpointSet.updateMany({
        where: { id, organizationId: currentActor.organizationId, status: "DRAFT", revision: set.revision },
        data: { revision: { increment: 1 } },
      });
      if (reserved.count !== 1) throw new BreakpointLifecycleError("REVISION_CONFLICT", "他のユーザーが先に更新しました。再読込してください。", 409);
      await tx.breakpointRule.delete({ where: { id: ruleId } });
      await tx.auditLog.create({
        data: {
          actorId: currentActor.userId,
          actorLabel: currentActor.userId,
          action: "BREAKPOINT_RULE_DELETED",
          entityType: "BreakpointRule",
          entityId: ruleId,
          beforeJson: breakpointAuditJson(rule),
          afterJson: breakpointAuditJson({
            actorUserId: currentActor.userId,
            organizationId: currentActor.organizationId,
            breakpointSetId: id,
            before: rule,
            timestamp: new Date().toISOString(),
            sessionId: currentActor.sessionId,
          }),
        },
      });
      return { deletedRuleId: ruleId, revision: set.revision + 1 };
    });
    return NextResponse.json(result);
  } catch (error) {
    if (actor && error instanceof BreakpointLifecycleError && error.code === "BREAKPOINT_IMMUTABLE") {
      await auditImmutabilityViolation(actor, id, error.message, "BreakpointRule", ruleId || id);
    }
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "ruleの削除に失敗しました。", 500);
  }
}
