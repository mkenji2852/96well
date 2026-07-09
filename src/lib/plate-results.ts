import type { Prisma } from "@prisma/client";
import type { AuthenticatedActor } from "@/lib/auth";
import { assertBreakpointContentHash, BreakpointLifecycleError } from "@/lib/breakpoint-lifecycle";
import { normalizeDrugAssignments } from "@/lib/drug-layout";
import { calculateRawMic, micRationale } from "@/lib/mic";
import { interpretSir } from "@/lib/rule-engine";
import type { BreakpointStandard, MicModifier, RawMicOperator, SirCategory, WellState } from "@/types/domain";

export const MIC_CALCULATION_ENGINE_VERSION = "broth-microdilution-v2" as const;
export const SIR_RULE_ENGINE_VERSION = "sir-rule-engine-v2" as const;

export type ResultCalculationErrorCode =
  | "BREAKPOINT_SET_REQUIRED"
  | "BREAKPOINT_SET_NOT_AVAILABLE"
  | "BREAKPOINT_SET_ORGANISM_MISMATCH"
  | "BREAKPOINT_CHANGE_REASON_REQUIRED"
  | "BREAKPOINT_HASH_MISMATCH"
  | "RESULT_RECALCULATION_CONFLICT";

export class ResultCalculationError extends Error {
  constructor(
    readonly code: ResultCalculationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ResultCalculationError";
  }
}

export interface PlateResultSelection {
  breakpointSetId: string;
  breakpointChangeReason?: string;
}

export interface PlateResultSummary {
  rawMicId: string;
  sirInterpretationId: string;
  breakpointSetId: string;
  drugId: string;
  drugName: string;
  value: number | null;
  rawMicOperator: RawMicOperator | null;
  modifier: MicModifier;
  category: SirCategory;
  breakpointStandard: string | null;
  breakpointVersion: string | null;
  calculationEngineVersion: string;
  ruleEngineVersion: string;
  sourceWellRevision: number;
  needsReview: boolean;
  supersedesRawMicId: string | null;
  supersedesSirInterpretationId: string | null;
}

type ResultTransaction = Prisma.TransactionClient;

interface FinalWell {
  rowIndex: number;
  columnIndex: number;
  state: string;
  source: string;
}

interface PlateForCalculation {
  id: string;
  organizationId: string;
  resultRevision: number;
  wellRevision: number;
  lastBreakpointSetId: string | null;
  sample: { organism: string | null };
  drugs: Array<{ id: string; rowIndex: number; drugName: string; unit: string; concentrations: unknown }>;
  wells: FinalWell[];
}

interface ActiveBreakpointSet {
  id: string;
  standard: string;
  version: string;
  organism: string | null;
  unit: string;
  method: string;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  sourceDocumentReference: string | null;
  sourceDocumentChecksum: string | null;
  contentHash: string | null;
  rules: Array<{
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
  }>;
}

function isFinalWellSource(source: string): boolean {
  return source === "MANUAL" || source === "IMAGE_REVIEWED";
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function requireBreakpointSetId(breakpointSetId?: string): string {
  const normalized = breakpointSetId?.trim();
  if (!normalized) {
    throw new ResultCalculationError("BREAKPOINT_SET_REQUIRED", "breakpointSetId is required for result calculation.");
  }
  return normalized;
}

async function loadActiveBreakpointSet(
  tx: ResultTransaction,
  organizationId: string,
  breakpointSetId: string,
  organism: string | null,
): Promise<ActiveBreakpointSet> {
  const now = new Date();
  const breakpointSet = await tx.breakpointSet.findFirst({
    where: {
      id: breakpointSetId,
      organizationId,
      status: "APPROVED",
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
      ],
    },
    include: { rules: true },
  });
  if (!breakpointSet) {
    throw new ResultCalculationError("BREAKPOINT_SET_NOT_AVAILABLE", "指定されたbreakpoint setは利用できません。");
  }
  if (breakpointSet.organism && breakpointSet.organism !== organism) {
    throw new ResultCalculationError("BREAKPOINT_SET_ORGANISM_MISMATCH", "breakpoint setの対象菌種が一致しません。");
  }
  try {
    assertBreakpointContentHash(breakpointSet);
  } catch (error) {
    if (error instanceof BreakpointLifecycleError && error.code === "BREAKPOINT_HASH_MISMATCH") {
      throw new ResultCalculationError("BREAKPOINT_HASH_MISMATCH", error.message);
    }
    throw error;
  }
  return breakpointSet;
}

