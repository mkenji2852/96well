import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser, type AuthenticatedActor } from "@/lib/auth";
import { recalculatePlateResults, ResultCalculationError } from "@/lib/plate-results";
import { prisma } from "@/lib/prisma";
import { requirePermission, requirePlateAccess } from "@/lib/rbac";
import { savePlateSchema } from "@/lib/validation";
import type { RawMicOperator } from "@/types/domain";

type RouteContext = { params: Promise<{ id: string }> };

type SavePlateResponse = {
  plateId: string;
  status: string;
  wellRevision: number;
  results: unknown[];
};

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function resultCalculationResponse(error: ResultCalculationError): NextResponse {
  const status = error.code === "RESULT_RECALCULATION_CONFLICT" ? 409 : 400;
  return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
}

function parseExpectedRevision(request: Request, bodyRevision?: number): number | null {
  if (bodyRevision !== undefined) return bodyRevision;
  const header = request.headers.get("if-match");
  if (!header) return null;
  const normalized = header.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeIdempotencyKey(request: Request, bodyKey?: string): string | null {
  const key = bodyKey ?? request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key");
  const trimmed = key?.trim();
  return trimmed && trimmed.length >= 8 ? trimmed : null;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function recordResultCalculationFailure(
  actor: AuthenticatedActor | null,
  plateId: string | null,
  error: ResultCalculationError,
): Promise<void> {
  if (!actor || !plateId) return;
  await prisma.auditLog.create({
    data: {
      actorId: actor.userId,
      actorLabel: actor.userId,
      action: error.code === "RESULT_RECALCULATION_CONFLICT"
        ? "RESULT_RECALCULATION_CONFLICT"
        : error.code === "BREAKPOINT_HASH_MISMATCH"
          ? "BREAKPOINT_HASH_MISMATCH"
          : "RESULT_RECALCULATION_FAILED",
      entityType: "Plate",
      entityId: plateId,
      afterJson: inputJson({
        actorUserId: actor.userId,
        organizationId: actor.organizationId,
        plateId,
        errorCode: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
        sessionId: actor.sessionId,
      }),
    },
  }).catch(() => undefined);
}

async function latestPlateActor(plateId: string): Promise<string | null> {
  const latest = await prisma.auditLog.findFirst({
    where: { entityType: "Plate", entityId: plateId },
    orderBy: { createdAt: "desc" },
    select: { actorId: true, actorLabel: true },
  });
  return latest?.actorId ?? latest?.actorLabel ?? null;
}

function revisionConflictResponse({
  plate,
  clientBaseRevision,
  serverUpdatedBy,
}: {
  plate: {
    id: string;
    wellRevision: number;
    updatedAt: Date;
    wells: Array<{ rowIndex: number; columnIndex: number; state: string }>;
  };
  clientBaseRevision: number;
  serverUpdatedBy: string | null;
}): NextResponse {
  return NextResponse.json({
    error: {
      code: "REVISION_CONFLICT",
      message: "別の端末またはユーザーによって更新されています。サーバー最新版を確認してから解決してください。",
    },
    conflict: {
      plateId: plate.id,
      clientBaseRevision,
      serverRevision: plate.wellRevision,
      serverWellRevision: plate.wellRevision,
      serverUpdatedAt: plate.updatedAt.toISOString(),
      serverUpdatedBy,
      serverWells: plate.wells.map((well) => ({
        rowIndex: well.rowIndex,
        columnIndex: well.columnIndex,
        state: well.state,
      })),
    },
  }, { status: 409 });
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "plate:read");
    const { id } = await params;
    await requirePlateAccess(actor, id);
    const plate = await prisma.plate.findFirst({
      where: { id, organizationId: actor.organizationId },
      include: {
        sample: true,
        drugs: { orderBy: { rowIndex: "asc" } },
        wells: { orderBy: [{ rowIndex: "asc" }, { columnIndex: "asc" }] },
        rawMics: {
          where: { status: "CURRENT" },
          orderBy: { calculatedAt: "desc" },
          include: { plateDrug: true, interpretations: { where: { status: "CURRENT" }, orderBy: { interpretedAt: "desc" }, take: 1 } },
        },
      },
    });
    if (!plate) return jsonError("NOT_FOUND", "対象のプレートが見つかりません。", 404);

    const selectedBreakpointSet = plate.lastBreakpointSetId
      ? await prisma.breakpointSet.findFirst({
        where: { id: plate.lastBreakpointSetId, organizationId: actor.organizationId },
        select: {
          id: true,
          standard: true,
          version: true,
          organism: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
          approvedAt: true,
          contentHash: true,
        },
      })
      : null;

    return NextResponse.json({
      ...plate,
      updatedAt: plate.updatedAt.toISOString(),
      selectedBreakpointSet: selectedBreakpointSet ? {
        ...selectedBreakpointSet,
        effectiveFrom: selectedBreakpointSet.effectiveFrom?.toISOString() ?? null,
        effectiveTo: selectedBreakpointSet.effectiveTo?.toISOString() ?? null,
        approvedAt: selectedBreakpointSet.approvedAt?.toISOString() ?? null,
      } : null,
      drugs: plate.drugs.map((drug) => ({ ...drug, concentrations: drug.concentrations as number[] })),
      results: plate.rawMics.map((mic) => ({
        rawMicId: mic.id,
        sirInterpretationId: mic.interpretations[0]?.id ?? null,
        breakpointSetId: mic.breakpointSetId,
        drugName: mic.plateDrug.drugName,
        value: mic.value,
        rawMicOperator: mic.rawMicOperator as RawMicOperator | null,
        modifier: mic.modifier,
        category: mic.interpretations[0]?.category ?? "NOT_DETERMINED",
        breakpointVersion: mic.interpretations[0]?.ruleVersion ?? null,
        calculationEngineVersion: mic.calculationEngineVersion,
        ruleEngineVersion: mic.interpretations[0]?.ruleEngineVersion ?? null,
      })),
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return jsonError("INTERNAL_ERROR", "処理に失敗しました。", 500);
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  let actor: AuthenticatedActor | null = null;
  let plateId: string | null = null;
  let idempotencyKey: string | null = null;
  try {
    actor = await requireAuthenticatedUser(request);
    const currentActor = actor;
    requirePermission(currentActor, "plate:write");
    const { id } = await params;
    plateId = id;
    await requirePlateAccess(currentActor, id);

    const body = await request.json().catch(() => null);
    const parsed = savePlateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", message: "保存内容が不正です。" }, details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const expectedRevision = parseExpectedRevision(request, parsed.data.expectedRevision);
    if (expectedRevision === null) {
      return jsonError("PRECONDITION_REQUIRED", "保存にはexpectedRevisionまたはIf-Matchヘッダーが必要です。", 428);
    }

    idempotencyKey = normalizeIdempotencyKey(request, parsed.data.idempotencyKey);
    const hash = requestHash({
      plateId: id,
      expectedRevision,
      breakpointSetId: parsed.data.breakpointSetId,
      breakpointChangeReason: parsed.data.breakpointChangeReason ?? null,
      wells: parsed.data.wells,
    });

    if (idempotencyKey) {
      const existing = await prisma.idempotencyRecord.findUnique({
        where: {
          organizationId_actorUserId_key: {
            organizationId: currentActor.organizationId,
            actorUserId: currentActor.userId,
            key: idempotencyKey,
          },
        },
      });
      if (existing) {
        if (existing.requestHash !== hash || existing.plateId !== id) {
          return jsonError("IDEMPOTENCY_KEY_REUSED", "同じidempotency keyが異なる保存内容に使われています。", 409);
        }
        return NextResponse.json(existing.responseJson, { status: existing.statusCode });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const plate = await tx.plate.findFirst({
        where: { id, organizationId: currentActor.organizationId },
        include: { sample: true, drugs: { orderBy: { rowIndex: "asc" } }, wells: true },
      });
      if (!plate) return { kind: "not_found" as const };

      const now = new Date();
      await tx.auditLog.create({
        data: {
          actorId: currentActor.userId,
          actorLabel: currentActor.userId,
          action: "OFFLINE_SYNC_STARTED",
          entityType: "Plate",
          entityId: id,
          afterJson: inputJson({
            actorUserId: currentActor.userId,
            organizationId: currentActor.organizationId,
            plateId: id,
            clientBaseRevision: expectedRevision,
            serverRevision: plate.wellRevision,
            idempotencyKey,
            timestamp: now.toISOString(),
            sessionId: currentActor.sessionId,
          }),
        },
      });

      if (plate.wellRevision !== expectedRevision) {
        await tx.auditLog.create({
          data: {
            actorId: currentActor.userId,
            actorLabel: currentActor.userId,
            action: "OFFLINE_SYNC_CONFLICT",
            entityType: "Plate",
            entityId: id,
            afterJson: inputJson({
              actorUserId: currentActor.userId,
              organizationId: currentActor.organizationId,
              plateId: id,
              clientBaseRevision: expectedRevision,
              serverRevision: plate.wellRevision,
              conflictType: "REVISION_CONFLICT",
              idempotencyKey,
              timestamp: now.toISOString(),
              sessionId: currentActor.sessionId,
            }),
          },
        });
        return { kind: "conflict" as const, plate };
      }

      const revisionUpdate = await tx.plate.updateMany({
        where: { id, organizationId: currentActor.organizationId, wellRevision: expectedRevision },
        data: { wellRevision: { increment: 1 } },
      });
      if (revisionUpdate.count !== 1) {
        const latest = await tx.plate.findFirst({
          where: { id, organizationId: currentActor.organizationId },
          include: { wells: true },
        });
        return latest ? { kind: "conflict" as const, plate: latest } : { kind: "not_found" as const };
      }

      const confirmedAt = new Date();
      for (const well of parsed.data.wells) {
        await tx.plateWell.upsert({
          where: { plateId_rowIndex_columnIndex: { plateId: id, rowIndex: well.rowIndex, columnIndex: well.columnIndex } },
          create: {
            plateId: id,
            rowIndex: well.rowIndex,
            columnIndex: well.columnIndex,
            state: well.state,
            source: "MANUAL",
            confidence: null,
            needsReview: false,
            observedAt: confirmedAt,
            sourcePredictionId: null,
            confirmedByUserId: currentActor.userId,
            confirmedAt,
          },
          update: {
            state: well.state,
            source: "MANUAL",
            confidence: null,
            needsReview: false,
            observedAt: confirmedAt,
            sourcePredictionId: null,
            confirmedByUserId: currentActor.userId,
            confirmedAt,
          },
        });
      }

      const results = parsed.data.breakpointSetId?.trim()
        ? await recalculatePlateResults(tx, id, currentActor, {
          breakpointSetId: parsed.data.breakpointSetId,
          breakpointChangeReason: parsed.data.breakpointChangeReason,
        })
        : [];
      if (results === null) return { kind: "not_found" as const };

      const needsReview = results.some((item) => item.needsReview);
      const status = needsReview ? "REVIEW_REQUIRED" : "DRAFT";
      const updatedPlate = await tx.plate.update({ where: { id }, data: { status } });
      await tx.auditLog.create({
        data: {
          actorId: currentActor.userId,
          actorLabel: currentActor.userId,
          action: "PLATE_SAVED",
          entityType: "Plate",
          entityId: id,
          beforeJson: { wellCount: plate.wells.length, status: plate.status },
          afterJson: inputJson({
            wellCount: parsed.data.wells.length,
            status,
            results,
            resultingRevision: updatedPlate.wellRevision,
            organizationId: currentActor.organizationId,
            sessionId: currentActor.sessionId,
          }),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: currentActor.userId,
          actorLabel: currentActor.userId,
          action: "OFFLINE_SYNC_SUCCEEDED",
          entityType: "Plate",
          entityId: id,
          afterJson: inputJson({
            actorUserId: currentActor.userId,
            organizationId: currentActor.organizationId,
            plateId: id,
            clientBaseRevision: expectedRevision,
            serverRevision: expectedRevision,
            resultingRevision: updatedPlate.wellRevision,
            idempotencyKey,
            timestamp: new Date().toISOString(),
            sessionId: currentActor.sessionId,
          }),
        },
      });

      const responseBody: SavePlateResponse = { plateId: id, status, wellRevision: updatedPlate.wellRevision, results };
      if (idempotencyKey) {
        await tx.idempotencyRecord.create({
          data: {
            key: idempotencyKey,
            actorUserId: currentActor.userId,
            organizationId: currentActor.organizationId,
            plateId: id,
            requestHash: hash,
            statusCode: 200,
            responseJson: inputJson(responseBody),
          },
        });
      }
      return { kind: "saved" as const, responseBody };
    });

    if (result.kind === "not_found") return jsonError("NOT_FOUND", "対象のプレートが見つかりません。", 404);
    if (result.kind === "conflict") {
      const serverUpdatedBy = await latestPlateActor(id);
      return revisionConflictResponse({
        plate: result.plate,
        clientBaseRevision: expectedRevision,
        serverUpdatedBy,
      });
    }
    return NextResponse.json(result.responseBody);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ResultCalculationError) {
      await recordResultCalculationFailure(actor, plateId, error);
      return resultCalculationResponse(error);
    }
    if (idempotencyKey && typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return jsonError("IDEMPOTENCY_RETRY_REQUIRED", "同時送信を検出しました。少し待ってから再試行してください。", 409);
    }
    console.error(error);
    return jsonError("INTERNAL_ERROR", "処理に失敗しました。", 500);
  }
}
