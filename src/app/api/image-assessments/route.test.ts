import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = {
    userId: "reviewer-1",
    organizationId: "org-a",
    role: "REVIEWER" as "TECHNICIAN" | "REVIEWER" | "ADMIN",
    sessionId: "session-1",
  };
  const count = vi.fn();
  const findMany = vi.fn();
  const findFirst = vi.fn();
  return {
    actor,
    count,
    findMany,
    findFirst,
    transaction: vi.fn(async (items: Array<Promise<unknown>>) => Promise.all(items)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    imageAssessment: {
      count: mocks.count,
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
    },
    $transaction: mocks.transaction,
  },
}));

import { GET as detailGET } from "./[assessmentId]/route";
import { GET as listGET } from "./route";

function predictions() {
  return Array.from({ length: 8 }, (_, rowIndex) =>
    Array.from({ length: 12 }, (_, columnIndex) => ({
      wellId: `${String.fromCharCode(65 + rowIndex)}${columnIndex + 1}`,
      rowIndex,
      columnIndex,
      state: "INHIBITED",
      confidence: 0.9,
      reviewNeeded: true,
    })),
  ).flat();
}

function assessmentRecord() {
  return {
    id: "assessment-1",
    plateId: "plate-1",
    status: "REVIEW_REQUIRED",
    manualReviewRequired: true,
    createdAt: new Date("2026-06-23T00:00:00Z"),
    imageReference: "plate.png",
    uploadedByUserId: "tech-1",
    uploadedBy: { id: "tech-1", name: "Tech", email: "tech@example.test" },
    plate: {
      id: "plate-1",
      name: "Plate 1",
      status: "REVIEW_REQUIRED",
      lastBreakpointSetId: "bps-1",
      sample: { id: "sample-1", sampleCode: "S-001", organism: "E. coli" },
      organization: { id: "org-a", name: "Org A" },
    },
    predictions: [{
      id: "prediction-1",
      imageReference: "plate.png",
      modelVersion: "opencv-mvp",
      qcScore: 0.9,
      qcFlags: { blur: true, glare: false },
      detectedWells: 96,
      plateConfidence: 0.91,
      predictions: predictions(),
      createdAt: new Date("2026-06-23T00:01:00Z"),
    }],
    overrides: [],
    reviews: [],
  };
}

describe("GET /api/image-assessments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.role = "REVIEWER";
    mocks.count.mockResolvedValue(1);
    mocks.findMany.mockResolvedValue([assessmentRecord()]);
    mocks.findFirst.mockResolvedValue(assessmentRecord());
  });

  it("lists only REVIEW_REQUIRED assessments scoped to the actor organization", async () => {
    const response = await listGET(new Request("http://localhost/api/image-assessments?status=REVIEW_REQUIRED&organism=coli"));
    expect(response.status).toBe(200);
    expect(mocks.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "REVIEW_REQUIRED",
        plate: expect.objectContaining({ organizationId: "org-a" }),
      }),
    }));
    const body = await response.json();
    expect(body.assessments[0].plate.organization.id).toBe("org-a");
    expect(body.assessments[0].qcWarningCount).toBe(1);
  });

  it("rejects TECHNICIAN list access", async () => {
    mocks.actor.role = "TECHNICIAN";
    const response = await listGET(new Request("http://localhost/api/image-assessments?status=REVIEW_REQUIRED"));
    expect(response.status).toBe(403);
  });

  it("does not allow listing final statuses from the review queue endpoint", async () => {
    const response = await listGET(new Request("http://localhost/api/image-assessments?status=APPROVED"));
    expect(response.status).toBe(400);
  });
});

describe("GET /api/image-assessments/[assessmentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.role = "REVIEWER";
    mocks.findFirst.mockResolvedValue(assessmentRecord());
  });

  it("gets detail through organization scoped lookup", async () => {
    const response = await detailGET(new Request("http://localhost/api/image-assessments/assessment-1"), {
      params: Promise.resolve({ assessmentId: "assessment-1" }),
    });
    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "assessment-1", plate: { organizationId: "org-a" } },
    }));
  });

  it("returns 404 for a missing or different-organization assessment", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await detailGET(new Request("http://localhost/api/image-assessments/assessment-1"), {
      params: Promise.resolve({ assessmentId: "assessment-1" }),
    });
    expect(response.status).toBe(404);
  });
});
