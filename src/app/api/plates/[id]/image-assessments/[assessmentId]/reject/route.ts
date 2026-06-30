import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { requireImageReviewActor } from "@/lib/image-review-permissions";
import { prisma } from "@/lib/prisma";
import { rejectImageAssessmentSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string; assessmentId: string }> };

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    const { id, assessmentId } = await params;
    await requireImageReviewActor(actor, id, assessmentId, "REJECT");

    const parsed = rejectImageAssessmentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return jsonError("INVALID_REQUEST", "差戻し理由を入力してください。", 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const assessment = await tx.imageAssessment.findFirst({
        where: { id: assessmentId, plateId: id },
        select: { id: true, status: true },
      });
      if (!assessment) return { kind: "not_found" as const };
      if (assessment.status !== "REVIEW_REQUIRED") return { kind: "not_review_required" as const };

      const statusUpdate = await tx.imageAssessment.updateMany({
        where: { id: assessmentId, plateId: id, status: "REVIEW_REQUIRED" },
        data: { status: "REJECTED", manualReviewRequired: true },
      });
      if (statusUpdate.count !== 1) return { kind: "not_review_required" as const };
      const reviewedAt = new Date();
      await tx.imageReview.create({
        data: {
          assessmentId,
          reviewerUserId: actor.userId,
          decision: "REJECTED",
          reviewedAt,
          rejectionReason: parsed.data.rejectionReason,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "IMAGE_REVIEW_REJECTED",
          entityType: "ImageAssessment",
          entityId: assessmentId,
          afterJson: {
            plateId: id,
            rejectionReason: parsed.data.rejectionReason,
            reviewerUserId: actor.userId,
            reviewedAt: reviewedAt.toISOString(),
            organizationId: actor.organizationId,
            sessionId: actor.sessionId,
          },
        },
      });
      return { kind: "rejected" as const, assessmentId, plateId: id, status: "REJECTED" };
    });

    if (result.kind === "not_found") return jsonError("NOT_FOUND", "レビュー対象が見つかりません。", 404);
    if (result.kind === "not_review_required") return jsonError("CONFLICT", "この画像判定は現在差戻しできません。", 409);
    return NextResponse.json(result);
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return jsonError("INTERNAL_ERROR", "処理に失敗しました。", 500);
  }
}
