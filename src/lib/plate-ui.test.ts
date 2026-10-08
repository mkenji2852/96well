import { describe, expect, it } from "vitest";
import { applyGrowthToLowerConcentrations, applyStateToRow, createEmptyPlate, cycleWellState, wellKey, restoreLayoutDetails } from "./plate-ui";

it("restores notes without replacing template drug coordinates or doses with stale draft details", () => {
  const layout = { "0-10": { drugName: "Ampicillin", concentration: "8", unit: "mg/L", note: "" },
    "1-11": { drugName: "", concentration: "", unit: "", note: "" } };
  const draft = { "0-10": { drugName: "Old Drug", concentration: "64", unit: "other", note: "Observed" },
    "1-11": { drugName: "Stale Drug", concentration: "16", unit: "mg/L", note: "" } };
  const restored = restoreLayoutDetails(layout, draft);
  expect(restored["0-10"]).toEqual({ ...layout["0-10"], note: "Observed" });
  expect(restored["1-11"]).toEqual(layout["1-11"]);
  expect(layout["0-10"].note).toBe("");
});

describe("cycleWellState", () => {
  it("cycles empty → growth → no_growth → review_needed → empty", () => {
    expect(cycleWellState("EMPTY")).toBe("GROWTH");
    expect(cycleWellState("GROWTH")).toBe("NO_GROWTH");
    expect(cycleWellState("NO_GROWTH")).toBe("REVIEW_NEEDED");
    expect(cycleWellState("REVIEW_NEEDED")).toBe("EMPTY");
  });
});

describe("applyStateToRow", () => {
  it("updates all 12 wells in only the selected row", () => {
    const initial = createEmptyPlate();
    const next = applyStateToRow(initial, 3, "NO_GROWTH");

    for (let columnIndex = 0; columnIndex < 12; columnIndex += 1) {
      expect(next[wellKey(3, columnIndex)]).toBe("NO_GROWTH");
      expect(next[wellKey(2, columnIndex)]).toBe("EMPTY");
    }
    expect(initial[wellKey(3, 0)]).toBe("EMPTY");
  });
});

describe("applyGrowthToLowerConcentrations", () => {
  it("marks lower-concentration wells as growth and selected/higher wells as no growth", () => {
    const initial = createEmptyPlate();
    const next = applyGrowthToLowerConcentrations(initial, 2, 4);

    for (let columnIndex = 0; columnIndex <= 4; columnIndex += 1) {
      expect(next[wellKey(2, columnIndex)]).toBe("NO_GROWTH");
    }
    for (let columnIndex = 5; columnIndex < 12; columnIndex += 1) {
      expect(next[wellKey(2, columnIndex)]).toBe("GROWTH");
    }
    expect(next[wellKey(1, 5)]).toBe("EMPTY");
    expect(initial[wellKey(2, 5)]).toBe("EMPTY");
  });
});
