import type { WellState } from "@/types/domain";

export const PLATE_ROWS = 8;
export const PLATE_COLUMNS = 12;

export const UI_WELL_STATES = ["EMPTY", "GROWTH", "NO_GROWTH", "REVIEW_NEEDED"] as const;
export type UiWellState = (typeof UI_WELL_STATES)[number];
export type PlateStateMap = Record<string, UiWellState>;

export interface WellDetails {
  drugName: string;
  concentration: string;
  unit: string;
  note: string;
}

export type WellDetailsMap = Record<string, WellDetails>;

export function wellKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}-${columnIndex}`;
}

export function createEmptyPlate(): PlateStateMap {
  return Object.fromEntries(
    Array.from({ length: PLATE_ROWS }, (_, rowIndex) =>
      Array.from({ length: PLATE_COLUMNS }, (_, columnIndex) => [wellKey(rowIndex, columnIndex), "EMPTY"] as const),
    ).flat(),
  );
}

export function cycleWellState(state: UiWellState): UiWellState {
  const index = UI_WELL_STATES.indexOf(state);
  return UI_WELL_STATES[(index + 1) % UI_WELL_STATES.length];
}

export function applyStateToRow(
  states: PlateStateMap,
  rowIndex: number,
  state: UiWellState,
): PlateStateMap {
  const next = { ...states };
  for (let columnIndex = 0; columnIndex < PLATE_COLUMNS; columnIndex += 1) {
    next[wellKey(rowIndex, columnIndex)] = state;
  }
  return next;
}

export function applyStateToColumn(
  states: PlateStateMap,
  columnIndex: number,
  state: UiWellState,
): PlateStateMap {
  const next = { ...states };
  for (let rowIndex = 0; rowIndex < PLATE_ROWS; rowIndex += 1) {
    next[wellKey(rowIndex, columnIndex)] = state;
  }
  return next;
}

export function countEmptyWells(states: PlateStateMap): number {
  return Object.values(states).filter((state) => state === "EMPTY").length;
}

export function toUiWellState(state: WellState): UiWellState {
  if (state === "GROWTH") return "GROWTH";
  if (state === "INHIBITED") return "NO_GROWTH";
  if (state === "CONTAMINATED" || state === "SKIPPED") return "REVIEW_NEEDED";
  return "EMPTY";
}

export function toApiWellState(state: UiWellState): WellState {
  if (state === "GROWTH") return "GROWTH";
  if (state === "NO_GROWTH") return "INHIBITED";
  if (state === "REVIEW_NEEDED") return "SKIPPED";
  return "UNREAD";
}

export function validatePlate(states: PlateStateMap, details: WellDetailsMap): string[] {
  const errors: string[] = [];
  const emptyCount = countEmptyWells(states);
  if (emptyCount > 0) errors.push(`未入力ウェルが${emptyCount}個あります。すべて入力してください。`);

  const missingReviewNotes: string[] = [];
  const invalidConcentrations: string[] = [];
  const missingUnits: string[] = [];

  for (let rowIndex = 0; rowIndex < PLATE_ROWS; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < PLATE_COLUMNS; columnIndex += 1) {
      const key = wellKey(rowIndex, columnIndex);
      const coordinate = `${String.fromCharCode(65 + rowIndex)}${columnIndex + 1}`;
      const detail = details[key];
      if (states[key] === "REVIEW_NEEDED" && !detail?.note.trim()) missingReviewNotes.push(coordinate);
      if (detail?.concentration.trim()) {
        const value = Number(detail.concentration);
        if (!Number.isFinite(value) || value < 0) invalidConcentrations.push(coordinate);
        if (!detail.unit.trim()) missingUnits.push(coordinate);
      }
    }
  }

  if (missingReviewNotes.length > 0) {
    errors.push(`要確認ウェルにはメモが必要です（${missingReviewNotes.slice(0, 6).join("、")}）。`);
  }
  if (invalidConcentrations.length > 0) {
    errors.push(`濃度は0以上の数値で入力してください（${invalidConcentrations.slice(0, 6).join("、")}）。`);
  }
  if (missingUnits.length > 0) {
    errors.push(`濃度を入力したウェルには単位が必要です（${missingUnits.slice(0, 6).join("、")}）。`);
  }
  return errors;
}
