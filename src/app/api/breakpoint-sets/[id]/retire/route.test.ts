import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "admin-1", organizationId: "org-a", role: "ADMIN", sessionId: "session-1" };
  const accessFindFirst = vi.fn();
  const setFindFirst = vi.fn();
  const setUpdateMany = vi.fn();
  const setFindUniqueOrThrow = vi.fn();
  const auditCreate = vi.fn();
  const tx = {
    breakpointSet: { findFirst: setFindFirst, updateMany: setUpdateMany, findUniqueOrThrow: setFindUniqueOrThrow },
    auditLog: { create: auditCreate },
  };
  return {
    actor, accessFindFirst, setFindFirst, setUpdateMany, setFindUniqueOrThrow, auditCreate,
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
const request = (reason = "superseded by 2027") => new Request("http://localhost/api/breakpoint-sets/bps-1/retire", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ expectedRevision: 3, reason }),
});

describe("POST /api/breakpoint-sets/:id/retire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessFindFirst.mockResolvedValue({ id: "bps-1" });
    mocks.setFindFirst.mockResolvedValue({
      id: "bps-1", organizationId: "org-a", status: "APPROVED", revision: 3,
      version: "2026.1", contentHash: "a".repeat(64), _count: { rules: 1 },
    });
    mocks.setUpdateMany.mockResolvedValue({ count: 1 });
    mocks.setFindUniqueOrThrow.mockResolvedValue({
      id: "bps-1", organizationId: "org-a", status: "RETIRED", revision: 4,
      version: "2026.1", contentHash: "a".repeat(64), _count: { rules: 1 },
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("retires APPROVED without deleting historical references and audits reason", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.setUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "RETIRED", retireReason: "superseded by 2027", retiredByUserId: "admin-1" }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "BREAKPOINT_SET_RETIRED" }),
    }));
  });

  it("requires a non-empty retirement reason", async () => {
    const response = await POST(request(""), context);
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
