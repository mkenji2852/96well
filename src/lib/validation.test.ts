import { describe, expect, it } from "vitest";
import { breakpointRuleSchema, createSampleSchema, savePlateSchema } from "./validation";

describe("sample validation", () => {
  it("accepts an arbitrary 12-point dilution range", () => {
    const result = createSampleSchema.safeParse({
      sampleCode: "S-001",
      drugs: [{
        drugName: "Drug X",
        unit: "mg/L",
        concentrations: [120, 60, 30, 15, 7.5, 3.75, 1.875, 0.9375, 0.46875, 0.234, 0.117, 0.058],
      }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a range that does not map to all 12 columns", () => {
    const result = createSampleSchema.safeParse({
      sampleCode: "S-001",
      drugs: [{ drugName: "Drug X", unit: "mg/L", concentrations: [1, 0.5] }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects client-supplied breakpoint creation during sample creation", () => {
    const result = createSampleSchema.safeParse({
      sampleCode: "S-001",
      drugs: [{
        drugName: "Drug X",
        unit: "mg/L",
        concentrations: [120, 60, 30, 15, 7.5, 3.75, 1.875, 0.9375, 0.46875, 0.234, 0.117, 0.058],
        breakpoint: { standard: "CLSI", version: "2026", susceptibleMax: 1, resistantMin: 4 },
      }],
    });
    expect(result.success).toBe(false);
  });
});

describe("plate save validation", () => {
  it("rejects unreviewed image-assisted wells so MIC/SIR cannot be calculated from predictions", () => {
    const result = savePlateSchema.safeParse({
      wells: [{
        rowIndex: 0,
        columnIndex: 0,
        state: "GROWTH",
        source: "IMAGE_ASSISTED",
        confidence: 1,
      }],
    });
    expect(result.success).toBe(false);
  });
});

describe("breakpoint rule validation", () => {
  it("accepts a user-entered S/I/R breakpoint such as S≤4, I=8, R≥16", () => {
    const result = breakpointRuleSchema.safeParse({
      drugName: "Ampicillin",
      unit: "µg/mL",
      method: "BROTH_MICRODILUTION",
      susceptibleMax: 4,
      intermediateMin: 8,
      intermediateMax: 8,
      resistantMin: 16,
    });
    expect(result.success).toBe(true);
  });
});
