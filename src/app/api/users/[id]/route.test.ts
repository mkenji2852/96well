import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "admin-1", organizationId: "org-a", role: "ADMIN" as "ADMIN" | "TECHNICIAN", sessionId: "session-1" };
  const findFirst = vi.fn();
  const update = vi.fn();
  const auditCreate = vi.fn();
  const tx = { user: { findFirst, update }, auditLog: { create: auditCreate } };
  return {
    actor,
    findFirst,
    update,
    auditCreate,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import { PATCH } from "./route";

const context = (id = "user-2") => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/users/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.role = "ADMIN";
    mocks.findFirst.mockResolvedValue({
      id: "user-2",
      name: "Research User",
      email: "research@example.test",
      externalSubject: "subject-2",
      role: "TECHNICIAN",
      active: true,
      createdAt: new Date("2026-07-15T00:00:00Z"),
    });
    mocks.update.mockResolvedValue({
      id: "user-2",
      name: "Research User",
      email: "research@example.test",
      externalSubject: "subject-2",
      role: "REVIEWER",
      active: true,
      createdAt: new Date("2026-07-15T00:00:00Z"),
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("updates role inside the actor organization", async () => {
    const response = await PATCH(new Request("http://localhost/api/users/user-2", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "REVIEWER" }),
    }), context());
    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "user-2", organizationId: "org-a" },
    }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: "REVIEWER" }),
    }));
  });

  it("prevents the current admin from disabling themselves", async () => {
    const response = await PATCH(new Request("http://localhost/api/users/admin-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    }), context("admin-1"));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
