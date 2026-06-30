import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
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
import { createBreakpointRuleSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  let actor: AuthenticatedActor | null = null;
  let id = "";
  try {
    actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:write");
    ({ id } = await params);
    await requireBreakpointSetAccess(actor, id);
    const parsed = createBreakpointRuleSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return breakpointJsonError("INVALID_REQUEST", "ruleの入力内容を確認してください。", 400, parsed.error.flatten());
    }
    const currentActor = actor;
    const result = await prisma.$transaction(async (tx) => {
      const set = await tx.breakpointSet.findFirst({
        where: { id, organizationId: currentActor.organizationId },
      });
      if (!set) throw new BreakpointLifecycleError("NOT_FOUND", "対象のBreakpointSetが見つかりません。", 404);
      assertDraft(set.status);
      if (set.revision !== parsed.data.expectedRevision) {
        throw new BreakpointLifecycleError("REVISION_CONFLICT", "他のユーザーが先に更新しました。再読込してください。", 409);
      }
      if (
        (parsed.data.organism ?? null) !== (set.organism ?? null) ||
        parsed.data.unit !== set.unit ||
        parsed.data.method !== set.method
      ) {
        throw new BreakpointLifecycleError("BREAKPOINT_RULE_MISMATCH", "ruleのorganism/unit/methodをBreakpointSetと一致させてください。", 400);
      }
      const reserved = await tx.breakpointSet.updateMany({
        where: { id, organizationId: currentActor.organizationId, status: "DRAFT", revision: set.revision },
        data: { revision: { increment: 1 } },
      });
      if (reserved.count !== 1) {
        throw new BreakpointLifecycleError("REVISION_CONFLICT", "他のユーザーが先に更新しました。再読込してください。", 409);
      }
      const rule = await tx.breakpointRule.create({
        data: {
          organizationId: currentActor.organizationId,
          breakpointSetId: id,
          standard: set.standard,
          version: set.version,
          drugName: parsed.data.drugName,
          organism: parsed.data.organism || null,
          susceptibleMax: parsed.data.susceptibleMax,
          resistantMin: parsed.data.resistantMin,
          intermediateMin: parsed.data.intermediateMin ?? null,
          intermediateMax: parsed.data.intermediateMax ?? null,
          unit: parsed.data.unit,
          method: parsed.data.method,
          exceptionJson: parsed.data.exceptionJson === null
            ? Prisma.JsonNull
            : parsed.data.exceptionJson as Prisma.InputJsonValue | undefined,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: currentActor.userId,
          actorLabel: currentActor.userId,
          action: "BREAKPOINT_RULE_CREATED",
          entityType: "BreakpointRule",
          entityId: rule.id,
          afterJson: breakpointAuditJson({
            actorUserId: currentActor.userId,
            organizationId: currentActor.organizationId,
            breakpointSetId: id,
            statusBefore: set.status,
            statusAfter: set.status,
            after: rule,
            timestamp: new Date().toISOString(),
            sessionId: currentActor.sessionId,
          }),
        },
      });
      return { rule, revision: set.revision + 1 };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (actor && error instanceof BreakpointLifecycleError && error.code === "BREAKPOINT_IMMUTABLE") {
      await auditImmutabilityViolation(actor, id, error.message, "BreakpointRule");
    }
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "ruleの作成に失敗しました。", 500);
  }
}
