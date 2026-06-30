import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { userId: "reviewer-1", organizationId: "org-a", role: "REVIEWER" as const, sessionId: "session-1" };
  const plateFindFirst = vi.fn();
  const transaction = vi.fn();
  const auditCreate = vi.fn();
  return { actor, plateFindFirst, transaction, auditCreate };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    plate: { findFirst: mocks.plateFindFirst },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "./route";

describe("POST override image well", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.plateFindFirst.mockResolvedValue({ id: "plate-1" });
  });

  it("rejects override without a reason", async () => {
    const response = await POST(new Request("http://localhost/api/plates/plate-1/image-assessments/assessment-1/override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rowIndex: 0, columnIndex: 0, state: "INHIBITED" }),
    }), { params: Promise.resolve({ id: "plate-1", assessmentId: "assessment-1" }) });

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
