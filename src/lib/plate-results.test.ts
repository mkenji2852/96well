import { describe, expect, it } from "vitest";
import { recalculatePlateResults, ResultCalculationError } from "./plate-results";
import type { AuthenticatedActor } from "./auth";
import { calculateBreakpointContentHash } from "./breakpoint-lifecycle";

const actor: AuthenticatedActor = {
  userId: "user-1",
  organizationId: "org-a",
  role: "REVIEWER",
  sessionId: "session-1",
};

function concentrations() {
  return [64, 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125];
}

function finalWells(states: string[], source = "MANUAL") {
  return states.map((state, columnIndex) => ({ rowIndex: 0, columnIndex, state, source }));
}

function createTx(options: {
  wells?: Array<{ rowIndex: number; columnIndex: number; state: string; source: string }>;
  conflict?: boolean;
  breakpointSetApproved?: boolean;
  breakpointSetId?: string;
  breakpointRule?: { susceptibleMax: number; resistantMin: number; version?: string };
} = {}) {
  const state = {
    rawMics: [] as Array<Record<string, any>>,
    sirs: [] as Array<Record<string, any>>,
    audits: [] as Array<Record<string, any>>,
    rawCounter: 0,
    sirCounter: 0,
    plate: {
      id: "plate-1",
      organizationId: "org-a",
      resultRevision: 0,
      wellRevision: 1,
      lastBreakpointSetId: null,
      sample: { organism: "E. coli" },
      drugs: [{ id: "drug-1", rowIndex: 0, drugName: "Drug X", unit: "mg/L", concentrations: concentrations() }],
      wells: options.wells ?? finalWells([
        "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED",
        "GROWTH", "GROWTH", "GROWTH", "GROWTH", "GROWTH", "GROWTH",
      ]),
    },
    breakpointSet: {
      id: options.breakpointSetId ?? "bps-1",
      standard: "CLSI",
      version: options.breakpointRule?.version ?? "2026.1",
      organism: "E. coli",
      unit: "mg/L",
      method: "BROTH_MICRODILUTION",
      status: options.breakpointSetApproved === false ? "DRAFT" : "APPROVED",
      effectiveFrom: null,
      effectiveTo: null,
      sourceDocumentReference: null,
      sourceDocumentChecksum: null,
      contentHash: "",
      rules: [{
        id: `rule-${options.breakpointSetId ?? "bps-1"}`,
        drugName: "Drug X",
        organism: "E. coli",
        standard: "CLSI",
        version: options.breakpointRule?.version ?? "2026.1",
        susceptibleMax: options.breakpointRule?.susceptibleMax ?? 2,
        resistantMin: options.breakpointRule?.resistantMin ?? 8,
        intermediateMin: null,
        intermediateMax: null,
        unit: "mg/L",
        method: "BROTH_MICRODILUTION",
        exceptionJson: null,
      }],
    },
  };
  state.breakpointSet.contentHash = calculateBreakpointContentHash(state.breakpointSet);

  const tx = {
    plate: {
      findFirst: async ({ where }: any) => where.id === state.plate.id && where.organizationId === state.plate.organizationId ? state.plate : null,
      updateMany: async () => {
        if (options.conflict) return { count: 0 };
        state.plate.resultRevision += 1;
        return { count: 1 };
      },
    },
    breakpointSet: {
      findFirst: async ({ where }: any) => {
        if (where.id !== state.breakpointSet.id || state.breakpointSet.status !== "APPROVED") return null;
        return state.breakpointSet;
      },
    },
    rawMic: {
      findFirst: async ({ where }: any) =>
        state.rawMics.find((raw) => raw.plateId === where.plateId && raw.plateDrugId === where.plateDrugId && raw.status === where.status) ?? null,
      updateMany: async ({ where, data }: any) => {
        const raw = state.rawMics.find((item) => item.id === where.id && item.status === where.status);
        if (!raw) return { count: 0 };
        Object.assign(raw, data);
        return { count: 1 };
      },
      create: async ({ data }: any) => {
        if (state.rawMics.some((raw) => raw.plateId === data.plateId && raw.plateDrugId === data.plateDrugId && raw.status === "CURRENT")) {
          throw new Error("duplicate current RawMic");
        }
        const raw = { id: `raw-${++state.rawCounter}`, ...data };
        state.rawMics.push(raw);
        return raw;
      },
    },
    sirInterpretation: {
      findFirst: async ({ where }: any) =>
        state.sirs.find((sir) => sir.plateId === where.plateId && sir.plateDrugId === where.plateDrugId && sir.status === where.status) ?? null,
      updateMany: async ({ where, data }: any) => {
        const sir = state.sirs.find((item) => item.id === where.id && item.status === where.status);
        if (!sir) return { count: 0 };
        Object.assign(sir, data);
        return { count: 1 };
      },
      create: async ({ data }: any) => {
        if (state.sirs.some((sir) => sir.plateId === data.plateId && sir.plateDrugId === data.plateDrugId && sir.status === "CURRENT")) {
          throw new Error("duplicate current SirInterpretation");
        }
        const sir = { id: `sir-${++state.sirCounter}`, ...data };
        state.sirs.push(sir);
        return sir;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        state.audits.push(data);
        return { id: `audit-${state.audits.length}`, ...data };
      },
    },
  };

  return { tx: tx as any, state };
}

