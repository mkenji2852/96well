import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "admin-1", organizationId: "org-a", role: "ADMIN" as "ADMIN" | "TECHNICIAN", sessionId: "session-1" };
  const findMany = vi.fn();
  const userCreate = vi.fn();
  const auditCreate = vi.fn();
  const tx = { user: { create: userCreate }, auditLog: { create: auditCreate } };
  return {
    actor,
    findMany,
    userCreate,
    auditCreate,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}));

import { GET, POST } from "./route";

describe("/api/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.role = "ADMIN";
    mocks.findMany.mockResolvedValue([]);
    mocks.userCreate.mockResolvedValue({
      id: "user-2",
      name: "Research User",
      email: "research@example.test",
      externalSubject: "cf-subject-2",
      role: "TECHNICIAN",
      active: true,
      createdAt: new Date("2026-07-15T00:00:00Z"),
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("rejects non-admin user management", async () => {
    mocks.actor.role = "TECHNICIAN";
    const response = await GET(new Request("http://localhost/api/users"));
    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("creates a participant in the actor organization without trusting client organization", async () => {
    const response = await POST(new Request("http://localhost/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Research User",
        email: "research@example.test",
        externalSubject: "cf-subject-2",
        role: "TECHNICIAN",
        organizationId: "attacker-org",
      }),
    }));
    expect(response.status).toBe(400);

    const validResponse = await POST(new Request("http://localhost/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Research User",
        email: "research@example.test",
        externalSubject: "cf-subject-2",
        role: "TECHNICIAN",
      }),
    }));
    expect(validResponse.status).toBe(201);
    expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-a",
        externalSubject: "cf-subject-2",
        role: "TECHNICIAN",
      }),
    }));
  });
});
