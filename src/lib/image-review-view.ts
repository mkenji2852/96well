import { parseStoredPredictions } from "@/lib/image-review";
import type {
  ImageAssessmentReviewStatus,
  ImageReviewAssessmentSummary,
  ImageReviewDecisionView,
  ImageWellOverrideView,
} from "@/types/image-review";
import type { WellState } from "@/types/domain";

interface ReviewAssessmentRecord {
  id: string;
  plateId: string;
  status: string;
  manualReviewRequired: boolean;
  createdAt: Date | string;
  imageReference: string | null;
  uploadedByUserId: string | null;
  uploadedBy?: { id: string; name: string; email: string } | null;
  plate: {
    id: string;
    name: string;
    status: string;
    lastBreakpointSetId: string | null;
    sample: { id: string; sampleCode: string; organism: string | null };
    organization: { id: string; name: string };
  };
  predictions: Array<{
    id: string;
    imageReference: string | null;
    modelVersion: string;
    qcScore: number | null;
    qcFlags: unknown;
    detectedWells: number;
    plateConfidence: number | null;
    predictions: unknown;
    createdAt: Date | string;
  }>;
  overrides: Array<{
    id: string;
    rowIndex: number;
    columnIndex: number;
    beforeState: string;
    afterState: string;
    reason: string;
    reviewerUserId: string | null;
    modelVersion: string;
    createdAt: Date | string;
  }>;
  reviews: Array<{
    id: string;
    reviewerUserId: string | null;
    decision: string;
    reviewedAt: Date | string;
    rejectionReason: string | null;
    overrideReason: string | null;
  }>;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeQcFlags(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, flag]) => [key, Boolean(flag)]),
  );
}

function qcWarningNames(flags: Record<string, boolean>): string[] {
  return Object.entries(flags).filter(([, enabled]) => enabled).map(([key]) => key);
}

export function serializeImageAssessmentForReview(
  assessment: ReviewAssessmentRecord,
): ImageReviewAssessmentSummary {
  const prediction = assessment.predictions[0] ?? null;
  const qcFlags = prediction ? normalizeQcFlags(prediction.qcFlags) : {};
  const globalQcWarnings = qcWarningNames(qcFlags);
  const createdAt = toIso(assessment.createdAt);
  const createdAtMs = Date.parse(createdAt);
  const reviewWaitingMinutes = Number.isFinite(createdAtMs)
    ? Math.max(0, Math.floor((Date.now() - createdAtMs) / 60000))
    : 0;

  return {
    id: assessment.id,
    plateId: assessment.plateId,
    status: assessment.status as ImageAssessmentReviewStatus,
    manualReviewRequired: assessment.manualReviewRequired,
    createdAt,
    imageReference: assessment.imageReference,
    uploadedByUserId: assessment.uploadedByUserId,
    uploader: assessment.uploadedBy
      ? { id: assessment.uploadedBy.id, name: assessment.uploadedBy.name, email: assessment.uploadedBy.email }
      : null,
    reviewWaitingMinutes,
    qcWarningCount: globalQcWarnings.length,
    plate: assessment.plate,
    prediction: prediction
      ? {
          id: prediction.id,
          imageReference: prediction.imageReference,
          modelVersion: prediction.modelVersion,
          qcScore: prediction.qcScore,
          qcFlags,
          detectedWells: prediction.detectedWells,
          plateConfidence: prediction.plateConfidence,
          createdAt: toIso(prediction.createdAt),
          wells: parseStoredPredictions(prediction.predictions).map((well) => ({
            ...well,
            state: well.state,
            qcFlags: well.reviewNeeded ? globalQcWarnings : [],
          })),
        }
      : null,
    overrides: assessment.overrides.map((override): ImageWellOverrideView => ({
      id: override.id,
      rowIndex: override.rowIndex,
      columnIndex: override.columnIndex,
      beforeState: override.beforeState as WellState,
      afterState: override.afterState as WellState,
      reason: override.reason,
      reviewerUserId: override.reviewerUserId,
      modelVersion: override.modelVersion,
      createdAt: toIso(override.createdAt),
    })),
    reviews: assessment.reviews.map((review): ImageReviewDecisionView => ({
      id: review.id,
      reviewerUserId: review.reviewerUserId,
      decision: review.decision === "REJECTED" ? "REJECTED" : "APPROVED",
      reviewedAt: toIso(review.reviewedAt),
      rejectionReason: review.rejectionReason,
      overrideReason: review.overrideReason,
    })),
  };
}
