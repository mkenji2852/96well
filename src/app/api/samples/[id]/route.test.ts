import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "user-a", organizationId: "org-a", role: "TECHNICIAN" as const, sessionId: "session-a" };
  const accessFindFirst = vi.fn();
  const txSampleFindFirst = vi.fn();
  const sampleDelete = vi.fn();
  const imageAssessmentFindMany = vi.fn();
  const auditCreate = vi.fn();
  const deleteMany = vi.fn();
  const updateMany = vi.fn();
  const tx = {
    sample: { findFirst: txSampleFindFirst, delete: sampleDelete },
    imageAssessment: { findMany: imageAssessmentFindMany, deleteMany },
    imageWellOverride: { deleteMany },
    imageReview: { deleteMany },
    plateWell: { deleteMany },
    sirInterpretation: { updateMany, deleteMany },
    rawMic: { updateMany, deleteMany },
    exportRecord: { deleteMany },
    imagePrediction: { deleteMany },
    plateDrug: { deleteMany },
    idempotencyRecord: { deleteMany },
    plate: { deleteMany },
    auditLog: { create: auditCreate },
  };
  return {
    actor,
    accessFindFirst,
    txSampleFindFirst,
    sampleDelete,
    imageAssessmentFindMany,
    auditCreate,
    deleteMany,
    updateMany,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    sample: { findFirst: mocks.accessFindFirst },
    $transaction: mocks.transaction,
  },
}));

import { DELETE } from "./route";

describe("DELETE /api/samples/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessFindFirst.mockResolvedValue({ id: "sample-1" });
    mocks.txSampleFindFirst.mockResolvedValue({
      id: "sample-1",
      sampleCode: "S-001",
      organism: "E. coli",
      plates: [{ id: "plate-1" }],
    });
    mocks.imageAssessmentFindMany.mockResolvedValue([{ id: "assessment-1" }]);
    mocks.sampleDelete.mockResolvedValue({ id: "sample-1" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("deletes plate-related data before deleting the sample", async () => {
    const response = await DELETE(new Request("http://localhost/api/samples/sample-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "sample-1" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.accessFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "sample-1", organizationId: "org-a" },
    }));
    expect(mocks.imageAssessmentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { plateId: { in: ["plate-1"] } },
    }));
    expect(mocks.sampleDelete).toHaveBeenCalledWith({ where: { id: "sample-1" } });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "SAMPLE_DELETED", actorId: "user-a" }),
    }));
  });
});
