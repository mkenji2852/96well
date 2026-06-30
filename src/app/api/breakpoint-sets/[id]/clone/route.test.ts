import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "admin-1", organizationId: "org-a", role: "ADMIN", sessionId: "session-1" };
  const accessFindFirst = vi.fn();
  const setFindFirst = vi.fn();
  const setCreate = vi.fn();
  const auditCreate = vi.fn();
  const tx = { breakpointSet: { findFirst: setFindFirst, create: setCreate }, auditLog: { create: auditCreate } };
  return {
    actor, accessFindFirst, setFindFirst, setCreate, auditCreate,
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

const context = { params: Promise.resolve({ id: "bps-old" }) };
const request = () => new Request("http://localhost/api/breakpoint-sets/bps-old/clone", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ version: "2027.1" }),
});

describe("POST /api/breakpoint-sets/:id/clone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accessFindFirst.mockResolvedValue({ id: "bps-old" });
    mocks.setFindFirst
      .mockResolvedValueOnce({
        id: "bps-old", organizationId: "org-a", standard: "CLSI", version: "2026.1",
        organism: "E. coli", unit: "mg/L", method: "BROTH_MICRODILUTION", status: "APPROVED",
        effectiveFrom: null, effectiveTo: null, sourceDocumentReference: null, sourceDocumentChecksum: null,
        contentHash: "a".repeat(64),
        rules: [{
          id: "rule-old", drugName: "Drug X", organism: "E. coli", susceptibleMax: 1, resistantMin: 4,
          intermediateMin: null, intermediateMax: null, unit: "mg/L", method: "BROTH_MICRODILUTION", exceptionJson: null,
        }],
      })
      .mockResolvedValueOnce(null);
    mocks.setCreate.mockResolvedValue({
      id: "bps-new", standard: "CLSI", version: "2027.1", status: "DRAFT",
      supersedesBreakpointSetId: "bps-old", contentHash: null, revision: 0,
      rules: [{ id: "rule-new", drugName: "Drug X", susceptibleMax: 1, resistantMin: 4 }],
      _count: { rules: 1 },
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("creates an independent DRAFT linked to the immutable source", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(mocks.setCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        version: "2027.1",
        status: "DRAFT",
        supersedesBreakpointSetId: "bps-old",
        rules: { create: [expect.objectContaining({ version: "2027.1", drugName: "Drug X" })] },
      }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "BREAKPOINT_SET_CLONED" }),
    }));
  });
});
