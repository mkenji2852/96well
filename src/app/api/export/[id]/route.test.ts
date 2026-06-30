import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const state = {
    actor: { userId: "user-1", organizationId: "org-a", role: "TECHNICIAN" as "TECHNICIAN" | "REVIEWER" | "ADMIN" | "AUDITOR", sessionId: "session-1" },
  };
  const accessPlateFindFirst = vi.fn();
  const tx = {
    plate: { findFirst: vi.fn() },
    breakpointSet: { findMany: vi.fn(), findFirst: vi.fn() },
    auditLog: { findMany: vi.fn() },
  };
  return {
    state,
    accessPlateFindFirst,
    tx,
    auditCreate: vi.fn(),
    exportCreate: vi.fn(),
    transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") return arg(tx);
      if (Array.isArray(arg)) return Promise.all(arg);
      return null;
    }),
    buildPlateWorkbook: vi.fn(async () => Buffer.from("xlsx-buffer")),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.state.actor) }));
vi.mock("@/lib/excel", async () => {
  const actual = await vi.importActual<typeof import("@/lib/excel")>("@/lib/excel");
  return { ...actual, buildPlateWorkbook: mocks.buildPlateWorkbook };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    plate: { findFirst: mocks.accessPlateFindFirst },
    auditLog: { create: mocks.auditCreate },
    exportRecord: { create: mocks.exportCreate },
    $transaction: mocks.transaction,
  },
}));

import { GET } from "./route";
import { calculateBreakpointContentHash } from "@/lib/breakpoint-lifecycle";

const routeContext = { params: Promise.resolve({ id: "plate-1" }) };

function currentRawMic(patch: Record<string, unknown> = {}) {
  return {
    id: "raw-1",
    plateDrugId: "drug-1",
    breakpointSetId: "bps-1",
    value: 2,
    modifier: "EQUAL",
    rawMicOperator: "=",
    calculationMethod: "broth-microdilution-v2",
    calculationEngineVersion: "broth-microdilution-v2",
    sourceWellRevision: 7,
    status: "CURRENT",
    supersedesId: null,
    supersededAt: null,
    createdAt: new Date("2026-06-23T00:00:00Z"),
    reviewRequired: false,
    rationaleJson: {},
    plateDrug: { drugName: "Drug X", unit: "µg/mL" },
    interpretations: [{
      id: "sir-1",
      breakpointSetId: "bps-1",
      category: "S",
      standard: "CLSI",
      ruleVersion: "2026.1",
      ruleEngineVersion: "sir-rule-engine-v2",
      status: "CURRENT",
      supersedesId: null,
      supersededAt: null,
      calculatedAt: new Date("2026-06-23T00:00:00Z"),
      susceptibleMax: 2,
      resistantMin: 8,
      rationaleJson: {},
    }],
    ...patch,
  };
}

function plate(patch: Record<string, unknown> = {}) {
  return {
    id: "plate-1",
    sampleId: "sample-1",
    organizationId: "org-a",
    name: "Plate 1",
    status: "APPROVED",
    wellRevision: 7,
    resultRevision: 4,
    updatedAt: new Date("2026-06-23T00:01:00Z"),
    sample: { id: "sample-1", sampleCode: "S-001", organism: "E. coli", notes: "private", createdAt: new Date("2026-06-22T00:00:00Z") },
    drugs: [{ id: "drug-1", rowIndex: 0, drugName: "Drug X", unit: "µg/mL", concentrations: [1, 2, 3] }],
    wells: [],
    rawMics: [currentRawMic()],
    imageAssessments: [{ id: "assessment-1", status: "APPROVED", manualReviewRequired: false, createdAt: new Date(), reviews: [{ id: "review-1", reviewerUserId: "reviewer-1", decision: "APPROVED", reviewedAt: new Date(), rejectionReason: null, overrideReason: null }], overrides: [] }],
    ...patch,
  };
}

function request(query = "") {
  return new Request(`http://localhost/api/export/plate-1${query}`);
}

function approvedBreakpointSet(id = "bps-1", patch: Record<string, unknown> = {}) {
  const set = {
    id,
    organizationId: "org-a",
    standard: "CLSI",
    version: "2026.1",
    organism: "E. coli",
    unit: "ﾂｵg/mL",
    method: "BROTH_MICRODILUTION",
    status: "APPROVED",
    effectiveFrom: null,
    effectiveTo: null,
    sourceDocumentReference: null,
    sourceDocumentChecksum: null,
    contentHash: "",
    rules: [{
      id: `rule-${id}`,
      drugName: "Drug X",
      organism: "E. coli",
      standard: "CLSI",
      version: "2026.1",
      susceptibleMax: 2,
      resistantMin: 8,
      intermediateMin: null,
      intermediateMax: null,
      unit: "ﾂｵg/mL",
      method: "BROTH_MICRODILUTION",
      exceptionJson: null,
    }],
    ...patch,
  };
  set.contentHash = calculateBreakpointContentHash(set as any);
  return set;
}

