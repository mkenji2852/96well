import { ROW_LABELS, type PlateDrugView } from "@/types/domain";

export interface DrugWellAssignment {
  rowIndex: number;
  columnIndex: number;
  concentration: number;
}

export interface FlexibleDrugConcentrations {
  mode: "wells";
  wells: DrugWellAssignment[];
}

export interface DrugWellDetail {
  drugId?: string;
  drugName: string;
  unit: string;
  concentration: number;
}

export function wellKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}-${columnIndex}`;
}

export function wellName(rowIndex: number, columnIndex: number): string {
  return `${ROW_LABELS[rowIndex] ?? "?"}${columnIndex + 1}`;
}

function isAssignment(value: unknown): value is DrugWellAssignment {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DrugWellAssignment>;
  return Number.isInteger(item.rowIndex) &&
    Number.isInteger(item.columnIndex) &&
    typeof item.concentration === "number" &&
    Number.isFinite(item.concentration);
}

export function isFlexibleDrugConcentrations(value: unknown): value is FlexibleDrugConcentrations {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { mode?: unknown; wells?: unknown };
  return candidate.mode === "wells" && Array.isArray(candidate.wells) && candidate.wells.every(isAssignment);
}

export function normalizeDrugAssignments(
  drug: Pick<PlateDrugView, "rowIndex" | "concentrations">,
): DrugWellAssignment[] {
  if (isFlexibleDrugConcentrations(drug.concentrations)) {
    return [...drug.concentrations.wells]
      .filter((well) => well.rowIndex >= 0 && well.rowIndex < 8 && well.columnIndex >= 0 && well.columnIndex < 12)
      .sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
  }

  if (Array.isArray(drug.concentrations)) {
    return drug.concentrations
      .map((value, columnIndex) => ({
        rowIndex: drug.rowIndex,
        columnIndex,
        concentration: typeof value === "number" ? value : Number(value),
      }))
      .filter((well) => Number.isFinite(well.concentration));
  }

  return [];
}

export function buildWellDrugDetailMap(
  drugs: Array<Pick<PlateDrugView, "id" | "rowIndex" | "drugName" | "unit" | "concentrations">>,
): Map<string, DrugWellDetail> {
  const map = new Map<string, DrugWellDetail>();
  for (const drug of drugs) {
    for (const assignment of normalizeDrugAssignments(drug)) {
      map.set(wellKey(assignment.rowIndex, assignment.columnIndex), {
        drugId: drug.id,
        drugName: drug.drugName,
        unit: drug.unit,
        concentration: assignment.concentration,
      });
    }
  }
  return map;
}

export function flexibleConcentrations(wells: DrugWellAssignment[]): FlexibleDrugConcentrations {
  return {
    mode: "wells",
    wells: wells
      .map((well) => ({
        rowIndex: well.rowIndex,
        columnIndex: well.columnIndex,
        concentration: well.concentration,
      }))
      .sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex),
  };
}