function selectRule(
  breakpointSet: ActiveBreakpointSet,
  drugName: string,
  organism: string | null,
): ActiveBreakpointSet["rules"][number] | null {
  const candidates = breakpointSet.rules.filter((rule) => rule.drugName === drugName);
  return candidates.find((rule) => rule.organism === organism)
    ?? candidates.find((rule) => rule.organism == null)
    ?? null;
}

async function reservePlateRevision(
  tx: ResultTransaction,
  plate: PlateForCalculation,
  breakpointSetId: string,
  calculatedAt: Date,
): Promise<void> {
  const reserved = await tx.plate.updateMany({
    where: {
      id: plate.id,
      organizationId: plate.organizationId,
      resultRevision: plate.resultRevision,
    },
    data: {
      resultRevision: { increment: 1 },
      lastCalculatedAt: calculatedAt,
      lastBreakpointSetId: breakpointSetId,
    },
  });
  if (reserved.count !== 1) {
    throw new ResultCalculationError("RESULT_RECALCULATION_CONFLICT", "結果再計算が競合しました。再読み込みして再実行してください。");
  }
}

export async function recalculatePlateResults(
  tx: ResultTransaction,
  plateId: string,
  actor: AuthenticatedActor,
  selection: PlateResultSelection,
): Promise<PlateResultSummary[] | null> {
  const breakpointSetId = requireBreakpointSetId(selection.breakpointSetId);
  const calculatedAt = new Date();
  const plate = await tx.plate.findFirst({
    where: { id: plateId, organizationId: actor.organizationId },
    include: { sample: true, drugs: { orderBy: { rowIndex: "asc" } }, wells: true },
  });
  if (!plate) return null;
  if (
    plate.lastBreakpointSetId &&
    plate.lastBreakpointSetId !== breakpointSetId &&
    !selection.breakpointChangeReason?.trim()
  ) {
    throw new ResultCalculationError(
      "BREAKPOINT_CHANGE_REASON_REQUIRED",
      "BreakpointSetの版を変更して再計算する場合は理由が必要です。",
    );
  }

  const breakpointSet = await loadActiveBreakpointSet(tx, actor.organizationId, breakpointSetId, plate.sample.organism);
  await reservePlateRevision(tx, plate, breakpointSet.id, calculatedAt);

  await tx.auditLog.create({
    data: {
      actorId: actor.userId,
      actorLabel: actor.userId,
      action: plate.lastBreakpointSetId && plate.lastBreakpointSetId !== breakpointSet.id
        ? "BREAKPOINT_SELECTION_CHANGED"
        : "BREAKPOINT_SET_SELECTED",
      entityType: "Plate",
      entityId: plateId,
      beforeJson: plate.lastBreakpointSetId ? inputJson({
        breakpointSetId: plate.lastBreakpointSetId,
      }) : undefined,
      afterJson: inputJson({
        actorUserId: actor.userId,
        organizationId: actor.organizationId,
        plateId,
        breakpointSetId: breakpointSet.id,
        standard: breakpointSet.standard,
        version: breakpointSet.version,
        reason: selection.breakpointChangeReason?.trim() || null,
        sourceWellRevision: plate.wellRevision,
        timestamp: calculatedAt.toISOString(),
        sessionId: actor.sessionId,
      }),
    },
  });

  const finalWells = plate.wells.filter((well) => isFinalWellSource(well.source));
  const results: PlateResultSummary[] = [];

  for (const drug of plate.drugs) {
    const assignments = normalizeDrugAssignments(drug);
    const concentrations = assignments.map((assignment) => assignment.concentration);
    const states = assignments.map((assignment) =>
      finalWells.find((well) => well.rowIndex === assignment.rowIndex && well.columnIndex === assignment.columnIndex)?.state ?? "UNREAD",
    ) as WellState[];
    const raw = calculateRawMic(concentrations, states);
    const breakpointRule = selectRule(breakpointSet, drug.drugName, plate.sample.organism);
    const sir = interpretSir(raw.value, raw.rawMicOperator, breakpointRule ? {
      id: breakpointRule.id,
      drugName: breakpointRule.drugName,
      organism: breakpointRule.organism,
      standard: breakpointRule.standard as BreakpointStandard,
      susceptibleMax: breakpointRule.susceptibleMax,
      resistantMin: breakpointRule.resistantMin,
      version: breakpointRule.version,
      unit: breakpointRule.unit,
    } : null);

    const previousRawMic = await tx.rawMic.findFirst({
      where: { plateId, plateDrugId: drug.id, status: "CURRENT" },
      orderBy: { createdAt: "desc" },
    });
    if (previousRawMic) {
      const superseded = await tx.rawMic.updateMany({
        where: { id: previousRawMic.id, status: "CURRENT" },
        data: { status: "SUPERSEDED", supersededAt: calculatedAt },
      });
      if (superseded.count !== 1) {
        throw new ResultCalculationError("RESULT_RECALCULATION_CONFLICT", "Raw MICのCURRENT更新が競合しました。");
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "MIC_SUPERSEDED",
          entityType: "RawMic",
          entityId: previousRawMic.id,
          beforeJson: inputJson({
            status: previousRawMic.status,
            value: previousRawMic.value,
            rawMicOperator: previousRawMic.rawMicOperator,
            breakpointSetId: previousRawMic.breakpointSetId,
          }),
          afterJson: inputJson({
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            plateId,
            drugId: drug.id,
            previousResultId: previousRawMic.id,
            sourceWellRevision: plate.wellRevision,
            breakpointSetId: breakpointSet.id,
            engineVersion: MIC_CALCULATION_ENGINE_VERSION,
            status: "SUPERSEDED",
            supersededAt: calculatedAt.toISOString(),
            timestamp: calculatedAt.toISOString(),
          }),
        },
      });
    }

    const rawMic = await tx.rawMic.create({
      data: {
        plateId,
        plateDrugId: drug.id,
        value: raw.value,
        modifier: raw.modifier,
        rawMicOperator: raw.rawMicOperator,
        endpointRule: raw.rawMicOperator,
        calculationMethod: raw.method,
        calculationEngineVersion: MIC_CALCULATION_ENGINE_VERSION,
        reviewRequired: raw.needsReview,
        sourceWellRevision: plate.wellRevision,
        breakpointSetId: breakpointSet.id,
        status: "CURRENT",
        supersedesId: previousRawMic?.id ?? null,
        rationaleJson: inputJson(micRationale(raw)),
        calculatedAt,
        createdAt: calculatedAt,
        createdByUserId: actor.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.userId,
        actorLabel: actor.userId,
        action: "MIC_CALCULATED",
        entityType: "RawMic",
        entityId: rawMic.id,
        afterJson: inputJson({
          actorUserId: actor.userId,
          organizationId: actor.organizationId,
          plateId,
          drugId: drug.id,
          previousResultId: previousRawMic?.id ?? null,
          newResultId: rawMic.id,
          sourceWellRevision: plate.wellRevision,
          breakpointSetId: breakpointSet.id,
          engineVersion: MIC_CALCULATION_ENGINE_VERSION,
          value: rawMic.value,
          rawMicOperator: rawMic.rawMicOperator,
          reviewRequired: rawMic.reviewRequired,
          timestamp: calculatedAt.toISOString(),
        }),
      },
    });

    const previousSir = await tx.sirInterpretation.findFirst({
      where: { plateId, plateDrugId: drug.id, status: "CURRENT" },
      orderBy: { calculatedAt: "desc" },
    });
    if (previousSir) {
      const superseded = await tx.sirInterpretation.updateMany({
        where: { id: previousSir.id, status: "CURRENT" },
        data: { status: "SUPERSEDED", supersededAt: calculatedAt },
      });
      if (superseded.count !== 1) {
        throw new ResultCalculationError("RESULT_RECALCULATION_CONFLICT", "S/I/R判定のCURRENT更新が競合しました。");
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "SIR_SUPERSEDED",
          entityType: "SirInterpretation",
          entityId: previousSir.id,
          beforeJson: inputJson({
            status: previousSir.status,
            category: previousSir.category,
            breakpointSetId: previousSir.breakpointSetId,
            rawMicId: previousSir.rawMicId,
          }),
          afterJson: inputJson({
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            plateId,
            drugId: drug.id,
            previousResultId: previousSir.id,
            sourceWellRevision: plate.wellRevision,
            breakpointSetId: breakpointSet.id,
            engineVersion: SIR_RULE_ENGINE_VERSION,
            status: "SUPERSEDED",
            supersededAt: calculatedAt.toISOString(),
            timestamp: calculatedAt.toISOString(),
          }),
        },
      });
    }

    const sirInterpretation = await tx.sirInterpretation.create({
      data: {
        rawMicId: rawMic.id,
        plateId,
        plateDrugId: drug.id,
        breakpointSetId: breakpointSet.id,
        breakpointRuleId: breakpointRule?.id ?? null,
        category: sir.category,
        standard: sir.standard,
        ruleVersion: sir.ruleVersion,
        susceptibleMax: breakpointRule?.susceptibleMax ?? null,
        resistantMin: breakpointRule?.resistantMin ?? null,
        ruleEngineVersion: SIR_RULE_ENGINE_VERSION,
        status: "CURRENT",
        supersedesId: previousSir?.id ?? null,
        rationaleJson: inputJson(sir.rationale),
        interpretedAt: calculatedAt,
        calculatedAt,
        calculatedByUserId: actor.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.userId,
        actorLabel: actor.userId,
        action: "SIR_INTERPRETED",
        entityType: "SirInterpretation",
        entityId: sirInterpretation.id,
        afterJson: inputJson({
          actorUserId: actor.userId,
          organizationId: actor.organizationId,
          plateId,
          drugId: drug.id,
          previousResultId: previousSir?.id ?? null,
          newResultId: sirInterpretation.id,
          rawMicId: rawMic.id,
          sourceWellRevision: plate.wellRevision,
          breakpointSetId: breakpointSet.id,
          engineVersion: SIR_RULE_ENGINE_VERSION,
          category: sirInterpretation.category,
          timestamp: calculatedAt.toISOString(),
        }),
      },
    });

    results.push({
      rawMicId: rawMic.id,
      sirInterpretationId: sirInterpretation.id,
      breakpointSetId: breakpointSet.id,
      drugId: drug.id,
      drugName: drug.drugName,
      value: raw.value,
      rawMicOperator: raw.rawMicOperator,
      modifier: raw.modifier,
      category: sir.category,
      breakpointStandard: sir.standard,
      breakpointVersion: sir.ruleVersion,
      calculationEngineVersion: MIC_CALCULATION_ENGINE_VERSION,
      ruleEngineVersion: SIR_RULE_ENGINE_VERSION,
      sourceWellRevision: plate.wellRevision,
      needsReview: raw.needsReview,
      supersedesRawMicId: previousRawMic?.id ?? null,
      supersedesSirInterpretationId: previousSir?.id ?? null,
    });
  }

  return results;
}
