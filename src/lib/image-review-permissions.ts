import { AuthError } from "@/lib/api-auth-error";
import type { AuthenticatedActor } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermission, requirePlateAccess } from "@/lib/rbac";

export async function requireImageReviewActor(
  actor: AuthenticatedActor,
  plateId: string,
  assessmentId: string,
  attemptedAction: string,
): Promise<void> {
  await requirePlateAccess(actor, plateId);
  try {
    requirePermission(actor, "plate:review");
  } catch (error) {
    if (error instanceof AuthError && error.code === "FORBIDDEN") {
      await prisma.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "UNAUTHORIZED_IMAGE_REVIEW_ATTEMPT",
          entityType: "ImageAssessment",
          entityId: assessmentId,
          afterJson: {
            plateId,
            attemptedAction,
            organizationId: actor.organizationId,
            sessionId: actor.sessionId,
          },
        },
      });
    }
    throw error;
  }
}
