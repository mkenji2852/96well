import { describe, expect, it } from "vitest";
import { formatInterpretation, interpretSir, selectBreakpointRule } from "./rule-engine";

const rules = [
  { drugName: "Drug X", organism: "E. coli", standard: "CLSI" as const, version: "2026.1", susceptibleMax: 2, resistantMin: 8 },
  { drugName: "Drug X", organism: "E. coli", standard: "EUCAST" as const, version: "16.0", susceptibleMax: 1, resistantMin: 4 },
  { drugName: "Drug X", organism: "E. coli", standard: "JANIS_COMPAT" as const, version: "2026-01", susceptibleMax: 0.5, resistantMin: 2 },
];

describe("versioned S/I/R rule engine", () => {
  it.each([
    ["CLSI", "2026.1", "S"],
    ["EUCAST", "16.0", "I"],
    ["JANIS_COMPAT", "2026-01", "R"],
  ] as const)("switches %s rules by explicit version", (standard, version, category) => {
    const rule = selectBreakpointRule(rules, { drugName: "Drug X", organism: "E. coli", standard, version });
    const result = interpretSir(2, "=", rule);
    expect(result.category).toBe(category);
    expect(result.standard).toBe(standard);
    expect(result.ruleVersion).toBe(version);
    expect(result.rationale).toMatchObject({ decisionCode: "EXACT_MIC_COMPARED" });
  });

  it("returns NO_BREAKPOINT and allows output policy conversion", () => {
    const result = interpretSir(1, "=", null);
    expect(result.category).toBe("NO_BREAKPOINT");
    expect(result.rationale).toMatchObject({ decisionCode: "NO_MATCHING_BREAKPOINT" });
    expect(formatInterpretation(result.category)).toBe("NO_BREAKPOINT");
    expect(formatInterpretation(result.category, "AS_NA")).toBe("N/A");
    expect(formatInterpretation(result.category, "AS_BLANK")).toBe("");
  });

  it("does not guess when a qualified MIC spans categories", () => {
    expect(interpretSir(4, ">", rules[0]).category).toBe("NOT_DETERMINED");
    expect(interpretSir(4, "<=", rules[0]).category).toBe("NOT_DETERMINED");
  });
});