describe("append-only plate result calculation", () => {
  it("creates one CURRENT RawMic/SIR on initial calculation", async () => {
    const { tx, state } = createTx();
    const results = await recalculatePlateResults(tx, "plate-1", actor, { breakpointSetId: "bps-1" });
    expect(results).toHaveLength(1);
    expect(state.rawMics).toHaveLength(1);
    expect(state.sirs).toHaveLength(1);
    expect(state.rawMics[0]).toMatchObject({ status: "CURRENT", supersedesId: null, breakpointSetId: "bps-1", sourceWellRevision: 1 });
    expect(state.sirs[0]).toMatchObject({ status: "CURRENT", supersedesId: null, breakpointSetId: "bps-1" });
  });

  it("supersedes previous CURRENT records and keeps the history chain", async () => {
    const { tx, state } = createTx();
    await recalculatePlateResults(tx, "plate-1", actor, { breakpointSetId: "bps-1" });
    state.plate.wellRevision = 2;
    state.plate.wells = finalWells([
      "INHIBITED", "INHIBITED", "INHIBITED", "GROWTH", "GROWTH", "GROWTH",
      "GROWTH", "GROWTH", "GROWTH", "GROWTH", "GROWTH", "GROWTH",
    ]);
    await recalculatePlateResults(tx, "plate-1", actor, { breakpointSetId: "bps-1" });
    expect(state.rawMics).toHaveLength(2);
    expect(state.sirs).toHaveLength(2);
    const [oldRaw, newRaw] = state.rawMics;
    const [oldSir, newSir] = state.sirs;
    expect(oldRaw.status).toBe("SUPERSEDED");
    expect(newRaw).toMatchObject({ status: "CURRENT", supersedesId: oldRaw.id, sourceWellRevision: 2 });
    expect(oldSir.status).toBe("SUPERSEDED");
    expect(newSir).toMatchObject({ status: "CURRENT", supersedesId: oldSir.id });
    expect(state.rawMics.filter((raw) => raw.status === "CURRENT")).toHaveLength(1);
    expect(state.audits.map((audit) => audit.action)).toContain("MIC_SUPERSEDED");
    expect(state.audits.map((audit) => audit.action)).toContain("SIR_SUPERSEDED");
  });

  it("can restore S/I/R differences after a breakpoint set version change", async () => {
    const first = createTx({ breakpointSetId: "bps-s", breakpointRule: { susceptibleMax: 2, resistantMin: 8, version: "2026.1" } });
    await recalculatePlateResults(first.tx, "plate-1", actor, { breakpointSetId: "bps-s" });
    const secondSet = {
      id: "bps-r",
      standard: "CLSI",
      version: "2027.1",
      organism: "E. coli",
      unit: "mg/L",
      method: "BROTH_MICRODILUTION",
      status: "APPROVED",
      effectiveFrom: null,
      effectiveTo: null,
      sourceDocumentReference: null,
      sourceDocumentChecksum: null,
      contentHash: "",
      rules: [{
        id: "rule-r",
        drugName: "Drug X",
        organism: "E. coli",
        standard: "CLSI",
        version: "2027.1",
        susceptibleMax: 0.5,
        resistantMin: 1,
        intermediateMin: null,
        intermediateMax: null,
        unit: "mg/L",
        method: "BROTH_MICRODILUTION",
        exceptionJson: null,
      }],
    };
    secondSet.contentHash = calculateBreakpointContentHash(secondSet);
    first.state.breakpointSet = secondSet;
    await recalculatePlateResults(first.tx, "plate-1", actor, { breakpointSetId: "bps-r" });
    expect(first.state.sirs.map((sir) => ({ category: sir.category, status: sir.status, breakpointSetId: sir.breakpointSetId }))).toEqual([
      { category: "S", status: "SUPERSEDED", breakpointSetId: "bps-s" },
      { category: "R", status: "CURRENT", breakpointSetId: "bps-r" },
    ]);
  });

  it("does not calculate from unreviewed IMAGE_ASSISTED wells", async () => {
    const { tx, state } = createTx({
      wells: finalWells(Array(12).fill("INHIBITED"), "IMAGE_ASSISTED"),
    });
    const results = await recalculatePlateResults(tx, "plate-1", actor, { breakpointSetId: "bps-1" });
    expect(results?.[0]).toMatchObject({ value: null, rawMicOperator: null, needsReview: true });
    expect(state.rawMics[0].rationaleJson.reasonCodes).toContain("INCOMPLETE_OR_INVALID_WELL");
  });

  it("rejects missing or unavailable breakpoint sets before changing current records", async () => {
    const { tx, state } = createTx({ breakpointSetApproved: false });
    await expect(recalculatePlateResults(tx, "plate-1", actor, { breakpointSetId: "" }))
      .rejects.toMatchObject({ code: "BREAKPOINT_SET_REQUIRED" });
    await expect(recalculatePlateResults(tx, "plate-1", actor, { breakpointSetId: "bps-1" }))
      .rejects.toMatchObject({ code: "BREAKPOINT_SET_NOT_AVAILABLE" });
    expect(state.rawMics).toHaveLength(0);
  });

  it("reports a conflict before superseding old CURRENT rows", async () => {
    const { tx, state } = createTx({ conflict: true });
    state.rawMics.push({
      id: "raw-current",
      plateId: "plate-1",
      plateDrugId: "drug-1",
      status: "CURRENT",
      breakpointSetId: "bps-1",
      value: 2,
      rawMicOperator: "=",
    });
    await expect(recalculatePlateResults(tx, "plate-1", actor, { breakpointSetId: "bps-1" }))
      .rejects.toMatchObject({ code: "RESULT_RECALCULATION_CONFLICT" });
    expect(state.rawMics[0].status).toBe("CURRENT");
  });
});
