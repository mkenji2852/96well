import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { breakpointErrorResponse, breakpointJsonError, serializeBreakpointSet } from "@/lib/breakpoint-api";
import { requireAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { createBreakpointSetSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:read");
    const url = new URL(request.url);
    const selectable = url.searchParams.get("selectable") === "true";
    const status = url.searchParams.get("status");
    const organism = url.searchParams.get("organism")?.trim() || null;
    const now = new Date();
    const where: Prisma.BreakpointSetWhereInput = { organizationId: actor.organizationId };
    if (selectable) {
      where.status = "APPROVED";
      where.AND = [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
        ...(organism ? [{ OR: [{ organism }, { organism: null }] }] : []),
      ];
    } else if (status === "DRAFT" || status === "APPROVED" || status === "RETIRED") {
      where.status = status;
    }

    const sets = await prisma.breakpointSet.findMany({
      where,
      orderBy: [{ standard: "asc" }, { version: "desc" }, { createdAt: "desc" }],
      include: {
        _count: { select: { rules: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      take: selectable ? 100 : 250,
    });
    return NextResponse.json({
      breakpointSets: sets.map((set) => serializeBreakpointSet({
        ...set,
        ruleCount: set._count.rules,
        _count: undefined,
      })),
    });
  } catch (error) {
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "BreakpointSet一覧の取得に失敗しました。", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:write");
    const parsed = createBreakpointSetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return breakpointJsonError("INVALID_REQUEST", "入力内容を確認してください。", 400, parsed.error.flatten());
    }
    const duplicate = await prisma.breakpointSet.findFirst({
      where: {
        organizationId: actor.organizationId,
        standard: parsed.data.standard,
        version: parsed.data.version,
      },
      select: { id: true },
    });
    if (duplicate) return breakpointJsonError("BREAKPOINT_VERSION_EXISTS", "同じstandard/versionが既に存在します。", 409);

    const breakpointSet = await prisma.$transaction(async (tx) => {
      const created = await tx.breakpointSet.create({
        data: {
          organizationId: actor.organizationId,
          createdByUserId: actor.userId,
          standard: parsed.data.standard,
          version: parsed.data.version,
          organism: parsed.data.organism || null,
          unit: parsed.data.unit,
          method: parsed.data.method,
          effectiveFrom: parsed.data.effectiveFrom ? new Date(parsed.data.effectiveFrom) : null,
          effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null,
          sourceDocumentReference: parsed.data.sourceDocumentReference || null,
          sourceDocumentChecksum: parsed.data.sourceDocumentChecksum || null,
          status: "DRAFT",
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "BREAKPOINT_SET_CREATED",
          entityType: "BreakpointSet",
          entityId: created.id,
          afterJson: {
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            breakpointSetId: created.id,
            statusAfter: created.status,
            newVersion: created.version,
            after: {
              standard: created.standard,
              version: created.version,
              organism: created.organism,
              unit: created.unit,
              method: created.method,
            },
            timestamp: new Date().toISOString(),
            sessionId: actor.sessionId,
          },
        },
      });
      return created;
    });
    return NextResponse.json({ breakpointSet: serializeBreakpointSet({ ...breakpointSet, ruleCount: 0 }) }, { status: 201 });
  } catch (error) {
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "BreakpointSetの作成に失敗しました。", 500);
  }
}
