import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    actor: { userId: "user-1", organizationId: "org-a", role: "TECHNICIAN" as "TECHNICIAN" | "ADMIN", sessionId: "session-1" },
  };
  const breakpointCreate = vi.fn();
  const breakpointSetFindFirst = vi.fn();
  const breakpointSetCreate = vi.fn();
  const auditCreate = vi.fn();
  const tx = {
    breakpointSet: { findFirst: breakpointSetFindFirst, create: breakpointSetCreate },
    breakpointRule: { create: breakpointCreate },
    auditLog: { create: auditCreate },
  };
  return {
    state,
    breakpointCreate,
    breakpointSetFindFirst,
    breakpointSetCreate,
    auditCreate,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.state.actor) }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));

import { POST } from "./route";

const request = () => new Request("http://localhost/api/breakpoints", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    drugName: "Drug X",
    organism: "E. coli",
    standard: "CLSI",
    version: "2026",
    susceptibleMax: 1,
    resistantMin: 4,
    unit: "mg/L",
  }),
});

describe("POST /api/breakpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.breakpointSetFindFirst.mockResolvedValue(null);
    mocks.breakpointSetCreate.mockResolvedValue({ id: "bps-1" });
    mocks.breakpointCreate.mockResolvedValue({
      id: "rule-1",
      organizationId: "org-a",
      breakpointSetId: "bps-1",
      drugName: "Drug X",
      organism: "E. coli",
      standard: "CLSI",
      version: "2026",
      susceptibleMax: 1,
      resistantMin: 4,
      unit: "mg/L",
    });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  });

  it("allows TECHNICIAN to create a research breakpoint draft", async () => {
    mocks.state.actor.role = "TECHNICIAN";
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.breakpointCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-a", breakpointSetId: "bps-1" }),
    }));
  });

  it("allows ADMIN and fixes organization/audit actor from the session", async () => {
    mocks.state.actor.role = "ADMIN";
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.breakpointCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-a", breakpointSetId: "bps-1" }),
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: "user-1", actorLabel: "user-1" }),
    }));
  });
});
