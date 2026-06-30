import { describe, expect, it } from "vitest";
import { calculateRawMic, formatMic } from "./mic";

const concentrations = [64, 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125];

describe("calculateRawMic", () => {
  it("returns the lowest inhibited concentration", () => {
    const result = calculateRawMic(concentrations, [
      "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED",
      "GROWTH", "GROWTH", "GROWTH", "GROWTH", "GROWTH", "GROWTH",
    ]);
    expect(result).toMatchObject({ value: 2, rawMicOperator: "=", needsReview: false });
    expect(formatMic(result.value, result.rawMicOperator)).toBe("2");
  });

  it("reports greater than the maximum when every well grows", () => {
    const result = calculateRawMic(concentrations, Array(12).fill("GROWTH"));
    expect(result).toMatchObject({ value: 64, rawMicOperator: ">" });
  });

  it("reports less than or equal to the minimum when every well is inhibited", () => {
    const result = calculateRawMic(concentrations, Array(12).fill("INHIBITED"));
    expect(result).toMatchObject({ value: 0.03125, rawMicOperator: "<=" });
  });

  it("sends incomplete and non-monotonic readings to review", () => {
    expect(calculateRawMic(concentrations, Array(12).fill("UNREAD"))).toMatchObject({
      rawMicOperator: null,
      needsReview: true,
    });
    const nonMonotonic = calculateRawMic(concentrations, [
      "GROWTH", "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED", "INHIBITED",
      "GROWTH", "GROWTH", "GROWTH", "GROWTH", "GROWTH", "GROWTH",
    ]);
    expect(nonMonotonic.needsReview).toBe(true);
    expect(nonMonotonic.reasons).toContain("HIGH_CONCENTRATION_REGROWTH");
  });
});
