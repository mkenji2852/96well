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
import { cloneBreakpointSetSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:write");
    const { id } = await params;
    await requireBreakpointSetAccess(actor, id);
    const parsed = cloneBreakpointSetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return breakpointJsonError("INVALID_REQUEST", "新しいversionを入力してください。", 400, parsed.error.flatten());
    }
    const cloned = await prisma.$transaction(async (tx) => {
      const source = await tx.breakpointSet.findFirst({
        where: { id, organizationId: actor.organizationId },
        include: { rules: true },
      });
      if (!source) throw new BreakpointLifecycleError("NOT_FOUND", "対象のBreakpointSetが見つかりません。", 404);
      const duplicate = await tx.breakpointSet.findFirst({
        where: {
          organizationId: actor.organizationId,
          standard: source.standard,
          version: parsed.data.version,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BreakpointLifecycleError("BREAKPOINT_VERSION_EXISTS", "同じstandard/versionが既に存在します。", 409);
      }
      const created = await tx.breakpointSet.create({
        data: {
          organizationId: actor.organizationId,
          createdByUserId: actor.userId,
          standard: source.standard,
          version: parsed.data.version,
          organism: source.organism,
          unit: source.unit,
          method: source.method,
          status: "DRAFT",
          effectiveFrom: source.effectiveFrom,
          effectiveTo: source.effectiveTo,
          sourceDocumentReference: source.sourceDocumentReference,
          sourceDocumentChecksum: source.sourceDocumentChecksum,
          supersedesBreakpointSetId: source.id,
          rules: {
            create: source.rules.map((rule) => ({
              organizationId: actor.organizationId,
              drugName: rule.drugName,
              organism: rule.organism,
              standard: source.standard,
              version: parsed.data.version,
              susceptibleMax: rule.susceptibleMax,
              resistantMin: rule.resistantMin,
              intermediateMin: rule.intermediateMin,
              intermediateMax: rule.intermediateMax,
              unit: rule.unit,
              method: rule.method,
              exceptionJson: rule.exceptionJson ?? undefined,
            })),
          },
        },
        include: { rules: true, _count: { select: { rules: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "BREAKPOINT_SET_CLONED",
          entityType: "BreakpointSet",
          entityId: created.id,
          beforeJson: breakpointAuditJson({
            breakpointSetId: source.id,
            status: source.status,
            version: source.version,
            contentHash: source.contentHash,
          }),
          afterJson: breakpointAuditJson({
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            breakpointSetId: created.id,
            statusBefore: source.status,
            statusAfter: created.status,
            previousVersion: source.version,
            newVersion: created.version,
            supersedesBreakpointSetId: source.id,
            timestamp: new Date().toISOString(),
            sessionId: actor.sessionId,
          }),
        },
      });
      return created;
    });
    return NextResponse.json({
      breakpointSet: serializeBreakpointSet({ ...cloned, ruleCount: cloned._count.rules }),
    }, { status: 201 });
  } catch (error) {
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "BreakpointSetのcloneに失敗しました。", 500);
  }
}
