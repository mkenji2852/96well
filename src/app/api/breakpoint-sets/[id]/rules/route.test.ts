import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "admin-1", organizationId: "org-a", role: "ADMIN" as "ADMIN" | "TECHNICIAN", sessionId: "session-1" };
  const accessFindFirst = vi.fn();
  const setFindFirst = vi.fn();
  const setUpdateMany = vi.fn();
  const ruleCreate = vi.fn();
  const auditCreate = vi.fn();
  const tx = {
    breakpointSet: { findFirst: setFindFirst, updateMany: setUpdateMany },
    breakpointRule: { create: ruleCreate },
    auditLog: { create: auditCreate },
  };
  return {
    actor,
    accessFindFirst,
    setFindFirst,
    setUpdateMany,
    ruleCreate,
    auditCreate,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    breakpointSet: { findFirst: mocks.accessFindFirst },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "bps-1" }) };
const request = () => new Request("http://localhost/api/breakpoint-sets/bps-1/rules", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    expectedRevision: 1,
    drugName: "Drug X",
    organism: "E. coli",
    susceptibleMax: 1,
    resistantMin: 4,
    unit: "mg/L",
    method: "BROTH_MICRODILUTION",
    exceptionJson: null,
  }),
});

describe("POST /api/breakpoint-sets/:id/rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.role = "ADMIN";
    mocks.accessFindFirst.mockResolvedValue({ id: "bps-1" });
    mocks.setFindFirst.mockResolvedValue({
      id: "bps-1",
      organizationId: "org-a",
      standard: "CLSI",
      version: "2026.1",
      organism: "E. coli",
      unit: "mg/L",
      method: "BROTH_MICRODILUTION",
      status: "DRAFT",
      revision: 1,
    });
    mocks.setUpdateMany.mockResolvedValue({ count: 1 });
    mocks.ruleCreate.mockResolvedValue({ id: "rule-1", drugName: "Drug X" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("adds a rule to DRAFT and increments revision", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(mocks.ruleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        breakpointSetId: "bps-1",
        standard: "CLSI",
        version: "2026.1",
      }),
    }));
    expect(mocks.setUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "DRAFT", revision: 1 }),
    }));
  });

  it("rejects rule creation after approval and audits the immutability violation", async () => {
    mocks.setFindFirst.mockResolvedValue({
      id: "bps-1",
      organizationId: "org-a",
      standard: "CLSI",
      version: "2026.1",
      organism: "E. coli",
      unit: "mg/L",
      method: "BROTH_MICRODILUTION",
      status: "APPROVED",
      revision: 2,
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(mocks.ruleCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "BREAKPOINT_IMMUTABILITY_VIOLATION", actorId: "admin-1" }),
    }));
  });

  it("rejects TECHNICIAN with 403", async () => {
    mocks.actor.role = "TECHNICIAN";
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
