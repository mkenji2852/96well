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

  it("interprets an explicitly entered CLSI S/I/R breakpoint such as Ampicillin ≤4/8/16 as I at MIC 8", () => {
    const result = interpretSir(8, "=", {
      drugName: "Ampicillin",
      organism: "E. coli",
      standard: "CLSI",
      version: "local-2026",
      susceptibleMax: 4,
      intermediateMin: 8,
      intermediateMax: 8,
      resistantMin: 16,
      unit: "µg/mL",
    });
    expect(result.category).toBe("I");
    expect(result.rationale).toMatchObject({
      breakpoint: {
        susceptibleMax: 4,
        intermediateMin: 8,
        intermediateMax: 8,
        resistantMin: 16,
      },
    });
  });

  it("does not label an exact MIC as I when it is outside the explicit intermediate range", () => {
    const result = interpretSir(6, "=", {
      drugName: "Ampicillin",
      organism: "E. coli",
      standard: "CLSI",
      version: "local-2026",
      susceptibleMax: 4,
      intermediateMin: 8,
      intermediateMax: 8,
      resistantMin: 16,
      unit: "µg/mL",
    });
    expect(result.category).toBe("NOT_DETERMINED");
  });

  it("does not guess when a qualified MIC spans categories", () => {
    expect(interpretSir(4, ">", rules[0]).category).toBe("NOT_DETERMINED");
    expect(interpretSir(4, "<=", rules[0]).category).toBe("NOT_DETERMINED");
  });
});
