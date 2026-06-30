import { NextResponse } from "next/server";
import {
  breakpointAuditJson,
  breakpointErrorResponse,
  breakpointJsonError,
  serializeBreakpointSet,
} from "@/lib/breakpoint-api";
import { requireAuthenticatedUser } from "@/lib/auth";
import {
  BreakpointLifecycleError,
  BREAKPOINT_CONTENT_HASH_ALGORITHM,
  BREAKPOINT_CONTENT_HASH_VERSION,
  calculateBreakpointContentHash,
  validateBreakpointSetForApproval,
} from "@/lib/breakpoint-lifecycle";
import { prisma } from "@/lib/prisma";
import { requireBreakpointSetAccess, requirePermission } from "@/lib/rbac";
import { approveBreakpointSetSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:write");
    const { id } = await params;
    await requireBreakpointSetAccess(actor, id);
    const parsed = approveBreakpointSetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return breakpointJsonError("INVALID_REQUEST", "承認入力を確認してください。", 400, parsed.error.flatten());
    }
    const approved = await prisma.$transaction(async (tx) => {
      const set = await tx.breakpointSet.findFirst({
        where: { id, organizationId: actor.organizationId },
        include: { rules: true },
      });
      if (!set) throw new BreakpointLifecycleError("NOT_FOUND", "対象のBreakpointSetが見つかりません。", 404);
      if (set.status !== "DRAFT") {
        throw new BreakpointLifecycleError("INVALID_BREAKPOINT_TRANSITION", "DRAFTだけを承認できます。", 409);
      }
      if (set.revision !== parsed.data.expectedRevision) {
        throw new BreakpointLifecycleError("REVISION_CONFLICT", "他のユーザーが先に更新しました。再読込してください。", 409);
      }
      const duplicateVersion = await tx.breakpointSet.findFirst({
        where: {
          id: { not: id },
          organizationId: actor.organizationId,
          standard: set.standard,
          version: set.version,
        },
        select: { id: true },
      });
      if (duplicateVersion) {
        throw new BreakpointLifecycleError("BREAKPOINT_VERSION_EXISTS", "同じorganization/standard/versionが既に存在します。", 409);
      }
      const hashable = {
        ...set,
        sourceDocumentReference: set.sourceDocumentReference,
        sourceDocumentChecksum: set.sourceDocumentChecksum,
        rules: set.rules.map((rule) => ({
          ...rule,
          exceptionJson: rule.exceptionJson,
        })),
      };
      const validationErrors = validateBreakpointSetForApproval(hashable);
      if (validationErrors.length > 0) {
        throw new BreakpointLifecycleError("BREAKPOINT_VALIDATION_FAILED", validationErrors.join(" "), 400);
      }
      const contentHash = calculateBreakpointContentHash(hashable);
      const identical = await tx.breakpointSet.findFirst({
        where: {
          id: { not: id },
          organizationId: actor.organizationId,
          status: "APPROVED",
          contentHash,
        },
        select: { id: true, version: true },
      });
      if (identical) {
        throw new BreakpointLifecycleError(
          "DUPLICATE_APPROVED_BREAKPOINT_CONTENT",
          `同一内容の承認済みセット（version ${identical.version}）が存在します。`,
          409,
        );
      }
      const approvedAt = new Date();
      const reserved = await tx.breakpointSet.updateMany({
        where: {
          id,
          organizationId: actor.organizationId,
          status: "DRAFT",
          revision: set.revision,
        },
        data: {
          status: "APPROVED",
          contentHash,
          contentHashAlgorithm: BREAKPOINT_CONTENT_HASH_ALGORITHM,
          contentHashVersion: BREAKPOINT_CONTENT_HASH_VERSION,
          approvedAt,
          approvedByUserId: actor.userId,
          approvalComment: parsed.data.approvalComment || null,
          revision: { increment: 1 },
        },
      });
      if (reserved.count !== 1) {
        throw new BreakpointLifecycleError("REVISION_CONFLICT", "承認と同時編集が競合しました。再読込してください。", 409);
      }
      const result = await tx.breakpointSet.findUniqueOrThrow({
        where: { id },
        include: { rules: true, _count: { select: { rules: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "BREAKPOINT_SET_APPROVED",
          entityType: "BreakpointSet",
          entityId: id,
          beforeJson: breakpointAuditJson({
            status: set.status,
            revision: set.revision,
            contentHash: set.contentHash,
          }),
          afterJson: breakpointAuditJson({
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            breakpointSetId: id,
            statusBefore: set.status,
            statusAfter: result.status,
            contentHash,
            contentHashAlgorithm: BREAKPOINT_CONTENT_HASH_ALGORITHM,
            contentHashVersion: BREAKPOINT_CONTENT_HASH_VERSION,
            previousVersion: set.version,
            newVersion: result.version,
            reason: parsed.data.approvalComment || null,
            timestamp: approvedAt.toISOString(),
            sessionId: actor.sessionId,
          }),
        },
      });
      return result;
    });
    return NextResponse.json({
      breakpointSet: serializeBreakpointSet({ ...approved, ruleCount: approved._count.rules }),
    });
  } catch (error) {
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "BreakpointSetの承認に失敗しました。", 500);
  }
}
