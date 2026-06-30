import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser, type AuthenticatedActor } from "@/lib/auth";
import { parseStoredPredictions, wellKey } from "@/lib/image-review";
import { requireImageReviewActor } from "@/lib/image-review-permissions";
import { recalculatePlateResults, ResultCalculationError } from "@/lib/plate-results";
import { prisma } from "@/lib/prisma";
import { approveImageAssessmentSchema } from "@/lib/validation";
import type { WellState } from "@/types/domain";

type RouteContext = { params: Promise<{ id: string; assessmentId: string }> };

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
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
      afterJson: {
        actorUserId: actor.userId,
        organizationId: actor.organizationId,
        plateId,
        errorCode: error.code,
        message: error.message,
        timestamp: new Date().toISOString(),
        sessionId: actor.sessionId,
      } as unknown as Prisma.InputJsonValue,
    },
  }).catch(() => undefined);
}

export async function POST(request: Request, { params }: RouteContext) {
  let actor: AuthenticatedActor | null = null;
  let plateId: string | null = null;
  try {
    actor = await requireAuthenticatedUser(request);
    const currentActor = actor;
    const { id, assessmentId } = await params;
    plateId = id;
    await requireImageReviewActor(currentActor, id, assessmentId, "APPROVE");

    const parsed = approveImageAssessmentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("INVALID_REQUEST", "96個のウェル確認結果を送信してください。", 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const assessment = await tx.imageAssessment.findFirst({
        where: { id: assessmentId, plateId: id },
        include: { predictions: { orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (!assessment) return { kind: "not_found" as const };
      if (assessment.status !== "REVIEW_REQUIRED") return { kind: "not_review_required" as const };
      const prediction = assessment.predictions[0];
      if (!prediction) return { kind: "no_prediction" as const };

      const predictionByWell = new Map(
        parseStoredPredictions(prediction.predictions).map((well) => [wellKey(well.rowIndex, well.columnIndex), well]),
      );
      const confirmedAt = new Date();
      const overrides: Array<{
        rowIndex: number;
        columnIndex: number;
        beforeState: WellState;
        afterState: WellState;
        reason: string;
      }> = [];

      for (const well of parsed.data.confirmedWells) {
        const predicted = predictionByWell.get(wellKey(well.rowIndex, well.columnIndex));
        if (predicted && predicted.state !== well.state) {
          if (!parsed.data.overrideReason) return { kind: "override_reason_required" as const };
          overrides.push({
            rowIndex: well.rowIndex,
            columnIndex: well.columnIndex,
            beforeState: predicted.state,
            afterState: well.state,
            reason: parsed.data.overrideReason,
          });
        }
      }

      const statusUpdate = await tx.imageAssessment.updateMany({
        where: { id: assessmentId, plateId: id, status: "REVIEW_REQUIRED" },
        data: { status: "APPROVED", manualReviewRequired: false },
      });
      if (statusUpdate.count !== 1) return { kind: "not_review_required" as const };

      for (const well of parsed.data.confirmedWells) {
        await tx.plateWell.upsert({
          where: { plateId_rowIndex_columnIndex: { plateId: id, rowIndex: well.rowIndex, columnIndex: well.columnIndex } },
          create: {
            plateId: id,
            rowIndex: well.rowIndex,
            columnIndex: well.columnIndex,
            state: well.state,
            source: "IMAGE_REVIEWED",
            confidence: null,
            needsReview: false,
            observedAt: confirmedAt,
            sourcePredictionId: prediction.id,
            confirmedByUserId: currentActor.userId,
            confirmedAt,
          },
          update: {
            state: well.state,
            source: "IMAGE_REVIEWED",
            confidence: null,
            needsReview: false,
            observedAt: confirmedAt,
            sourcePredictionId: prediction.id,
            confirmedByUserId: currentActor.userId,
            confirmedAt,
          },
        });
      }

      for (const override of overrides) {
        await tx.imageWellOverride.create({
          data: {
            assessmentId,
            imagePredictionId: prediction.id,
            reviewerUserId: currentActor.userId,
            rowIndex: override.rowIndex,
            columnIndex: override.columnIndex,
            beforeState: override.beforeState,
            afterState: override.afterState,
            reason: override.reason,
            modelVersion: prediction.modelVersion,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: currentActor.userId,
            actorLabel: currentActor.userId,
            action: "IMAGE_WELL_OVERRIDDEN",
            entityType: "ImageAssessment",
            entityId: assessmentId,
            beforeJson: {
              rowIndex: override.rowIndex,
              columnIndex: override.columnIndex,
              state: override.beforeState,
              imagePredictionId: prediction.id,
              modelVersion: prediction.modelVersion,
            },
            afterJson: {
              rowIndex: override.rowIndex,
              columnIndex: override.columnIndex,
              state: override.afterState,
              reason: override.reason,
              reviewerUserId: currentActor.userId,
              timestamp: confirmedAt.toISOString(),
              imagePredictionId: prediction.id,
              modelVersion: prediction.modelVersion,
              organizationId: currentActor.organizationId,
              sessionId: currentActor.sessionId,
            },
          },
        });
      }

      await tx.imageReview.create({
        data: {
          assessmentId,
          reviewerUserId: currentActor.userId,
          decision: "APPROVED",
          reviewedAt: confirmedAt,
          overrideReason: parsed.data.overrideReason ?? null,
          confirmedWellsJson: parsed.data.confirmedWells as Prisma.InputJsonValue,
          overridesJson: overrides as Prisma.InputJsonValue,
        },
      });

      await tx.plate.update({ where: { id }, data: { wellRevision: { increment: 1 } } });
      const results = await recalculatePlateResults(tx, id, currentActor, {
        breakpointSetId: parsed.data.breakpointSetId,
        breakpointChangeReason: parsed.data.breakpointChangeReason,
      });
      if (!results) return { kind: "not_found" as const };
      await tx.plate.update({ where: { id }, data: { status: "APPROVED" } });
      await tx.auditLog.create({
        data: {
          actorId: currentActor.userId,
          actorLabel: currentActor.userId,
          action: "IMAGE_REVIEW_APPROVED",
          entityType: "ImageAssessment",
          entityId: assessmentId,
          afterJson: {
            plateId: id,
            imagePredictionId: prediction.id,
            modelVersion: prediction.modelVersion,
            wellCount: parsed.data.confirmedWells.length,
            overrideCount: overrides.length,
            results,
            reviewerUserId: currentActor.userId,
            reviewedAt: confirmedAt.toISOString(),
            organizationId: currentActor.organizationId,
            sessionId: currentActor.sessionId,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return { kind: "approved" as const, assessmentId, plateId: id, status: "APPROVED", results };
    });

    if (result.kind === "not_found") return jsonError("NOT_FOUND", "レビュー対象が見つかりません。", 404);
    if (result.kind === "not_review_required") return jsonError("CONFLICT", "この画像判定は現在レビュー承認できません。", 409);
    if (result.kind === "no_prediction") return jsonError("CONFLICT", "サーバー生成の画像予測が存在しません。", 409);
    if (result.kind === "override_reason_required") return jsonError("INVALID_REQUEST", "予測と異なる確定値にはoverride理由が必要です。", 400);
    return NextResponse.json(result);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (error instanceof ResultCalculationError) {
      await recordResultCalculationFailure(actor, plateId, error);
      const status = error.code === "RESULT_RECALCULATION_CONFLICT" ? 409 : 400;
      return jsonError(error.code, error.message, status);
    }
    console.error(error);
    return jsonError("INTERNAL_ERROR", "処理に失敗しました。", 500);
  }
}
