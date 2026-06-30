import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "admin-1", organizationId: "org-a", role: "ADMIN" as "ADMIN" | "TECHNICIAN", sessionId: "session-1" };
  const accessFindFirst = vi.fn();
  const setFindFirst = vi.fn();
  const setUpdateMany = vi.fn();
  const setFindUniqueOrThrow = vi.fn();
  const auditCreate = vi.fn();
  const tx = {
    breakpointSet: {
      findFirst: setFindFirst,
      updateMany: setUpdateMany,
      findUniqueOrThrow: setFindUniqueOrThrow,
    },
    auditLog: { create: auditCreate },
  };
  return {
    actor,
    accessFindFirst,
    setFindFirst,
    setUpdateMany,
    setFindUniqueOrThrow,
    auditCreate,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    breakpointSet: { findFirst: mocks.accessFindFirst },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "bps-1" }) };
const request = (revision = 2) => new Request("http://localhost/api/breakpoint-sets/bps-1/approve", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ expectedRevision: revision, approvalComment: "verified" }),
});

function draftSet() {
  return {
    id: "bps-1",
    organizationId: "org-a",
    standard: "CLSI",
    version: "2026.1",
    organism: "E. coli",
    unit: "mg/L",
    method: "BROTH_MICRODILUTION",
    status: "DRAFT",
    approvedAt: null,
    approvedByUserId: null,
    retiredAt: null,
    retiredByUserId: null,
    retireReason: null,
    approvalComment: null,
    sourceDocumentReference: "CLSI M100",
    sourceDocumentChecksum: "checksum",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: new Date("2027-01-01T00:00:00Z"),
    supersedesBreakpointSetId: null,
    contentHash: null,
    revision: 2,
    createdByUserId: "admin-0",
    createdAt: new Date(),
    updatedAt: new Date(),
    rules: [{
      id: "rule-1",
      organizationId: "org-a",
      breakpointSetId: "bps-1",
      drugName: "Drug X",
      organism: "E. coli",
      standard: "CLSI",
      version: "2026.1",
      susceptibleMax: 1,
      resistantMin: 4,
      intermediateMin: null,
      intermediateMax: null,
      unit: "mg/L",
      method: "BROTH_MICRODILUTION",
      exceptionJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }],
  };
}

describe("POST /api/breakpoint-sets/:id/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.role = "ADMIN";
    mocks.accessFindFirst.mockResolvedValue({ id: "bps-1" });
    mocks.setFindFirst.mockImplementation(async (args) => {
      if (args.where.id?.not) return null;
      if (args.where.contentHash) return null;
      return draftSet();
    });
    mocks.setUpdateMany.mockResolvedValue({ count: 1 });
    mocks.setFindUniqueOrThrow.mockResolvedValue({
      ...draftSet(),
      status: "APPROVED",
      revision: 3,
      approvedAt: new Date(),
      approvedByUserId: "admin-1",
      contentHash: "a".repeat(64),
      _count: { rules: 1 },
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("allows ADMIN and stores hash, approval actor, and audit atomically", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.setUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "DRAFT", revision: 2 }),
      data: expect.objectContaining({
        status: "APPROVED",
        approvedByUserId: "admin-1",
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "BREAKPOINT_SET_APPROVED", actorId: "admin-1" }),
    }));
  });

  it("rejects TECHNICIAN with 403", async () => {
    mocks.actor.role = "TECHNICIAN";
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects invalid boundaries before status changes", async () => {
    mocks.setFindFirst.mockImplementation(async (args) => {
      if (args.where.id?.not || args.where.contentHash) return null;
      const set = draftSet();
      set.rules[0].susceptibleMax = 8;
      set.rules[0].resistantMin = 4;
      return set;
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(400);
    expect(mocks.setUpdateMany).not.toHaveBeenCalled();
  });

  it("allows only one winner when approval revision reservation conflicts", async () => {
    mocks.setUpdateMany.mockResolvedValue({ count: 0 });
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
