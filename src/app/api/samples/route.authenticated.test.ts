import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => vi.restoreAllMocks());
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

  function creationRequest() {
    return new Request("http://localhost/api/samples", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleCode: "RESEARCH-001", drugs: Array.from({ length: 96 }, (_, index) => ({
        drugName: `Drug ${index}`, unit: "mg/L",
        wells: [{ rowIndex: Math.floor(index / 12), columnIndex: index % 12, concentration: index + 1 }],
      })) }),
    });
  }

  it("creates flexible drug assignments in one batch with an explicit transaction timeout", async () => {
    const response = await POST(creationRequest());
    expect(response.status).toBe(201);
    expect(mocks.sampleCreate).toHaveBeenCalledTimes(1);
    const create = mocks.sampleCreate.mock.calls[0][0];
    const drugs = create.data.plates.create.drugs;
    expect(drugs.create).toBeUndefined();
    expect(drugs.createMany.data).toHaveLength(96);
    expect(drugs.createMany.data[95]).toEqual({
      rowIndex: 95, drugName: "Drug 95", unit: "mg/L",
      concentrations: { mode: "wells", wells: [{ rowIndex: 7, columnIndex: 11, concentration: 96 }] },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 5000, timeout: 20000 });
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
  });

  it("logs a safe failure reference without exposing Prisma messages or credentials", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.sampleCreate.mockRejectedValueOnce(Object.assign(new Error(
      "postgresql://secret-user:secret-password@private.example/db Authorization: Bearer secret-token",
    ), { code: "P2028" }));
    const response = await POST(creationRequest());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.message).toContain("時間内に完了しませんでした");
    expect(body.error.requestDebugId).toBeTruthy();
    expect(log).toHaveBeenCalledWith({
      event: "SAMPLE_CREATION_FAILED", route: "POST /api/samples", stage: "create-sample-plate",
      errorCode: "P2028", requestDebugId: body.error.requestDebugId,
    });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    const diagnostic = JSON.stringify({ body, logs: log.mock.calls });
    expect(diagnostic).not.toMatch(/secret-password|secret-token|private\.example|postgresql:\/\//);
  });

  it("does not return success when the audit write fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.auditCreate.mockRejectedValueOnce(Object.assign(new Error("private DB information"), { code: "P2003" }));
    const response = await POST(creationRequest());
    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ stage: "create-audit", errorCode: "P2003" }));
    expect(JSON.stringify(await response.json())).not.toContain("private DB information");
  });

  it("preserves the duplicate Sample-ID conflict response", async () => {
    mocks.sampleCreate.mockRejectedValueOnce({ code: "P2002" });
    const response = await POST(creationRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "SAMPLE_CODE_EXISTS" });
  });

  it("identifies the legacy drug-slot constraint without exposing the database message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.sampleCreate.mockRejectedValueOnce({ code: "P2004", meta: {
      database_error: 'violates check constraint "PlateDrug_row_range_check" secret-data',
    } });
    const response = await POST(creationRequest());
    const body = await response.json();
    expect(body.error.code).toBe("PLATE_LAYOUT_DATABASE_OUTDATED");
    expect(body.error.message).toContain("migration");
    expect(JSON.stringify(body)).not.toContain("secret-data");
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ constraint: "PlateDrug_row_range_check" }));
  });
});

