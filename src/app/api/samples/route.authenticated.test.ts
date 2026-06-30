import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "user-a", organizationId: "org-a", role: "TECHNICIAN" as const, sessionId: "session-a" };
  const auditCreate = vi.fn();
  const sampleCreate = vi.fn();
  const tx = { sample: { create: sampleCreate }, auditLog: { create: auditCreate } };
  return {
    actor,
    auditCreate,
    sampleCreate,
    tx,
    findMany: vi.fn(),
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    sample: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}));

import { GET, POST } from "./route";

describe("/api/samples organization authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.sampleCreate.mockResolvedValue({
      id: "sample-1",
      organizationId: "org-a",
      createdByUserId: "user-a",
      sampleCode: "S-001",
      organism: null,
      notes: null,
      plates: [{ id: "plate-1", drugs: [] }],
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("filters the sample list to the authenticated organization", async () => {
    const response = await GET(new Request("http://localhost/api/samples"));
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
  });

  it("sets creator and audit actor from the authenticated session", async () => {
    const response = await POST(new Request("http://localhost/api/samples", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sampleCode: "S-001",
        createdByUserId: "attacker",
        organizationId: "org-other",
        drugs: [{ drugName: "Drug X", unit: "mg/L", concentrations: [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] }],
      }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.sampleCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ createdByUserId: "user-a", organizationId: "org-a" }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: "user-a", actorLabel: "user-a" }),
    }));
  });
});

