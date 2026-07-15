import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermission, requireSampleAccess } from "@/lib/rbac";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteContext) {
  let deleteStage = "authenticate";
  try {
    const actor = await requireAuthenticatedUser(request);
    deleteStage = "authorize";
    requirePermission(actor, "sample:delete");
    const { id } = await params;
    deleteStage = "scope-check";
    await requireSampleAccess(actor, id);

    const result = await prisma.$transaction(async (tx) => {
      deleteStage = "load-sample";
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

      const summary = {
        plates: plateIds.length,
        assessments: assessmentIds.length,
        imageWellOverrides: 0,
        imageReviews: 0,
        plateWells: 0,
        sirInterpretations: 0,
        rawMics: 0,
        exportRecords: 0,
        imagePredictions: 0,
        imageAssessments: 0,
        plateDrugs: 0,
        idempotencyRecords: 0,
        platesDeleted: 0,
      };

      if (plateIds.length > 0) {
        deleteStage = "unlink-result-history";
        await tx.sirInterpretation.updateMany({
          where: { plateId: { in: plateIds } },
          data: { supersedesId: null },
        });
        await tx.rawMic.updateMany({
          where: { plateId: { in: plateIds } },
          data: { supersedesId: null },
        });
        if (assessmentIds.length > 0) {
          deleteStage = "delete-image-review-children";
          summary.imageWellOverrides = (await tx.imageWellOverride.deleteMany({ where: { assessmentId: { in: assessmentIds } } })).count;
          summary.imageReviews = (await tx.imageReview.deleteMany({ where: { assessmentId: { in: assessmentIds } } })).count;
        }
        deleteStage = "delete-plate-wells";
        summary.plateWells = (await tx.plateWell.deleteMany({ where: { plateId: { in: plateIds } } })).count;
        deleteStage = "delete-sir-interpretations";
        summary.sirInterpretations = (await tx.sirInterpretation.deleteMany({ where: { plateId: { in: plateIds } } })).count;
        deleteStage = "delete-raw-mics";
        summary.rawMics = (await tx.rawMic.deleteMany({ where: { plateId: { in: plateIds } } })).count;
        deleteStage = "delete-export-records";
        summary.exportRecords = (await tx.exportRecord.deleteMany({ where: { plateId: { in: plateIds } } })).count;
        deleteStage = "delete-image-predictions";
        summary.imagePredictions = (await tx.imagePrediction.deleteMany({ where: { plateId: { in: plateIds } } })).count;
        deleteStage = "delete-image-assessments";
        summary.imageAssessments = (await tx.imageAssessment.deleteMany({ where: { plateId: { in: plateIds } } })).count;
        deleteStage = "delete-plate-drugs";
        summary.plateDrugs = (await tx.plateDrug.deleteMany({ where: { plateId: { in: plateIds } } })).count;
        deleteStage = "delete-idempotency-records";
        summary.idempotencyRecords = (await tx.idempotencyRecord.deleteMany({ where: { plateId: { in: plateIds } } })).count;
        deleteStage = "delete-plates";
        summary.platesDeleted = (await tx.plate.deleteMany({ where: { id: { in: plateIds }, organizationId: actor.organizationId } })).count;
      }
      deleteStage = "delete-sample";
      await tx.sample.delete({ where: { id: sample.id } });
      deleteStage = "write-audit";
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
      return { sample, summary };
    });

    if (!result) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Sampleが見つかりません。" } },
        { status: 404 },
      );
    }

    return NextResponse.json({ deletedSampleId: result.sample.id, deleteSummary: result.summary });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    const errorCode = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";
    console.error(JSON.stringify({
      level: "error",
      route: "DELETE /api/samples/[id]",
      stage: deleteStage,
      error: {
        name: error instanceof Error ? error.name : typeof error,
        code: errorCode,
        message: error instanceof Error ? error.message : "Sample delete failed",
      },
    }));
    return NextResponse.json(
      {
        error: {
          code: "SAMPLE_DELETE_FAILED",
          message: "Sampleの削除に失敗しました。DB権限または関連データの制約を確認してください。",
          stage: deleteStage,
        },
      },
      { status: 500 },
    );
  }
}
