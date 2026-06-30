import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { parseStoredPredictions, wellKey } from "@/lib/image-review";
import { requireImageReviewActor } from "@/lib/image-review-permissions";
import { prisma } from "@/lib/prisma";
import { overrideImageWellSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string; assessmentId: string }> };

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    const { id, assessmentId } = await params;
    await requireImageReviewActor(actor, id, assessmentId, "OVERRIDE");

    const parsed = overrideImageWellSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("INVALID_REQUEST", "overrideにはウェル、変更後状態、理由が必要です。", 400);
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
      const predicted = parseStoredPredictions(prediction.predictions)
        .find((well) => wellKey(well.rowIndex, well.columnIndex) === wellKey(parsed.data.rowIndex, parsed.data.columnIndex));
      if (!predicted) return { kind: "prediction_not_found" as const };

      const createdAt = new Date();
      const override = await tx.imageWellOverride.create({
        data: {
          assessmentId,
          imagePredictionId: prediction.id,
          reviewerUserId: actor.userId,
          rowIndex: parsed.data.rowIndex,
          columnIndex: parsed.data.columnIndex,
          beforeState: predicted.state,
          afterState: parsed.data.state,
          reason: parsed.data.reason,
          modelVersion: prediction.modelVersion,
          createdAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "IMAGE_WELL_OVERRIDDEN",
          entityType: "ImageAssessment",
          entityId: assessmentId,
          beforeJson: {
            rowIndex: parsed.data.rowIndex,
            columnIndex: parsed.data.columnIndex,
            state: predicted.state,
            imagePredictionId: prediction.id,
            modelVersion: prediction.modelVersion,
          },
          afterJson: {
            rowIndex: parsed.data.rowIndex,
            columnIndex: parsed.data.columnIndex,
            state: parsed.data.state,
            reason: parsed.data.reason,
            reviewerUserId: actor.userId,
            timestamp: createdAt.toISOString(),
            imagePredictionId: prediction.id,
            modelVersion: prediction.modelVersion,
            organizationId: actor.organizationId,
            sessionId: actor.sessionId,
          },
        },
      });
      return { kind: "overridden" as const, override };
    });

    if (result.kind === "not_found") return jsonError("NOT_FOUND", "レビュー対象が見つかりません。", 404);
    if (result.kind === "not_review_required") return jsonError("CONFLICT", "この画像判定は現在overrideできません。", 409);
    if (result.kind === "no_prediction") return jsonError("CONFLICT", "サーバー生成の画像予測が存在しません。", 409);
    if (result.kind === "prediction_not_found") return jsonError("NOT_FOUND", "対象ウェルの予測が見つかりません。", 404);
    return NextResponse.json(result);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return jsonError("INTERNAL_ERROR", "処理に失敗しました。", 500);
  }
}
