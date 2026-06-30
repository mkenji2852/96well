import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => {
  const actor = { userId: "user-a", organizationId: "org-a", role: "TECHNICIAN" as const, sessionId: "session-a" };
  const tx = {
    plate: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    plateWell: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    idempotencyRecord: { create: vi.fn() },
  };
  return {
    actor,
    tx,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    idempotencyFindUnique: vi.fn(),
    auditFindFirst: vi.fn(),
    auditCreateOutside: vi.fn(),
    requirePermission: vi.fn(),
    requirePlateAccess: vi.fn(),
    recalculatePlateResults: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: vi.fn(async () => mocks.actor) }));
vi.mock("@/lib/rbac", () => ({
  requirePermission: mocks.requirePermission,
  requirePlateAccess: mocks.requirePlateAccess,
}));
vi.mock("@/lib/plate-results", async () => {
  const actual = await vi.importActual<typeof import("@/lib/plate-results")>("@/lib/plate-results");
  return {
    ...actual,
    recalculatePlateResults: mocks.recalculatePlateResults,
  };
});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    idempotencyRecord: { findUnique: mocks.idempotencyFindUnique },
    auditLog: { findFirst: mocks.auditFindFirst, create: mocks.auditCreateOutside },
  },
}));

import { PUT } from "./route";

const routeContext = { params: Promise.resolve({ id: "plate-1" }) };

const plate = (revision = 3) => ({
  id: "plate-1",
  organizationId: "org-a",
  status: "DRAFT",
  wellRevision: revision,
  updatedAt: new Date("2026-06-23T01:02:03.000Z"),
  sample: { id: "sample-1" },
  drugs: [],
  wells: [{ rowIndex: 0, columnIndex: 0, state: "UNREAD" }],
});

const payload = (patch: Record<string, unknown> = {}) => ({
  breakpointSetId: "bps-1",
  expectedRevision: 3,
  idempotencyKey: "idem-123456",
  wells: [{ rowIndex: 0, columnIndex: 0, state: "GROWTH", source: "MANUAL" }],
  ...patch,
});

function expectedRequestHash(body = payload()): string {
  const requestBody = body as ReturnType<typeof payload>;
  return createHash("sha256").update(JSON.stringify({
    plateId: "plate-1",
    expectedRevision: requestBody.expectedRevision,
    breakpointSetId: requestBody.breakpointSetId,
    breakpointChangeReason: null,
    wells: requestBody.wells,
  })).digest("hex");
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/plates/plate-1", {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/plates/[id] offline sync safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.idempotencyFindUnique.mockResolvedValue(null);
    mocks.auditFindFirst.mockResolvedValue({ actorId: "user-latest", actorLabel: "user-latest" });
    mocks.tx.plate.findFirst.mockResolvedValue(plate(3));
    mocks.tx.plate.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.plate.update.mockResolvedValue({ ...plate(4), status: "DRAFT" });
    mocks.tx.plateWell.upsert.mockResolvedValue({});
    mocks.tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
    mocks.tx.idempotencyRecord.create.mockResolvedValue({ id: "idem-record-1" });
    mocks.recalculatePlateResults.mockResolvedValue([]);
  });

  it("requires an explicit base revision", async () => {
    const response = await PUT(request(payload({ expectedRevision: undefined, idempotencyKey: undefined })), routeContext);

    expect(response.status).toBe(428);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("accepts If-Match as the base revision and records idempotent success", async () => {
    const response = await PUT(
      request(payload({ expectedRevision: undefined }), { "if-match": '"3"', "idempotency-key": "idem-123456" }),
      routeContext,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.wellRevision).toBe(4);
    expect(mocks.tx.plate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ wellRevision: 3 }),
      data: { wellRevision: { increment: 1 } },
    }));
    expect(mocks.tx.plateWell.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.tx.idempotencyRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorUserId: "user-a", organizationId: "org-a", key: "idem-123456" }),
    }));
  });

  it("returns a conflict payload and does not write wells when the server revision changed", async () => {
    mocks.tx.plate.findFirst.mockResolvedValue(plate(4));

    const response = await PUT(request(payload()), routeContext);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("REVISION_CONFLICT");
    expect(body.conflict).toMatchObject({
      plateId: "plate-1",
      clientBaseRevision: 3,
      serverRevision: 4,
      serverWellRevision: 4,
      serverUpdatedBy: "user-latest",
    });
    expect(body.conflict.serverWells).toEqual([{ rowIndex: 0, columnIndex: 0, state: "UNREAD" }]);
    expect(mocks.tx.plateWell.upsert).not.toHaveBeenCalled();
  });

  it("returns the stored result for a duplicate idempotency key with the same request hash", async () => {
    mocks.idempotencyFindUnique.mockResolvedValue({
      key: "idem-123456",
      actorUserId: "user-a",
      organizationId: "org-a",
      plateId: "plate-1",
      requestHash: expectedRequestHash(),
      statusCode: 200,
      responseJson: { plateId: "plate-1", status: "DRAFT", wellRevision: 8, results: [] },
    });
    const response = await PUT(request(payload()), routeContext);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.wellRevision).toBe(8);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects idempotency key reuse with a different body", async () => {
    mocks.idempotencyFindUnique.mockResolvedValue({
      key: "idem-123456",
      actorUserId: "user-a",
      organizationId: "org-a",
      plateId: "plate-1",
      requestHash: "different-hash",
      statusCode: 200,
      responseJson: { plateId: "plate-1", status: "DRAFT", wellRevision: 8, results: [] },
    });

    const response = await PUT(request(payload({ wells: [{ rowIndex: 0, columnIndex: 0, state: "INHIBITED", source: "MANUAL" }] })), routeContext);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
