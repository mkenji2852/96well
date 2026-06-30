import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { serializeImageAssessmentForReview } from "@/lib/image-review-view";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function parseBoundedInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

export async function GET(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "plate:review");
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "REVIEW_REQUIRED";
    if (status !== "REVIEW_REQUIRED") {
      return jsonError("INVALID_REQUEST", "レビュー待ち一覧ではREVIEW_REQUIREDのみ取得できます。", 400);
    }

    const limit = parseBoundedInt(url.searchParams.get("limit"), 25, 50);
    const offset = parseBoundedInt(url.searchParams.get("offset"), 0, 5000);
    const organism = url.searchParams.get("organism")?.trim();
    const uploaderUserId = url.searchParams.get("uploaderUserId")?.trim();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const createdAt: Prisma.DateTimeFilter = {};
    if (from && !Number.isNaN(Date.parse(from))) createdAt.gte = new Date(from);
    if (to && !Number.isNaN(Date.parse(to))) createdAt.lte = new Date(to);

    const where: Prisma.ImageAssessmentWhereInput = {
      status: "REVIEW_REQUIRED",
      plate: {
        organizationId: actor.organizationId,
        sample: organism ? { organism: { contains: organism } } : undefined,
      },
      uploadedByUserId: uploaderUserId || undefined,
      createdAt: Object.keys(createdAt).length > 0 ? createdAt : undefined,
    };

    const [total, assessments] = await prisma.$transaction([
      prisma.imageAssessment.count({ where }),
      prisma.imageAssessment.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: offset,
        take: limit,
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
          reviews: { orderBy: { reviewedAt: "desc" }, take: 3 },
        },
      }),
    ]);

    return NextResponse.json({
      assessments: assessments.map(serializeImageAssessmentForReview),
      page: { limit, offset, total },
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return jsonError("INTERNAL_ERROR", "画像レビュー一覧の取得に失敗しました。", 500);
  }
}