describe("GET /api/export/[id] privacy profiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.actor.role = "TECHNICIAN";
    mocks.accessPlateFindFirst.mockResolvedValue({ id: "plate-1" });
    mocks.tx.plate.findFirst.mockResolvedValue(plate());
    const set = approvedBreakpointSet();
    mocks.tx.breakpointSet.findMany.mockResolvedValue([set]);
    mocks.tx.breakpointSet.findFirst.mockResolvedValue({ contentHash: set.contentHash });
    mocks.tx.auditLog.findMany.mockResolvedValue([]);
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    mocks.exportCreate.mockResolvedValue({ id: "export-1" });
    mocks.buildPlateWorkbook.mockResolvedValue(Buffer.from("xlsx-buffer"));
  });

  it("uses ANONYMIZED by default and returns safe download headers", async () => {
    const response = await GET(request(), routeContext);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="ast-export-[^"]+\.xlsx"/);
    expect(response.headers.get("content-disposition")).not.toContain("S-001");
    expect(mocks.exportCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-a",
        actorUserId: "user-1",
        profile: "ANONYMIZED",
        fileName: expect.stringMatching(/^ast-export-/),
        metadataJson: expect.objectContaining({
          profile: "ANONYMIZED",
          includedSheets: ["Summary", "Wells", "Method"],
          includedSensitiveFields: [],
          snapshot: expect.objectContaining({ rawMicIds: ["raw-1"], sirInterpretationIds: ["sir-1"] }),
        }),
      }),
    }));
  });

  it("rejects AUDIT_FULL for TECHNICIAN and audits access denied", async () => {
    const response = await GET(request("?profile=AUDIT_FULL&reason=inspection"), routeContext);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(mocks.buildPlateWorkbook).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "EXPORT_ACCESS_DENIED",
        afterJson: expect.objectContaining({ profile: "AUDIT_FULL", errorCode: "FORBIDDEN" }),
      }),
    }));
  });

  it("allows ADMIN AUDIT_FULL with reason and stores audit metadata", async () => {
    mocks.state.actor.role = "ADMIN";
    const response = await GET(request("?profile=AUDIT_FULL&reason=inspection"), routeContext);

    expect(response.status).toBe(200);
    expect(mocks.tx.auditLog.findMany).toHaveBeenCalled();
    expect(mocks.exportCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        profile: "AUDIT_FULL",
        reason: "inspection",
        metadataJson: expect.objectContaining({
          includedSheets: ["Summary", "Wells", "Method", "ReviewHistory", "InterpretationHistory", "Audit", "ExportMetadata"],
          includedSensitiveFields: expect.arrayContaining(["actorUserId", "internalResultIds"]),
        }),
      }),
    }));
  });

  it("returns 404 for a plate outside the organization scope", async () => {
    mocks.accessPlateFindFirst.mockResolvedValue(null);

    const response = await GET(request(), routeContext);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mocks.buildPlateWorkbook).not.toHaveBeenCalled();
  });

  it("requires notes permission and explicit acknowledgement", async () => {
    mocks.state.actor.role = "REVIEWER";
    const reviewerResponse = await GET(request("?profile=CLINICAL_INTERNAL&includeNotes=true&acknowledgeSensitive=true"), routeContext);
    expect(reviewerResponse.status).toBe(403);

    mocks.state.actor.role = "ADMIN";
    const missingAckResponse = await GET(request("?profile=CLINICAL_INTERNAL&includeNotes=true"), routeContext);
    expect(missingAckResponse.status).toBe(400);

    const okResponse = await GET(request("?profile=CLINICAL_INTERNAL&includeNotes=true&acknowledgeSensitive=true"), routeContext);
    expect(okResponse.status).toBe(200);
    expect(mocks.exportCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metadataJson: expect.objectContaining({ includedSensitiveFields: expect.arrayContaining(["notes"]) }),
      }),
    }));
  });

  it("rejects mixed breakpoint sets for non-audit output", async () => {
    mocks.state.actor.role = "REVIEWER";
    mocks.tx.plate.findFirst.mockResolvedValue(plate({
      rawMics: [
        currentRawMic({ id: "raw-1", breakpointSetId: "bps-1" }),
        currentRawMic({ id: "raw-2", breakpointSetId: "bps-2", interpretations: [{
          ...currentRawMic().interpretations[0],
          id: "sir-2",
          breakpointSetId: "bps-2",
        }] }),
      ],
    }));
    mocks.tx.breakpointSet.findMany.mockResolvedValue([
      approvedBreakpointSet("bps-1"),
      approvedBreakpointSet("bps-2", { version: "2027.1" }),
    ]);

    const response = await GET(request("?profile=CLINICAL_INTERNAL"), routeContext);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("MIXED_BREAKPOINT_SETS_REQUIRE_AUDIT");
    expect(mocks.buildPlateWorkbook).not.toHaveBeenCalled();
  });

  it("rejects unapproved breakpoint sets", async () => {
    mocks.state.actor.role = "REVIEWER";
    mocks.tx.breakpointSet.findMany.mockResolvedValue([approvedBreakpointSet("bps-1", { status: "DRAFT" })]);

    const response = await GET(request("?profile=CLINICAL_INTERNAL"), routeContext);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("BREAKPOINT_SET_NOT_APPROVED");
    expect(mocks.buildPlateWorkbook).not.toHaveBeenCalled();
  });
});
