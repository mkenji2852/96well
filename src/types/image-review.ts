import type { WellState } from "@/types/domain";

export type ReviewWellState =
  | "GROWTH"
  | "NO_GROWTH"
  | "UNCERTAIN"
  | "CONTAMINATED"
  | "UNREADABLE";

export type ImageAssessmentReviewStatus =
  | "PENDING"
  | "PROCESSING"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "REJECTED"
  | "ANALYSIS_FAILED";

export interface ImagePredictionWellView {
  wellId: string;
  rowIndex: number;
  columnIndex: number;
  state: WellState;
  confidence: number;
  reviewNeeded: boolean;
  qcFlags: string[];
}

export interface ImagePredictionReviewView {
  id: string;
  imageReference: string | null;
  modelVersion: string;
  qcScore: number | null;
  qcFlags: Record<string, boolean>;
  detectedWells: number;
  plateConfidence: number | null;
  createdAt: string;
  wells: ImagePredictionWellView[];
}

export interface ImageWellOverrideView {
  id: string;
  rowIndex: number;
  columnIndex: number;
  beforeState: WellState;
  afterState: WellState;
  reason: string;
  reviewerUserId: string | null;
  modelVersion: string;
  createdAt: string;
}

export interface ImageReviewDecisionView {
  id: string;
  reviewerUserId: string | null;
  decision: "APPROVED" | "REJECTED";
  reviewedAt: string;
  rejectionReason: string | null;
  overrideReason: string | null;
}

export interface ImageReviewAssessmentSummary {
  id: string;
  plateId: string;
  status: ImageAssessmentReviewStatus;
  manualReviewRequired: boolean;
  createdAt: string;
  imageReference: string | null;
  uploadedByUserId: string | null;
  uploader: { id: string; name: string; email: string } | null;
  reviewWaitingMinutes: number;
  qcWarningCount: number;
  plate: {
    id: string;
    name: string;
    status: string;
    lastBreakpointSetId: string | null;
    sample: { id: string; sampleCode: string; organism: string | null };
    organization: { id: string; name: string };
  };
  prediction: ImagePredictionReviewView | null;
  overrides: ImageWellOverrideView[];
  reviews: ImageReviewDecisionView[];
}

export interface ImageReviewListResponse {
  assessments: ImageReviewAssessmentSummary[];
  page: { limit: number; offset: number; total: number };
}
