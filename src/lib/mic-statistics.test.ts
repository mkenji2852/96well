import { describe, expect, it } from "vitest";
import { calculateMicStatistics, percentileMic, type PopulationMic } from "./mic-statistics";

const mic = (value: number, sampleId: string, patch: Partial<PopulationMic> = {}): PopulationMic => ({
  sampleId, drugName: "Drug X", unit: "mg/L", organism: "E. coli", value, operator: "=", needsReview: false, ...patch,
});

describe("research MIC50/MIC90", () => {
  it("uses nearest-rank values without interpolating dilution concentrations", () => {
    const samples = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512].map((value, index) => mic(value, String(index)));
    expect(calculateMicStatistics(samples)[0]).toMatchObject({ includedSamples: 10, mic50: "16", mic90: "256" });
  });
  it("retains the bound of off-scale results instead of treating them as exact", () => {
    expect(percentileMic([mic(4, "a", { operator: "<=" })], 0.5)).toBe("≤4");
    expect(percentileMic([mic(64, "a", { operator: ">" })], 0.9)).toBe(">64");
    expect(percentileMic([mic(8, "a", { operator: "<=" }), mic(4, "b")], 0.5)).toBe("≤4");
    expect(percentileMic([mic(8, "a", { operator: "<=" }), mic(4, "b")], 0.9)).toBe("≥4 ～ ≤8");
  });
  it("excludes unreviewed and duplicate measurements and separates organisms and units", () => {
    const result = calculateMicStatistics([
      mic(4, "a"), mic(8, "b", { needsReview: true }), mic(8, "c"), mic(16, "c"),
      mic(2, "d", { organism: "S. aureus" }), mic(2, "e", { unit: "µg/L" }),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ includedSamples: 1, invalidSamples: 1, duplicateSamples: 1, mic50: "4", mic90: "4" });
  });
  it("leaves percentiles blank when no confirmed values are available", () => {
    expect(calculateMicStatistics([mic(4, "a", { value: null, operator: null })])[0]).toMatchObject({ includedSamples: 0, mic50: "", mic90: "" });
  });
});
