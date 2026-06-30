import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { serializeImageAssessmentForReview } from "@/lib/image-review-view";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";

type RouteContext = { params: Promise<{ assessmentId: string }> };

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "plate:review");
    const { assessmentId } = await params;
    const assessment = await prisma.imageAssessment.findFirst({
      where: { id: assessmentId, plate: { organizationId: actor.organizationId } },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
        plate: {
          select: {
            id: true,
            name: true,
            status: true,
            lastBreakpointSetId: true,
            sample: { select: { id: true, sampleCode: true, organism: true } },
            organization: { select: { id: true, name: true } },
          },
        },
        predictions: { orderBy: { createdAt: "desc" }, take: 1 },
        overrides: { orderBy: { createdAt: "asc" } },
        reviews: { orderBy: { reviewedAt: "desc" }, take: 10 },
      },
    });
    if (!assessment) return jsonError("NOT_FOUND", "対象が存在しない、または他施設の画像レビューです。", 404);
    return NextResponse.json({ assessment: serializeImageAssessmentForReview(assessment) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return jsonError("INTERNAL_ERROR", "画像レビュー詳細の取得に失敗しました。", 500);
  }
}
