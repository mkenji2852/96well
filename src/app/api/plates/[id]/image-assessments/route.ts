import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { analyzePlateImage } from "@/lib/image-analysis";
import { normalizeImageAnalysisPredictions } from "@/lib/image-review";
import { prisma } from "@/lib/prisma";
import { requirePermission, requirePlateAccess } from "@/lib/rbac";

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function safeImageName(image: Blob): string {
  const name = "name" in image && typeof image.name === "string" ? image.name : "plate-image.jpg";
  return name.slice(0, 500);
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    const { id } = await params;
    await requirePlateAccess(actor, id);
    requirePermission(actor, "plate:review");

    const assessments = await prisma.imageAssessment.findMany({
      where: { plateId: id, status: "REVIEW_REQUIRED" },
      orderBy: { createdAt: "desc" },
      include: {
        predictions: { orderBy: { createdAt: "desc" }, take: 1 },
        overrides: { orderBy: { createdAt: "asc" } },
      },
    });
    return NextResponse.json({ assessments });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return jsonError("INTERNAL_ERROR", "処理に失敗しました。", 500);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  let assessmentId: string | null = null;
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "plate:write");
    const { id } = await params;
    await requirePlateAccess(actor, id);

    if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
      return jsonError("INVALID_REQUEST", "画像ファイルをmultipart/form-dataで送信してください。", 400);
    }

    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof Blob)) return jsonError("IMAGE_REQUIRED", "画像ファイルが必要です。", 400);
    const imageReference = safeImageName(image);

    const assessment = await prisma.$transaction(async (tx) => {
      const created = await tx.imageAssessment.create({
        data: {
          plateId: id,
          uploadedByUserId: actor.userId,
          imageReference,
          status: "PROCESSING",
          manualReviewRequired: true,
        },
      });
      await tx.plate.update({ where: { id }, data: { status: "REVIEW_REQUIRED" } });
      await tx.auditLog.createMany({
        data: [
          {
            actorId: actor.userId,
            actorLabel: actor.userId,
            action: "IMAGE_UPLOADED",
            entityType: "ImageAssessment",
            entityId: created.id,
            afterJson: {
              plateId: id,
              imageReference,
              manualReviewRequired: true,
              organizationId: actor.organizationId,
              sessionId: actor.sessionId,
            },
          },
          {
            actorId: actor.userId,
            actorLabel: actor.userId,
            action: "IMAGE_ANALYSIS_STARTED",
            entityType: "ImageAssessment",
            entityId: created.id,
            afterJson: {
              plateId: id,
              organizationId: actor.organizationId,
              sessionId: actor.sessionId,
            },
          },
        ],
      });
      return created;
    });
    assessmentId = assessment.id;

    let analysis;
    try {
      analysis = await analyzePlateImage(image, {
        fileName: imageReference,
        confidenceThreshold: 0.85,
      });
    } catch (error) {
      await prisma.$transaction(async (tx) => {
        await tx.imageAssessment.update({
          where: { id: assessment.id },
          data: { status: "ANALYSIS_FAILED", manualReviewRequired: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.userId,
            actorLabel: actor.userId,
            action: "IMAGE_ANALYSIS_FAILED",
            entityType: "ImageAssessment",
            entityId: assessment.id,
            afterJson: {
              plateId: id,
              errorMessage: error instanceof Error ? error.message : "Image analysis failed",
              manualReviewRequired: true,
              organizationId: actor.organizationId,
              sessionId: actor.sessionId,
            },
          },
        });
      });
      return jsonError("IMAGE_ANALYSIS_UNAVAILABLE", "画像解析サービスで処理できませんでした。manual reviewが必要です。", 502);
    }

    const predictions = normalizeImageAnalysisPredictions(analysis);
    const result = await prisma.$transaction(async (tx) => {
      const prediction = await tx.imagePrediction.create({
        data: {
          assessmentId: assessment.id,
          plateId: id,
          imageReference,
          modelVersion: analysis.service_version,
          qcScore: analysis.qc_score,
          qcFlags: analysis.qc_flags as Prisma.InputJsonValue,
          detectedWells: analysis.detected_wells,
          plateConfidence: analysis.confidence,
          predictions: predictions as unknown as Prisma.InputJsonValue,
        },
      });
      const updated = await tx.imageAssessment.update({
        where: { id: assessment.id },
        data: {
          status: "REVIEW_REQUIRED",
          manualReviewRequired: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "IMAGE_ANALYSIS_SUCCEEDED",
          entityType: "ImageAssessment",
          entityId: assessment.id,
          afterJson: {
            plateId: id,
            predictionId: prediction.id,
            modelVersion: prediction.modelVersion,
            qcScore: analysis.qc_score,
            qcFlags: analysis.qc_flags,
            detectedWells: analysis.detected_wells,
            confidence: analysis.confidence,
            manualReviewRequired: true,
            organizationId: actor.organizationId,
            sessionId: actor.sessionId,
          },
        },
      });
      return { assessment: updated, prediction };
    });

    return NextResponse.json({
      assessment: result.assessment,
      prediction: result.prediction,
      analysis: { ...analysis, review_needed: true },
    }, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return jsonError(
      "INTERNAL_ERROR",
      assessmentId ? "画像解析結果の保存に失敗しました。" : "処理に失敗しました。",
      500,
    );
  }
}
