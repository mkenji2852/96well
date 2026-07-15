import { NextResponse } from "next/server";
import {
  breakpointAuditJson,
  breakpointErrorResponse,
  breakpointJsonError,
  serializeBreakpointSet,
} from "@/lib/breakpoint-api";
import { requireAuthenticatedUser } from "@/lib/auth";
import { BreakpointLifecycleError } from "@/lib/breakpoint-lifecycle";
import { prisma } from "@/lib/prisma";
import { requireBreakpointSetAccess, requirePermission } from "@/lib/rbac";
import { retireBreakpointSetSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:approve");
    const { id } = await params;
    await requireBreakpointSetAccess(actor, id);
    const parsed = retireBreakpointSetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return breakpointJsonError("INVALID_REQUEST", "失効理由を入力してください。", 400, parsed.error.flatten());
    }
    const retired = await prisma.$transaction(async (tx) => {
      const set = await tx.breakpointSet.findFirst({
        where: { id, organizationId: actor.organizationId },
        include: { _count: { select: { rules: true } } },
      });
      if (!set) throw new BreakpointLifecycleError("NOT_FOUND", "対象のBreakpointSetが見つかりません。", 404);
      if (set.status !== "APPROVED") {
        throw new BreakpointLifecycleError("INVALID_BREAKPOINT_TRANSITION", "APPROVEDだけをRETIREDへ移行できます。", 409);
      }
      if (set.revision !== parsed.data.expectedRevision) {
        throw new BreakpointLifecycleError("REVISION_CONFLICT", "他のユーザーが先に更新しました。再読込してください。", 409);
      }
      const retiredAt = new Date();
      const reserved = await tx.breakpointSet.updateMany({
        where: { id, organizationId: actor.organizationId, status: "APPROVED", revision: set.revision },
        data: {
          status: "RETIRED",
          retiredAt,
          retiredByUserId: actor.userId,
          retireReason: parsed.data.reason,
          revision: { increment: 1 },
        },
      });
      if (reserved.count !== 1) {
        throw new BreakpointLifecycleError("REVISION_CONFLICT", "失効処理が他の操作と競合しました。再読込してください。", 409);
      }
      const result = await tx.breakpointSet.findUniqueOrThrow({
        where: { id },
        include: { _count: { select: { rules: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "BREAKPOINT_SET_RETIRED",
          entityType: "BreakpointSet",
          entityId: id,
          beforeJson: breakpointAuditJson({ status: set.status, revision: set.revision }),
          afterJson: breakpointAuditJson({
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            breakpointSetId: id,
            statusBefore: set.status,
            statusAfter: result.status,
            contentHash: result.contentHash,
            reason: parsed.data.reason,
            timestamp: retiredAt.toISOString(),
            sessionId: actor.sessionId,
          }),
        },
      });
      return result;
    });
    return NextResponse.json({
      breakpointSet: serializeBreakpointSet({ ...retired, ruleCount: retired._count.rules }),
    });
  } catch (error) {
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "BreakpointSetの失効に失敗しました。", 500);
  }
}
