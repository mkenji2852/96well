import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "reviewer-1", organizationId: "org-a", role: "REVIEWER" as const, sessionId: "session-1" };
  const plateFindFirst = vi.fn();
  const imageAssessmentFindFirst = vi.fn();
  const imageAssessmentUpdateMany = vi.fn();
  const imageReviewCreate = vi.fn();
  const auditCreate = vi.fn();
  const plateWellUpsert = vi.fn();
  const tx = {
    imageAssessment: { findFirst: imageAssessmentFindFirst, updateMany: imageAssessmentUpdateMany },
    imageReview: { create: imageReviewCreate },
    auditLog: { create: auditCreate },
    plateWell: { upsert: plateWellUpsert },
  };
  return {
    actor,
    plateFindFirst,
    imageAssessmentFindFirst,
    imageAssessmentUpdateMany,
    imageReviewCreate,
    auditCreate,
    plateWellUpsert,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    plate: { findFirst: mocks.plateFindFirst },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "./route";

describe("POST reject image assessment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.plateFindFirst.mockResolvedValue({ id: "plate-1" });
    mocks.imageAssessmentFindFirst.mockResolvedValue({ id: "assessment-1", status: "REVIEW_REQUIRED" });
    mocks.imageAssessmentUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("rejects without creating confirmed PlateWell values", async () => {
    const response = await POST(new Request("http://localhost/api/plates/plate-1/image-assessments/assessment-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rejectionReason: "glare prevents reading" }),
    }), { params: Promise.resolve({ id: "plate-1", assessmentId: "assessment-1" }) });

    expect(response.status).toBe(200);
    expect(mocks.plateWellUpsert).not.toHaveBeenCalled();
    expect(mocks.imageAssessmentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "REJECTED", manualReviewRequired: true }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "IMAGE_REVIEW_REJECTED" }),
    }));
  });
});
