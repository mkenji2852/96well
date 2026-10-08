import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const actor = { userId: "user-a", organizationId: "org-a", role: "TECHNICIAN", sessionId: "session-a" };
  const tx = { sample: { findMany: vi.fn() }, plate: { findMany: vi.fn() }, breakpointSet: { findMany: vi.fn() }, exportRecord: { create: vi.fn() }, auditLog: { create: vi.fn() } };
  return { actor, tx, auth: vi.fn(), audit: vi.fn(), build: vi.fn(), transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
});
vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction, auditLog: { create: mocks.audit } } }));
vi.mock("@/lib/excel", () => ({ buildPopulationWorkbook: mocks.build }));
import { AuthError } from "@/lib/api-auth-error";
import { POST } from "./route";

const request = (from = "SMP-2", to = "SMP-10") => new Request("http://localhost/api/export/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from, to }) });
const plate = (sampleId: string, name: string) => ({ id: `plate-${sampleId}`, sampleId, name: "Research plate", createdAt: new Date(), updatedAt: new Date(), wellRevision: 3, resultRevision: 0, sample: { id: sampleId, sampleCode: name, organism: "E. coli" }, drugs: [], wells: [], rawMics: [] });

describe("Sample-ID range export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(mocks.actor);
    mocks.tx.sample.findMany.mockResolvedValue([{ id: "s1", sampleCode: "SMP-1" }, { id: "s2", sampleCode: "SMP-2" }, { id: "s10", sampleCode: "SMP-10" }, { id: "s11", sampleCode: "SMP-11" }]);
    mocks.tx.plate.findMany.mockResolvedValue([plate("s10", "SMP-10"), plate("s2", "SMP-2")]);
    mocks.tx.breakpointSet.findMany.mockResolvedValue([]);
    mocks.build.mockResolvedValue(Buffer.from("synthetic-xlsx"));
  });
  it("exports an inclusive natural-order range inside the authenticated organization", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.tx.sample.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a" } }));
    expect(mocks.tx.plate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org-a", sampleId: { in: ["s2", "s10"] } } }));
    expect(mocks.build.mock.calls[0][0].map((item: { plate: { sampleId: string } }) => item.plate.sampleId)).toEqual(["s2", "s10"]);
    expect(mocks.tx.exportRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorUserId: "user-a", organizationId: "org-a", profile: "ANONYMIZED", metadataJson: expect.objectContaining({ sampleCount: 2, snapshots: expect.any(Array) }) }) }));
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("content-disposition")).not.toContain("SMP-");
  });
  it("refuses unauthenticated requests before touching sample data", async () => {
    mocks.auth.mockRejectedValueOnce(new AuthError("UNAUTHENTICATED", "認証が必要です。"));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.tx.sample.findMany).not.toHaveBeenCalled();
  });
  it("rejects reversed ranges and empty ranges", async () => {
    expect((await POST(request("SMP-10", "SMP-2"))).status).toBe(400);
    expect((await POST(request("SMP-50", "SMP-60"))).status).toBe(404);
  });
  it("does not silently truncate a range above 50 samples", async () => {
    mocks.tx.sample.findMany.mockResolvedValue(Array.from({ length: 51 }, (_, index) => ({ id: `s-${index}`, sampleCode: `SMP-${index}` })));
    expect((await POST(request("SMP-0", "SMP-100"))).status).toBe(400);
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("refuses mixed breakpoint sets without weakening regular export policy", async () => {
    mocks.tx.plate.findMany.mockResolvedValue([
      { ...plate("s2", "SMP-2"), rawMics: [{ id: "raw-1", breakpointSetId: "set-1", interpretations: [] }] },
      { ...plate("s10", "SMP-10"), rawMics: [{ id: "raw-2", breakpointSetId: "set-2", interpretations: [] }] },
    ]);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("MIXED_BREAKPOINT_SETS");
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("records failure and returns no download when workbook generation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.build.mockRejectedValueOnce(new Error("private connection information"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private connection information");
    expect(mocks.tx.exportRecord.create).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "EXPORT_FAILED" }) }));
  });
});
