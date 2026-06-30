import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  auditImmutabilityViolation,
  breakpointAuditJson,
  breakpointErrorResponse,
  breakpointJsonError,
  serializeBreakpointSet,
} from "@/lib/breakpoint-api";
import { requireAuthenticatedUser, type AuthenticatedActor } from "@/lib/auth";
import { assertDraft, BreakpointLifecycleError } from "@/lib/breakpoint-lifecycle";
import { prisma } from "@/lib/prisma";
import { requireBreakpointSetAccess, requirePermission } from "@/lib/rbac";
import { updateBreakpointSetSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

const detailInclude = {
  rules: { orderBy: [{ drugName: "asc" as const }, { organism: "asc" as const }] },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  retiredBy: { select: { id: true, name: true } },
  _count: { select: { rules: true, rawMics: true, interpretations: true } },
  supersedes: {
    include: {
      rules: { orderBy: [{ drugName: "asc" as const }, { organism: "asc" as const }] },
      _count: { select: { rules: true } },
    },
  },
} satisfies Prisma.BreakpointSetInclude;

async function recordViolation(actor: AuthenticatedActor | null, id: string, error: unknown) {
  if (actor && error instanceof BreakpointLifecycleError && error.code === "BREAKPOINT_IMMUTABLE") {
    await auditImmutabilityViolation(actor, id, error.message);
  }
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:read");
    const { id } = await params;
    await requireBreakpointSetAccess(actor, id);
    const set = await prisma.breakpointSet.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: detailInclude,
    });
    if (!set) return breakpointJsonError("NOT_FOUND", "対象のBreakpointSetが見つかりません。", 404);
    return NextResponse.json({
      breakpointSet: serializeBreakpointSet({ ...set, ruleCount: set._count.rules }),
    });
  } catch (error) {
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "BreakpointSetの取得に失敗しました。", 500);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  let actor: AuthenticatedActor | null = null;
  let id = "";
  try {
    actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:write");
    ({ id } = await params);
    await requireBreakpointSetAccess(actor, id);
    const parsed = updateBreakpointSetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return breakpointJsonError("INVALID_REQUEST", "入力内容を確認してください。", 400, parsed.error.flatten());
    }
    const currentActor = actor;
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.breakpointSet.findFirst({
        where: { id, organizationId: currentActor.organizationId },
        include: { rules: true },
      });
      if (!current) throw new BreakpointLifecycleError("NOT_FOUND", "対象のBreakpointSetが見つかりません。", 404);
      assertDraft(current.status);
      if (current.revision !== parsed.data.expectedRevision) {
        throw new BreakpointLifecycleError("REVISION_CONFLICT", "他のユーザーが先に更新しました。再読込してください。", 409);
      }

      const nextStandard = parsed.data.standard ?? current.standard;
      const nextVersion = parsed.data.version ?? current.version;
      const duplicate = await tx.breakpointSet.findFirst({
        where: {
          id: { not: id },
          organizationId: currentActor.organizationId,
          standard: nextStandard,
          version: nextVersion,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BreakpointLifecycleError("BREAKPOINT_VERSION_EXISTS", "同じstandard/versionが既に存在します。", 409);
      }

      const setData = {
        standard: nextStandard,
        version: nextVersion,
        organism: parsed.data.organism === undefined ? current.organism : parsed.data.organism || null,
        unit: parsed.data.unit ?? current.unit,
        method: parsed.data.method ?? current.method,
        effectiveFrom: parsed.data.effectiveFrom === undefined
          ? current.effectiveFrom
          : parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
        effectiveTo: parsed.data.effectiveTo === undefined
          ? current.effectiveTo
          : parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
        sourceDocumentReference: parsed.data.sourceDocumentReference === undefined
          ? current.sourceDocumentReference
          : parsed.data.sourceDocumentReference || null,
        sourceDocumentChecksum: parsed.data.sourceDocumentChecksum === undefined
          ? current.sourceDocumentChecksum
          : parsed.data.sourceDocumentChecksum || null,
      };
      const reserved = await tx.breakpointSet.updateMany({
        where: { id, organizationId: currentActor.organizationId, status: "DRAFT", revision: current.revision },
        data: { ...setData, revision: { increment: 1 } },
      });
      if (reserved.count !== 1) {
        throw new BreakpointLifecycleError("REVISION_CONFLICT", "他のユーザーが先に更新しました。再読込してください。", 409);
      }
      await tx.breakpointRule.updateMany({
        where: { breakpointSetId: id },
        data: {
          standard: setData.standard,
          version: setData.version,
          organism: setData.organism,
          unit: setData.unit,
          method: setData.method,
        },
      });
      const result = await tx.breakpointSet.findUniqueOrThrow({ where: { id }, include: detailInclude });
      await tx.auditLog.create({
        data: {
          actorId: currentActor.userId,
          actorLabel: currentActor.userId,
          action: "BREAKPOINT_SET_UPDATED",
          entityType: "BreakpointSet",
          entityId: id,
          beforeJson: breakpointAuditJson({
            status: current.status,
            revision: current.revision,
            standard: current.standard,
            version: current.version,
            organism: current.organism,
            unit: current.unit,
            method: current.method,
            effectiveFrom: current.effectiveFrom,
            effectiveTo: current.effectiveTo,
          }),
          afterJson: breakpointAuditJson({
            actorUserId: currentActor.userId,
            organizationId: currentActor.organizationId,
            breakpointSetId: id,
            statusBefore: current.status,
            statusAfter: result.status,
            previousVersion: current.version,
            newVersion: result.version,
            revision: result.revision,
            after: setData,
            timestamp: new Date().toISOString(),
            sessionId: currentActor.sessionId,
          }),
        },
      });
      return result;
    });
    return NextResponse.json({ breakpointSet: serializeBreakpointSet({ ...updated, ruleCount: updated._count.rules }) });
  } catch (error) {
    await recordViolation(actor, id, error);
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "BreakpointSetの更新に失敗しました。", 500);
  }
}
