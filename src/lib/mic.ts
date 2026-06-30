import type { MicModifier, RawMicOperator, RawMicResult, WellState } from "@/types/domain";

const METHOD = "broth-microdilution-v2" as const;

function toLegacyModifier(operator: RawMicOperator | null): MicModifier {
  if (operator === "=") return "EQUAL";
  if (operator === "<=" || operator === "<") return "LESS_THAN_OR_EQUAL";
  if (operator === ">" || operator === ">=") return "GREATER_THAN";
  return "NOT_DETERMINED";
}

function result(
  value: number | null,
  rawMicOperator: RawMicOperator | null,
  needsReview = false,
  reasons: string[] = [],
): RawMicResult {
  return {
    value,
    rawMicOperator,
    modifier: toLegacyModifier(rawMicOperator),
    method: METHOD,
    needsReview,
    reasons,
  };
}

/** Derives a raw MIC without applying a breakpoint interpretation. */
export function calculateRawMic(concentrations: number[], states: WellState[]): RawMicResult {
  if (
    concentrations.length === 0 ||
    concentrations.length !== states.length ||
    concentrations.some((value) => !Number.isFinite(value) || value <= 0) ||
    new Set(concentrations).size !== concentrations.length
  ) {
    return result(null, null, true, ["INVALID_LAYOUT"]);
  }

  if (states.some((state) => state === "UNREAD" || state === "CONTAMINATED" || state === "SKIPPED")) {
    return result(null, null, true, ["INCOMPLETE_OR_INVALID_WELL"]);
  }

  const pairs = concentrations
    .map((concentration, index) => ({ concentration, state: states[index] }))
    .sort((a, b) => a.concentration - b.concentration);
  const inhibited = pairs.filter((pair) => pair.state === "INHIBITED");
  const growth = pairs.filter((pair) => pair.state === "GROWTH");

  if (inhibited.length === 0) return result(Math.max(...concentrations), ">");
  if (growth.length === 0) return result(Math.min(...concentrations), "<=");

  const mic = Math.min(...inhibited.map((pair) => pair.concentration));
  const highConcentrationRegrowth = pairs.some(
    (pair) => pair.concentration > mic && pair.state === "GROWTH",
  );

  return result(
    mic,
    "=",
    highConcentrationRegrowth,
    highConcentrationRegrowth ? ["HIGH_CONCENTRATION_REGROWTH"] : [],
  );
}

export function formatMic(value: number | null, operator: RawMicOperator | MicModifier | null): string {
  if (value === null || operator === null || operator === "NOT_DETERMINED") return "ND";
  const symbol: Record<string, string> = {
    EQUAL: "=",
    LESS_THAN_OR_EQUAL: "<=",
    GREATER_THAN: ">",
  };
  const normalized = symbol[operator] ?? operator;
  return normalized === "=" ? String(value) : `${normalized}${value}`;
}

export function micRationale(raw: RawMicResult): Record<string, unknown> {
  return {
    engineVersion: raw.method,
    inputKind: "RAW_WELL_DATA",
    output: { value: raw.value, rawMicOperator: raw.rawMicOperator },
    reviewRequired: raw.needsReview,
    reasonCodes: raw.reasons,
  };
}
