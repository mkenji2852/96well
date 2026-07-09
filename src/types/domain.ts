export const ROW_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export type WellState =
  | "UNREAD"
  | "GROWTH"
  | "INHIBITED"
  | "CONTAMINATED"
  | "SKIPPED";

export type MicModifier =
  | "EQUAL"
  | "LESS_THAN_OR_EQUAL"
  | "GREATER_THAN"
  | "NOT_DETERMINED";

export type RawMicOperator = "<" | "<=" | "=" | ">=" | ">";
export type BreakpointStandard = "CLSI" | "EUCAST" | "JANIS_COMPAT";
export type SirCategory = "S" | "I" | "R" | "NO_BREAKPOINT" | "NOT_DETERMINED";
export type NoBreakpointOutputPolicy = "AS_NO_BREAKPOINT" | "AS_NA" | "AS_BLANK";
export type UserRole = "TECHNICIAN" | "REVIEWER" | "ADMIN" | "AUDITOR";
export type ConfirmedWellSource = "MANUAL" | "IMAGE_REVIEWED";
export type ExportProfile = "ANONYMIZED" | "CLINICAL_INTERNAL" | "AUDIT_FULL";
export type BreakpointSetStatus = "DRAFT" | "APPROVED" | "RETIRED";

export interface BreakpointRuleView {
  id: string;
  drugName: string;
  organism: string | null;
  standard: string;
  version: string;
  susceptibleMax: number;
  resistantMin: number;
  intermediateMin: number | null;
  intermediateMax: number | null;
  unit: string;
  method: string;
  exceptionJson: unknown;
}

export interface BreakpointSetView {
  id: string;
  standard: string;
  version: string;
  organism: string | null;
  unit: string;
  method: string;
  status: BreakpointSetStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  approvedAt: string | null;
  approvedByUserId: string | null;
  retiredAt: string | null;
  retireReason: string | null;
  supersedesBreakpointSetId: string | null;
  contentHash: string | null;
  revision: number;
  ruleCount: number;
  rules?: BreakpointRuleView[];
}

export interface DrugConfigInput {
  rowIndex?: number;
  drugName: string;
  unit: string;
  concentrations?: number[];
  wells?: Array<{ rowIndex: number; columnIndex: number; concentration: number }>;
}

export interface CreateSampleRequest {
  sampleCode: string;
  organism?: string;
  notes?: string;
  plateName?: string;
  drugs: DrugConfigInput[];
}

export interface WellInput {
  rowIndex: number;
  columnIndex: number;
  state: WellState;
  source?: ConfirmedWellSource;
  sourcePredictionId?: string | null;
}

export interface SavePlateRequest {
  wells: WellInput[];
  breakpointSetId?: string;
  breakpointChangeReason?: string;
  expectedRevision?: number;
  idempotencyKey?: string;
  breakpointStandard?: BreakpointStandard;
  breakpointVersion?: string;
}

export interface RawMicResult {
  value: number | null;
  rawMicOperator: RawMicOperator | null;
  /** @deprecated DB compatibility only. Use rawMicOperator. */
  modifier: MicModifier;
  method: "broth-microdilution-v2";
  needsReview: boolean;
  reasons: string[];
}

export interface SirResult {
  category: SirCategory;
  standard: BreakpointStandard | null;
  ruleVersion: string | null;
  rationale: Record<string, unknown>;
}

export interface PlateDrugView {
  id: string;
  rowIndex: number;
  drugName: string;
  unit: string;
  concentrations: unknown;
}

export interface PlateView {
  id: string;
  name: string;
  status: string;
  wellRevision: number;
  updatedAt?: string;
  lastBreakpointSetId?: string | null;
  selectedBreakpointSet?: {
    id: string;
    standard: string;
    version: string;
    organism: string | null;
    status: BreakpointSetStatus;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    approvedAt: string | null;
    contentHash: string | null;
  } | null;
  sample: { id: string; sampleCode: string; organism: string | null };
  drugs: PlateDrugView[];
  wells: WellInput[];
  results?: Array<{
    rawMicId: string;
    sirInterpretationId: string | null;
    breakpointSetId: string;
    drugName: string;
    value: number | null;
    rawMicOperator: RawMicOperator | null;
    modifier: MicModifier;
    category: SirCategory;
    breakpointVersion: string | null;
    calculationEngineVersion: string;
    ruleEngineVersion: string | null;
  }>;
}
