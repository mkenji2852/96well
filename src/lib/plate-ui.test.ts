import { describe, expect, it } from "vitest";
import { applyStateToRow, createEmptyPlate, cycleWellState, wellKey } from "./plate-ui";

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
