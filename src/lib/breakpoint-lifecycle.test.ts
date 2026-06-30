import { describe, expect, it } from "vitest";
import {
  assertBreakpointContentHash,
  assertDraft,
  BreakpointLifecycleError,
  calculateBreakpointContentHash,
  canonicalBreakpointContent,
  validateBreakpointSetForApproval,
} from "./breakpoint-lifecycle";

function rule(drugName: string, susceptibleMax: number, resistantMin: number) {
  return {
    drugName,
    organism: "E. coli",
    standard: "CLSI",
    version: "2026.1",
    susceptibleMax,
    resistantMin,
    intermediateMin: null,
    intermediateMax: null,
    unit: "mg/L",
    method: "BROTH_MICRODILUTION",
    exceptionJson: { z: 1, a: { y: true, b: "x" } },
  };
}

function set(rules = [rule("Drug B", 1, 4), rule("Drug A", 2, 8)]) {
  return {
    standard: "CLSI",
    version: "2026.1",
    organism: "E. coli",
    unit: "mg/L",
    method: "BROTH_MICRODILUTION",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: "2027-01-01T00:00:00.000Z",
    sourceDocumentReference: "CLSI M100",
    sourceDocumentChecksum: "abc123",
    rules,
  };
}

describe("BreakpointSet lifecycle and content hash", () => {
  it("produces the same SHA-256 hash regardless of rule order or JSON key order", () => {
    const first = set();
    const second = set([
      { ...rule("Drug A", 2, 8), exceptionJson: { a: { b: "x", y: true }, z: 1 } },
      { ...rule("Drug B", 1, 4), exceptionJson: { a: { b: "x", y: true }, z: 1 } },
    ]);
    expect(canonicalBreakpointContent(first)).toBe(canonicalBreakpointContent(second));
    expect(calculateBreakpointContentHash(first)).toBe(calculateBreakpointContentHash(second));
    expect(calculateBreakpointContentHash(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes the hash when a rule boundary changes", () => {
    expect(calculateBreakpointContentHash(set()))
      .not.toBe(calculateBreakpointContentHash(set([rule("Drug B", 1, 4), rule("Drug A", 1, 8)])));
  });

  it("allows only DRAFT mutation", () => {
    expect(() => assertDraft("DRAFT")).not.toThrow();
    expect(() => assertDraft("APPROVED")).toThrowError(BreakpointLifecycleError);
    expect(() => assertDraft("RETIRED")).toThrowError(BreakpointLifecycleError);
  });

  it("detects duplicate rules and invalid S/I/R boundaries before approval", () => {
    const invalid = set([
      rule("Drug A", 4, 2),
      rule("Drug A", 1, 4),
    ]);
    const errors = validateBreakpointSetForApproval(invalid);
    expect(errors.some((message) => message.includes("重複"))).toBe(true);
    expect(errors.some((message) => message.includes("矛盾"))).toBe(true);
  });

  it("rejects hash mismatch and accepts an exact immutable snapshot", () => {
    const value = set();
    const contentHash = calculateBreakpointContentHash(value);
    expect(assertBreakpointContentHash({ ...value, contentHash })).toBe(contentHash);
    expect(() => assertBreakpointContentHash({
      ...value,
      rules: [rule("Drug A", 0.5, 8)],
      contentHash,
    })).toThrowError(expect.objectContaining({ code: "BREAKPOINT_HASH_MISMATCH" }));
  });
});
