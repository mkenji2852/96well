import type {
  BreakpointStandard,
  NoBreakpointOutputPolicy,
  RawMicOperator,
  SirCategory,
  SirResult,
} from "@/types/domain";

export interface BreakpointSnapshot {
  id?: string;
  drugName?: string;
  organism?: string | null;
  standard: BreakpointStandard;
  version: string;
  susceptibleMax: number;
  intermediateMin?: number | null;
  intermediateMax?: number | null;
  resistantMin: number;
  unit?: string;
}

export interface RuleSelection {
  drugName: string;
  organism?: string | null;
  standard: BreakpointStandard;
  version: string;
}

export function selectBreakpointRule<T extends BreakpointSnapshot>(rules: T[], selection: RuleSelection): T | null {
  const candidates = rules.filter((rule) =>
    rule.drugName === selection.drugName &&
    rule.standard === selection.standard &&
    rule.version === selection.version
  );
  return candidates.find((rule) => rule.organism === selection.organism)
    ?? candidates.find((rule) => rule.organism == null)
    ?? null;
}

function decideExact(value: number, rule: BreakpointSnapshot): SirCategory {
  if (value <= rule.susceptibleMax) return "S";
  if (value >= rule.resistantMin) return "R";
  if (rule.intermediateMin == null && rule.intermediateMax == null) return "I";
  if ((rule.intermediateMin == null || value >= rule.intermediateMin) && (rule.intermediateMax == null || value <= rule.intermediateMax)) {
    return "I";
  }
  return "NOT_DETERMINED";
}

export function interpretSir(
  value: number | null,
  rawMicOperator: RawMicOperator | null,
  rule?: BreakpointSnapshot | null,
): SirResult {
  if (!rule) {
    return {
      category: "NO_BREAKPOINT",
      standard: null,
      ruleVersion: null,
      rationale: {
        engineVersion: "sir-rule-engine-v2",
        decisionCode: "NO_MATCHING_BREAKPOINT",
        input: { value, rawMicOperator },
        breakpoint: null,
      },
    };
  }

  let category: SirCategory = "NOT_DETERMINED";
  let decisionCode = "RAW_MIC_NOT_DETERMINED";
  if (value !== null && rawMicOperator !== null) {
    if (rawMicOperator === "=") {
      category = decideExact(value, rule);
      decisionCode = "EXACT_MIC_COMPARED";
    } else if ((rawMicOperator === "<" || rawMicOperator === "<=") && value <= rule.susceptibleMax) {
      category = "S";
      decisionCode = "UPPER_BOUND_WITHIN_S";
    } else if ((rawMicOperator === ">" || rawMicOperator === ">=") && value >= rule.resistantMin) {
      category = "R";
      decisionCode = "LOWER_BOUND_WITHIN_R";
    } else {
      decisionCode = "QUALIFIED_MIC_CROSSES_CATEGORY_BOUNDARY";
    }
  }

  return {
    category,
    standard: rule.standard,
    ruleVersion: rule.version,
    rationale: {
      engineVersion: "sir-rule-engine-v2",
      decisionCode,
      input: { value, rawMicOperator },
      breakpoint: {
        id: rule.id ?? null,
        drugName: rule.drugName ?? null,
        organism: rule.organism ?? null,
        standard: rule.standard,
        version: rule.version,
        susceptibleMax: rule.susceptibleMax,
        intermediateMin: rule.intermediateMin ?? null,
        intermediateMax: rule.intermediateMax ?? null,
        resistantMin: rule.resistantMin,
        unit: rule.unit ?? null,
      },
    },
  };
}

export function formatInterpretation(
  category: SirCategory,
  policy: NoBreakpointOutputPolicy = "AS_NO_BREAKPOINT",
): string {
  if (category !== "NO_BREAKPOINT") return category === "NOT_DETERMINED" ? "ND" : category;
  if (policy === "AS_NA") return "N/A";
  if (policy === "AS_BLANK") return "";
  return "NO_BREAKPOINT";
}
