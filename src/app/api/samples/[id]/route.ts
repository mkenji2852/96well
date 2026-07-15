import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermission, requireSampleAccess } from "@/lib/rbac";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "sample:delete");
    const { id } = await params;
    await requireSampleAccess(actor, id);

    const result = await prisma.$transaction(async (tx) => {
      const sample = await tx.sample.findFirst({
        where: { id, organizationId: actor.organizationId },
        select: {
          id: true,
          sampleCode: true,
          organism: true,
          plates: { select: { id: true } },
        },
      });
      if (!sample) return null;
      const plateIds = sample.plates.map((plate) => plate.id);
      const assessments = plateIds.length
        ? await tx.imageAssessment.findMany({
          where: { plateId: { in: plateIds } },
          select: { id: true },
        })
        : [];
      const assessmentIds = assessments.map((assessment) => assessment.id);

      if (plateIds.length > 0) {
        await tx.sirInterpretation.updateMany({
          where: { plateId: { in: plateIds } },
          data: { supersedesId: null },
        });
        await tx.rawMic.updateMany({
          where: { plateId: { in: plateIds } },
          data: { supersedesId: null },
        });
        if (assessmentIds.length > 0) {
          await tx.imageWellOverride.deleteMany({ where: { assessmentId: { in: assessmentIds } } });
          await tx.imageReview.deleteMany({ where: { assessmentId: { in: assessmentIds } } });
        }
        await tx.plateWell.deleteMany({ where: { plateId: { in: plateIds } } });
        await tx.sirInterpretation.deleteMany({ where: { plateId: { in: plateIds } } });
        await tx.rawMic.deleteMany({ where: { plateId: { in: plateIds } } });
        await tx.exportRecord.deleteMany({ where: { plateId: { in: plateIds } } });
        await tx.imagePrediction.deleteMany({ where: { plateId: { in: plateIds } } });
        await tx.imageAssessment.deleteMany({ where: { plateId: { in: plateIds } } });
        await tx.plateDrug.deleteMany({ where: { plateId: { in: plateIds } } });
        await tx.idempotencyRecord.deleteMany({ where: { plateId: { in: plateIds } } });
        await tx.plate.deleteMany({ where: { id: { in: plateIds }, organizationId: actor.organizationId } });
      }
      await tx.sample.delete({ where: { id: sample.id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "SAMPLE_DELETED",
          entityType: "Sample",
          entityId: sample.id,
          beforeJson: {
            sampleCode: sample.sampleCode,
            organism: sample.organism,
            plateIds: sample.plates.map((plate) => plate.id),
            organizationId: actor.organizationId,
            sessionId: actor.sessionId,
          },
          afterJson: {
            deleted: true,
          },
        },
      });
      return sample;
    });

    if (!result) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Sampleが見つかりません。" } },
        { status: 404 },
      );
    }

    return NextResponse.json({ deletedSampleId: result.id });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Sampleの削除に失敗しました。" } },
      { status: 500 },
    );
  }
}
