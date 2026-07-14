import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    $executeRaw: vi.fn(),
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

import { buildBulkPlateWellUpsertSql } from "@/lib/plate-well-bulk-upsert";
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
    mocks.tx.$executeRaw.mockResolvedValue(96);
    mocks.tx.auditLog.create.mockResolvedValue({ id: "audit-1" });
    mocks.tx.idempotencyRecord.create.mockResolvedValue({ id: "idem-record-1" });
    mocks.recalculatePlateResults.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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
    expect(mocks.tx.plateWell.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1);
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
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("bulk upserts 96 wells with parameterized SQL instead of sequential Prisma upserts", async () => {
    const wells = Array.from({ length: 96 }, (_, index) => ({
      rowIndex: Math.floor(index / 12),
      columnIndex: index % 12,
      state: index % 2 === 0 ? "GROWTH" : "INHIBITED",
      source: "MANUAL",
    }));

    const response = await PUT(request(payload({ wells })), routeContext);

    expect(response.status).toBe(200);
    expect(mocks.tx.plateWell.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = mocks.tx.$executeRaw.mock.calls[0][0] as { strings?: string[]; values?: unknown[] };
    expect(sql.strings?.join(" ")).toContain('INSERT INTO "PlateWell"');
    expect(sql.strings?.join(" ")).toContain('"id"');
    expect(sql.strings?.join(" ")).toContain('ON CONFLICT ("plateId", "rowIndex", "columnIndex")');
    expect(sql.strings?.join(" ")).not.toContain('"id" = EXCLUDED."id"');
    expect(sql.strings?.join(" ")).toContain('::"WellState"');
    expect(sql.strings?.join(" ")).toContain('::"DataSource"');
    expect(sql.values).toHaveLength(96 * 12);
    const generatedIds = sql.values?.filter((value) =>
      typeof value === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    );
    expect(generatedIds).toHaveLength(96);
    expect(new Set(generatedIds).size).toBe(96);
    expect(sql.values).toContain("GROWTH");
    expect(sql.values).toContain("INHIBITED");
  });

  it("skips PlateWell bulk upsert when wells is empty", async () => {
    const response = await PUT(request(payload({ wells: [] })), routeContext);

    expect(response.status).toBe(200);
    expect(mocks.tx.plateWell.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled();
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

  it("builds a bulk upsert statement for 96 wells without embedding values into SQL text", () => {
    const confirmedAt = new Date("2026-07-14T01:02:03.000Z");
    const wells = Array.from({ length: 96 }, (_, index) => ({
      rowIndex: Math.floor(index / 12),
      columnIndex: index % 12,
      state: index % 2 === 0 ? "GROWTH" : "INHIBITED",
    }));

    const sql = buildBulkPlateWellUpsertSql({
      plateId: "plate-1",
      wells,
      confirmedByUserId: "user-a",
      confirmedAt,
      createId: (() => {
        let index = 0;
        return () => `well-id-${index++}`;
      })(),
    }) as { strings?: string[]; values?: unknown[] } | null;

    expect(sql).not.toBeNull();
    expect(sql?.strings?.join(" ")).toContain('INSERT INTO "PlateWell"');
    expect(sql?.strings?.join(" ")).toContain('"id"');
    expect(sql?.strings?.join(" ")).toContain('ON CONFLICT ("plateId", "rowIndex", "columnIndex")');
    expect(sql?.strings?.join(" ")).not.toContain('"id" = EXCLUDED."id"');
    expect(sql?.strings?.join(" ")).toContain('::"WellState"');
    expect(sql?.strings?.join(" ")).toContain('::"DataSource"');
    expect(sql?.strings?.join(" ")).toContain("::double precision");
    expect(sql?.strings?.join(" ")).toContain("::text");
    expect(sql?.strings?.join(" ")).not.toContain("plate-1");
    expect(sql?.strings?.join(" ")).not.toContain("user-a");
    expect(sql?.strings?.join(" ")).not.toContain("well-id-0");
    expect(sql?.values).toHaveLength(96 * 12);
    expect(sql?.values?.filter((value) => typeof value === "string" && value.startsWith("well-id-"))).toHaveLength(96);
    expect(new Set(sql?.values?.filter((value) => typeof value === "string" && value.startsWith("well-id-"))).size).toBe(96);
  });

  it("does not include debug details when research-public debug errors are disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEARCH_PUBLIC_MODE", "true");
    vi.stubEnv("RESEARCH_PUBLIC_DEBUG_ERRORS", "false");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.transaction.mockRejectedValueOnce(new Error("staging save failed"));

    const response = await PUT(request(payload({
      breakpointSetId: undefined,
      idempotencyKey: "secret-idem-key-123",
      expectedRevision: 0,
      wells: [],
    })), routeContext);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: { code: "INTERNAL_ERROR", message: "処理に失敗しました。" } });
  });

  it("returns only secret-safe debug details when explicitly enabled for research-public staging", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEARCH_PUBLIC_MODE", "true");
    vi.stubEnv("RESEARCH_PUBLIC_DEBUG_ERRORS", "true");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(
      new Error(
        "save failed for secret-idem-key-123 using postgresql://user:password@example.test/db Authorization: Bearer abc.def Cookie: sid=secret",
      ),
      {
        code: "P2028",
        meta: {
          modelName: "Plate",
          table: "Plate",
          target: ["id"],
          databaseUrl: "postgresql://should-not-appear",
        },
      },
    );
    mocks.transaction.mockRejectedValueOnce(error);

    const response = await PUT(request(payload({
      breakpointSetId: undefined,
      idempotencyKey: "secret-idem-key-123",
      expectedRevision: 0,
      wells: [],
    }), {
      authorization: "Bearer request-token",
      cookie: "session=request-cookie",
    }), routeContext);
    const body = await response.json();
    const serialized = JSON.stringify(body);
    const consoleOutput = consoleError.mock.calls.map((call) => String(call[0])).join("\n");

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.debug).toMatchObject({
      route: "PUT /api/plates/[id]",
      error: {
        name: "Error",
        code: "P2028",
        prismaMeta: { modelName: "Plate", table: "Plate", target: ["id"] },
      },
      context: {
        actorUserIdPresent: true,
        plateId: "plate-1",
        idempotencyKeyPresent: true,
        expectedRevision: 0,
        wellsCount: 0,
        breakpointSetIdPresent: false,
      },
    });
    expect(body.error.debug.requestDebugId).toEqual(expect.any(String));
    expect(serialized).not.toContain("secret-idem-key-123");
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("abc.def");
    expect(serialized).not.toContain("request-token");
    expect(serialized).not.toContain("request-cookie");
    expect(serialized).not.toContain("databaseUrl");
    expect(consoleOutput).not.toContain("secret-idem-key-123");
    expect(consoleOutput).not.toContain("postgresql://");
    expect(consoleOutput).not.toContain("abc.def");
    expect(consoleOutput).not.toContain("request-token");
    expect(consoleOutput).not.toContain("request-cookie");
  });
});
