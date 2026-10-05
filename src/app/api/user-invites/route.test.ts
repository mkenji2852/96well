import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "admin-1", organizationId: "org-a", role: "ADMIN" as "ADMIN" | "TECHNICIAN", sessionId: "session-1" };
  const userFindUnique = vi.fn();
  const inviteFindUnique = vi.fn();
  const inviteCreate = vi.fn();
  const inviteUpdate = vi.fn();
  const auditCreate = vi.fn();
  const tx = {
    user: { findUnique: userFindUnique },
    userInvite: { findUnique: inviteFindUnique, create: inviteCreate, update: inviteUpdate },
    auditLog: { create: auditCreate },
  };
  return {
    actor,
    userFindUnique,
    inviteFindUnique,
    inviteCreate,
    inviteUpdate,
    auditCreate,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import { POST } from "./route";

describe("POST /api/user-invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.role = "ADMIN";
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.inviteFindUnique.mockResolvedValue(null);
    mocks.inviteCreate.mockResolvedValue({
      id: "invite-1",
      organizationId: "org-a",
      email: "new.user@example.test",
      role: "TECHNICIAN",
      expiresAt: null,
    });
    mocks.inviteUpdate.mockResolvedValue({
      id: "invite-1",
      organizationId: "org-a",
      email: "new.user@example.test",
      role: "TECHNICIAN",
      expiresAt: null,
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("creates an invite in the actor organization and returns the token once", async () => {
    const response = await POST(new Request("https://research.example.test/api/user-invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: " New.User@Example.TEST ", role: "TECHNICIAN" }),
    }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.invite.inviteToken).toEqual(expect.any(String));
    expect(body.invite.inviteUrl).toContain("invite=");
    expect(mocks.inviteCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-a",
        email: "new.user@example.test",
        role: "TECHNICIAN",
        inviteTokenHash: expect.any(String),
      }),
    }));
  });

  it("rejects participant invite creation by non-admin users", async () => {
    mocks.actor.role = "TECHNICIAN";
    const response = await POST(new Request("https://research.example.test/api/user-invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.test", role: "TECHNICIAN" }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.inviteCreate).not.toHaveBeenCalled();
  });

  it("does not create an invite for an existing user email", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "user-1", organizationId: "org-a" });
    const response = await POST(new Request("https://research.example.test/api/user-invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.test", role: "TECHNICIAN" }),
    }));
    expect(response.status).toBe(409);
    expect(mocks.inviteCreate).not.toHaveBeenCalled();
  });
});
