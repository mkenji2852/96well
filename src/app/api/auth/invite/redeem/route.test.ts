import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const inviteFindUnique = vi.fn();
  const userFindUnique = vi.fn();
  const userCreate = vi.fn();
  const inviteUpdateMany = vi.fn();
  const sessionCreate = vi.fn();
  const auditCreateMany = vi.fn();
  const tx = {
    userInvite: { findUnique: inviteFindUnique, updateMany: inviteUpdateMany },
    user: { findUnique: userFindUnique, create: userCreate },
    userSession: { create: sessionCreate },
    auditLog: { createMany: auditCreateMany },
  };
  return {
    inviteFindUnique,
    userFindUnique,
    userCreate,
    inviteUpdateMany,
    sessionCreate,
    auditCreateMany,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import { POST } from "./route";

function validInvite() {
  return {
    id: "invite-1",
    organizationId: "org-a",
    email: "new.user@example.test",
    role: "TECHNICIAN",
    active: true,
    expiresAt: null,
    redeemedAt: null,
    organization: { active: true },
  };
}

describe("POST /api/auth/invite/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inviteFindUnique.mockResolvedValue(validInvite());
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.userCreate.mockResolvedValue({
      id: "user-1",
      organizationId: "org-a",
      role: "TECHNICIAN",
      active: true,
      organization: { active: true },
    });
    mocks.inviteUpdateMany.mockResolvedValue({ count: 1 });
    mocks.sessionCreate.mockResolvedValue({ id: "session-1" });
    mocks.auditCreateMany.mockResolvedValue({ count: 2 });
  });

  it("redeems a valid invite and creates a password account in the invite organization", async () => {
    const response = await POST(new Request("https://research.example.test/api/auth/invite/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: " New.User@Example.TEST ",
        inviteToken: "invite-token-with-enough-length",
        password: "long-enough-password",
      }),
    }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.user).toMatchObject({ userId: "user-1", organizationId: "org-a", role: "TECHNICIAN" });
    expect(response.headers.get("set-cookie")).toContain("micplate_session=");
    expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-a",
        email: "new.user@example.test",
        role: "TECHNICIAN",
        passwordCredential: { create: { passwordHash: expect.any(String) } },
      }),
    }));
  });

  it("fails closed for an invalid invite token", async () => {
    mocks.inviteFindUnique.mockResolvedValue(null);
    const response = await POST(new Request("https://research.example.test/api/auth/invite/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new.user@example.test",
        inviteToken: "invalid-token-with-enough-length",
        password: "long-enough-password",
      }),
    }));
    expect(response.status).toBe(401);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it("does not redeem an invite for an existing email user", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: "existing-user" });
    const response = await POST(new Request("https://research.example.test/api/auth/invite/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new.user@example.test",
        inviteToken: "invite-token-with-enough-length",
        password: "long-enough-password",
      }),
    }));
    expect(response.status).toBe(409);
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });
});
