import type { ReviewWellState } from "@/types/image-review";
import type { WellState } from "@/types/domain";

export const REVIEW_WELL_STATES = [
  "GROWTH",
  "NO_GROWTH",
  "UNCERTAIN",
  "CONTAMINATED",
  "UNREADABLE",
] as const satisfies readonly ReviewWellState[];

export const reviewStateLabels: Record<ReviewWellState, { ja: string; short: string; symbol: string }> = {
  GROWTH: { ja: "発育あり", short: "発育", symbol: "+" },
  NO_GROWTH: { ja: "発育なし", short: "なし", symbol: "−" },
  UNCERTAIN: { ja: "不確実", short: "不確実", symbol: "?" },
  CONTAMINATED: { ja: "汚染", short: "汚染", symbol: "!" },
  UNREADABLE: { ja: "読取不可", short: "不可", symbol: "×" },
};

export function apiWellStateToReviewState(state: WellState): ReviewWellState {
  if (state === "GROWTH") return "GROWTH";
  if (state === "INHIBITED") return "NO_GROWTH";
  if (state === "CONTAMINATED") return "CONTAMINATED";
  if (state === "SKIPPED") return "UNREADABLE";
  return "UNCERTAIN";
}

export function reviewStateToApiWellState(state: ReviewWellState): WellState {
  if (state === "GROWTH") return "GROWTH";
  if (state === "NO_GROWTH") return "INHIBITED";
  if (state === "CONTAMINATED") return "CONTAMINATED";
  if (state === "UNREADABLE") return "SKIPPED";
  return "UNREAD";
}

export function wellKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`;
}

export function wellName(rowIndex: number, columnIndex: number): string {
  return `${String.fromCharCode(65 + rowIndex)}${columnIndex + 1}`;
}
