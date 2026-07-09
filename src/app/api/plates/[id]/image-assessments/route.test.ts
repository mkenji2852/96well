import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "tech-1", organizationId: "org-a", role: "TECHNICIAN" as const, sessionId: "session-1" };
  const imageAssessmentCreate = vi.fn();
  const imageAssessmentUpdate = vi.fn();
  const imagePredictionCreate = vi.fn();
  const auditCreate = vi.fn();
  const auditCreateMany = vi.fn();
  const plateUpdate = vi.fn();
  const tx = {
    imageAssessment: { create: imageAssessmentCreate, update: imageAssessmentUpdate },
    imagePrediction: { create: imagePredictionCreate },
    auditLog: { create: auditCreate, createMany: auditCreateMany },
    plate: { update: plateUpdate },
  };
  return {
    actor,
    analyzePlateImage: vi.fn(),
    plateFindFirst: vi.fn(),
    imageAssessmentFindMany: vi.fn(),
    imageAssessmentCreate,
    imageAssessmentUpdate,
    imagePredictionCreate,
    auditCreate,
    auditCreateMany,
    plateUpdate,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/image-analysis", () => ({ analyzePlateImage: mocks.analyzePlateImage }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    plate: { findFirst: mocks.plateFindFirst },
    imageAssessment: { findMany: mocks.imageAssessmentFindMany, update: mocks.imageAssessmentUpdate },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "./route";

function multipartRequest(extra?: (form: FormData) => void): Request {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "plate.png");
  extra?.(form);
  return new Request("http://localhost/api/plates/plate-1/image-assessments", { method: "POST", body: form });
}

const highConfidenceAnalysis = {
  service_version: "server-opencv-v1",
  qc_score: 1,
  qc_flags: { blur: false, glare: false, low_exposure: false, skew: false },
  detected_wells: 96,
  confidence: 1,
  review_needed: false,
  wells: [{
    well_id: "A1",
    row_index: 0,
    column_index: 0,
    center: { x: 1, y: 1 },
    radius: 1,
    prediction: "growth",
    confidence: 1,
    review_needed: false,
    features: { mean_intensity: 1, intensity_std: 1, dark_fraction: 0 },
  }],
};

describe("POST /api/plates/[id]/image-assessments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.role = "TECHNICIAN";
    mocks.actor.organizationId = "org-a";
    mocks.plateFindFirst.mockResolvedValue({ id: "plate-1" });
    mocks.imageAssessmentCreate.mockResolvedValue({
      id: "assessment-1",
      plateId: "plate-1",
      status: "PROCESSING",
      manualReviewRequired: true,
    });
    mocks.imageAssessmentUpdate.mockResolvedValue({
      id: "assessment-1",
      plateId: "plate-1",
      status: "REVIEW_REQUIRED",
      manualReviewRequired: true,
    });
    mocks.imagePredictionCreate.mockResolvedValue({
      id: "prediction-1",
      modelVersion: "server-opencv-v1",
    });
    mocks.analyzePlateImage.mockResolvedValue(highConfidenceAnalysis);
  });

  it("starts manual review even when service confidence is 1.0", async () => {
    const response = await POST(multipartRequest(), { params: Promise.resolve({ id: "plate-1" }) });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.assessment.manualReviewRequired).toBe(true);
    expect(body.assessment.status).toBe("REVIEW_REQUIRED");
    expect(mocks.imageAssessmentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "REVIEW_REQUIRED", manualReviewRequired: true }),
    }));
  });

  it("ignores client-supplied modelVersion and stores only the authenticated service response", async () => {
    await POST(multipartRequest((form) => form.append("modelVersion", "attacker-model")), {
      params: Promise.resolve({ id: "plate-1" }),
    });
    expect(mocks.imagePredictionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ modelVersion: "server-opencv-v1", plateConfidence: 1 }),
    }));
  });

  it("rejects JSON prediction registration from the client", async () => {
    const response = await POST(new Request("http://localhost/api/plates/plate-1/image-assessments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelVersion: "attacker", confidence: 1, predictedStates: [] }),
    }), { params: Promise.resolve({ id: "plate-1" }) });
    expect(response.status).toBe(400);
    expect(mocks.imagePredictionCreate).not.toHaveBeenCalled();
  });

  it("records analysis failure in the audit log", async () => {
    mocks.analyzePlateImage.mockRejectedValue(new Error("service down"));
    const response = await POST(multipartRequest(), { params: Promise.resolve({ id: "plate-1" }) });
    expect(response.status).toBe(502);
    expect(mocks.imageAssessmentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "ANALYSIS_FAILED", manualReviewRequired: true }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "IMAGE_ANALYSIS_FAILED" }),
    }));
  });
});
