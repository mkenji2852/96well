import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "tech-1", organizationId: "org-a", role: "TECHNICIAN" as "TECHNICIAN" | "ADMIN", sessionId: "session-1" };
  const findMany = vi.fn();
  const findFirst = vi.fn();
  const create = vi.fn();
  const auditCreate = vi.fn();
  const tx = { breakpointSet: { create }, auditLog: { create: auditCreate } };
  return {
    actor, findMany, findFirst, create, auditCreate,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    breakpointSet: { findMany: mocks.findMany, findFirst: mocks.findFirst },
    $transaction: mocks.transaction,
  },
}));

import { GET, POST } from "./route";

describe("/api/breakpoint-sets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.role = "TECHNICIAN";
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue({
      id: "bps-1", standard: "CLSI", version: "2027.1", organism: "E. coli", unit: "mg/L",
      method: "BROTH_MICRODILUTION", status: "DRAFT", revision: 0, createdAt: new Date(), updatedAt: new Date(),
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("lists only effective APPROVED sets for technician selection", async () => {
    const response = await GET(new Request("http://localhost/api/breakpoint-sets?selectable=true&organism=E.%20coli"));
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-a",
        status: "APPROVED",
        AND: expect.any(Array),
      }),
    }));
  });

  it("lets TECHNICIAN create a DRAFT set for research configuration", async () => {
    const response = await POST(new Request("http://localhost/api/breakpoint-sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ standard: "CLSI", version: "2027.1", organism: "E. coli", unit: "mg/L", method: "BROTH_MICRODILUTION" }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-a",
        createdByUserId: "tech-1",
        status: "DRAFT",
      }),
    }));
  });

  it("creates DRAFT for ADMIN and fixes organization/creator from the session", async () => {
    mocks.actor.role = "ADMIN";
    const response = await POST(new Request("http://localhost/api/breakpoint-sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ standard: "CLSI", version: "2027.1", organism: "E. coli", unit: "mg/L", method: "BROTH_MICRODILUTION" }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-a",
        createdByUserId: "tech-1",
        status: "DRAFT",
      }),
    }));
  });
});
