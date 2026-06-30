import { beforeEach, describe, expect, it, vi } from "vitest";

const allWells = (state: "GROWTH" | "INHIBITED" = "GROWTH") =>
  Array.from({ length: 96 }, (_, index) => ({
    rowIndex: Math.floor(index / 12),
    columnIndex: index % 12,
    state,
  }));

const allPredictions = () =>
  allWells("GROWTH").map((well) => ({
    wellId: `${String.fromCharCode(65 + well.rowIndex)}${well.columnIndex + 1}`,
    rowIndex: well.rowIndex,
    columnIndex: well.columnIndex,
    state: well.state,
    confidence: 1,
    reviewNeeded: true,
  }));

const mocks = vi.hoisted(() => {
  const actor = { userId: "reviewer-1", organizationId: "org-a", role: "REVIEWER" as "TECHNICIAN" | "REVIEWER", sessionId: "session-1" };
  const plateFindFirst = vi.fn();
  const imageAssessmentFindFirst = vi.fn();
  const imageAssessmentUpdateMany = vi.fn();
  const plateWellUpsert = vi.fn();
  const imageWellOverrideCreate = vi.fn();
  const imageReviewCreate = vi.fn();
  const auditCreate = vi.fn();
  const breakpointSetFindFirst = vi.fn();
  const rawMicFindFirst = vi.fn();
  const rawMicUpdateMany = vi.fn();
  const rawMicCreate = vi.fn();
  const sirFindFirst = vi.fn();
  const sirUpdateMany = vi.fn();
  const sirCreate = vi.fn();
  const plateUpdate = vi.fn();
  const plateUpdateMany = vi.fn();
  const tx = {
    plate: { findFirst: plateFindFirst, update: plateUpdate, updateMany: plateUpdateMany },
    imageAssessment: { findFirst: imageAssessmentFindFirst, updateMany: imageAssessmentUpdateMany },
    plateWell: { upsert: plateWellUpsert },
    imageWellOverride: { create: imageWellOverrideCreate },
    imageReview: { create: imageReviewCreate },
    auditLog: { create: auditCreate },
    breakpointSet: { findFirst: breakpointSetFindFirst },
    rawMic: { findFirst: rawMicFindFirst, updateMany: rawMicUpdateMany, create: rawMicCreate },
    sirInterpretation: { findFirst: sirFindFirst, updateMany: sirUpdateMany, create: sirCreate },
  };
  return {
    actor,
    plateFindFirst,
    imageAssessmentFindFirst,
    imageAssessmentUpdateMany,
    plateWellUpsert,
    imageWellOverrideCreate,
    imageReviewCreate,
    auditCreate,
    breakpointSetFindFirst,
    rawMicFindFirst,
    rawMicUpdateMany,
    rawMicCreate,
    sirFindFirst,
    sirUpdateMany,
    sirCreate,
    plateUpdate,
    plateUpdateMany,
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
import { calculateBreakpointContentHash } from "@/lib/breakpoint-lifecycle";

function request(wells = allWells()): Request {
  return new Request("http://localhost/api/plates/plate-1/image-assessments/assessment-1/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ breakpointSetId: "bps-1", confirmedWells: wells }),
  });
}

function context(plateId = "plate-1", assessmentId = "assessment-1") {
  return { params: Promise.resolve({ id: plateId, assessmentId }) };
}

function mockReviewRequiredAssessment() {
  mocks.imageAssessmentFindFirst.mockResolvedValue({
    id: "assessment-1",
    plateId: "plate-1",
    status: "REVIEW_REQUIRED",
    predictions: [{
      id: "prediction-1",
      modelVersion: "server-opencv-v1",
      predictions: allPredictions(),
    }],
  });
}

function mockPlateForAccessAndRecalculation() {
  const finalWells = allWells("GROWTH").map((well) => ({ ...well, source: "IMAGE_REVIEWED" }));
  mocks.plateFindFirst.mockImplementation(async ({ where, include }) => {
    if (where.organizationId !== "org-a") return null;
    if (!include) return { id: where.id };
    return {
      id: where.id,
      organizationId: "org-a",
      resultRevision: 0,
      wellRevision: 7,
      lastBreakpointSetId: null,
      sample: { organism: "E. coli" },
      drugs: [{ id: "drug-1", rowIndex: 0, drugName: "Drug X", unit: "mg/L", concentrations: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] }],
      wells: finalWells,
    };
  });
}

describe("POST approve image assessment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.role = "REVIEWER";
    mocks.actor.organizationId = "org-a";
    mockPlateForAccessAndRecalculation();
    mockReviewRequiredAssessment();
    mocks.imageAssessmentUpdateMany.mockResolvedValue({ count: 1 });
    const breakpointSet = {
      id: "bps-1",
      standard: "CLSI",
      version: "2026",
      organism: "E. coli",
      unit: "mg/L",
      method: "BROTH_MICRODILUTION",
      status: "APPROVED",
      effectiveFrom: null,
      effectiveTo: null,
      sourceDocumentReference: null,
      sourceDocumentChecksum: null,
      contentHash: "",
      rules: [{
        id: "rule-1",
        drugName: "Drug X",
        organism: "E. coli",
        standard: "CLSI",
        version: "2026",
        susceptibleMax: 1,
        resistantMin: 4,
        intermediateMin: null,
        intermediateMax: null,
        unit: "mg/L",
        method: "BROTH_MICRODILUTION",
        exceptionJson: null,
      }],
    };
    breakpointSet.contentHash = calculateBreakpointContentHash(breakpointSet);
    mocks.breakpointSetFindFirst.mockResolvedValue(breakpointSet);
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    mocks.plateUpdateMany.mockResolvedValue({ count: 1 });
    mocks.rawMicFindFirst.mockResolvedValue(null);
    mocks.sirFindFirst.mockResolvedValue(null);
    mocks.rawMicCreate.mockResolvedValue({ id: "raw-mic-1", value: 12, rawMicOperator: ">", reviewRequired: false });
    mocks.sirCreate.mockResolvedValue({ id: "sir-1", category: "R" });
  });

  it("rejects TECHNICIAN approval and records an unauthorized review attempt", async () => {
    mocks.actor.role = "TECHNICIAN";
    const response = await POST(request(), context());
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "UNAUTHORIZED_IMAGE_REVIEW_ATTEMPT", actorId: "reviewer-1" }),
    }));
  });

  it("allows REVIEWER to approve an in-organization plate and creates confirmed PlateWell rows", async () => {
    const response = await POST(request(), context());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("APPROVED");
    expect(mocks.plateWellUpsert).toHaveBeenCalledTimes(96);
    expect(mocks.plateWellUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        source: "IMAGE_REVIEWED",
        sourcePredictionId: "prediction-1",
        confirmedByUserId: "reviewer-1",
      }),
    }));
    expect(mocks.plateUpdate).toHaveBeenCalledWith({ where: { id: "plate-1" }, data: { status: "APPROVED" } });
  });

  it("hides plates from other organizations as 404", async () => {
    mocks.actor.organizationId = "org-b";
    const response = await POST(request(), context());
    expect(response.status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not approve when an override lacks a reason", async () => {
    const changed = allWells("GROWTH");
    changed[0] = { rowIndex: 0, columnIndex: 0, state: "INHIBITED" };
    const response = await POST(request(changed), context());
    expect(response.status).toBe(400);
    expect(mocks.imageAssessmentUpdateMany).not.toHaveBeenCalled();
    expect(mocks.plateWellUpsert).not.toHaveBeenCalled();
  });

  it("prevents double approval of the same assessment", async () => {
    mocks.imageAssessmentUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const first = await POST(request(), context());
    const second = await POST(request(), context());
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
  });
});
