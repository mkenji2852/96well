import { NextResponse } from "next/server";
import { breakpointErrorResponse, breakpointJsonError } from "@/lib/breakpoint-api";
import { requireAuthenticatedUser } from "@/lib/auth";
import { BreakpointLifecycleError } from "@/lib/breakpoint-lifecycle";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { createBreakpointSchema } from "@/lib/validation";

/**
 * Deprecated compatibility endpoint.
 * It creates a DRAFT set and one rule, but never approves it.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "breakpoint:write");
    const parsed = createBreakpointSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return breakpointJsonError("INVALID_REQUEST", "入力内容を確認してください。", 400, parsed.error.flatten());
    }
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.breakpointSet.findFirst({
        where: {
          organizationId: actor.organizationId,
          standard: parsed.data.standard,
          version: parsed.data.version,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new BreakpointLifecycleError("BREAKPOINT_VERSION_EXISTS", "同じstandard/versionが既に存在します。", 409);
      }
      const breakpointSet = await tx.breakpointSet.create({
        data: {
          organizationId: actor.organizationId,
          createdByUserId: actor.userId,
          standard: parsed.data.standard,
          version: parsed.data.version,
          organism: parsed.data.organism || null,
          unit: parsed.data.unit,
          method: "BROTH_MICRODILUTION",
          status: "DRAFT",
        },
      });
      const breakpoint = await tx.breakpointRule.create({
        data: {
          organizationId: actor.organizationId,
          breakpointSetId: breakpointSet.id,
          drugName: parsed.data.drugName,
          organism: parsed.data.organism || null,
          standard: parsed.data.standard,
          version: parsed.data.version,
          susceptibleMax: parsed.data.susceptibleMax,
          resistantMin: parsed.data.resistantMin,
          unit: parsed.data.unit,
          method: "BROTH_MICRODILUTION",
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "BREAKPOINT_SET_CREATED",
          entityType: "BreakpointSet",
          entityId: breakpointSet.id,
          afterJson: {
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            breakpointSetId: breakpointSet.id,
            statusAfter: "DRAFT",
            newVersion: breakpointSet.version,
            deprecatedEndpoint: true,
            timestamp: new Date().toISOString(),
            sessionId: actor.sessionId,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "BREAKPOINT_RULE_CREATED",
          entityType: "BreakpointRule",
          entityId: breakpoint.id,
          afterJson: {
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            breakpointSetId: breakpointSet.id,
            after: breakpoint,
            timestamp: new Date().toISOString(),
            sessionId: actor.sessionId,
          },
        },
      });
      return { breakpointSet, breakpoint };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const response = breakpointErrorResponse(error);
    if (response) return response;
    console.error(error);
    return breakpointJsonError("INTERNAL_ERROR", "Breakpointの作成に失敗しました。", 500);
  }
}
