import { z } from "zod";
import type { PlateImageAnalysis } from "@/lib/image-analysis";
import type { WellState } from "@/types/domain";

export interface NormalizedImagePrediction {
  wellId: string;
  rowIndex: number;
  columnIndex: number;
  state: Extract<WellState, "GROWTH" | "INHIBITED">;
  confidence: number;
  reviewNeeded: boolean;
}

const storedPredictionSchema = z.array(z.object({
  wellId: z.string(),
  rowIndex: z.number().int().min(0).max(7),
  columnIndex: z.number().int().min(0).max(11),
  state: z.enum(["GROWTH", "INHIBITED"]),
  confidence: z.number().min(0).max(1),
  reviewNeeded: z.boolean(),
}));

export function normalizeImageAnalysisPredictions(analysis: PlateImageAnalysis): NormalizedImagePrediction[] {
  return analysis.wells.map((well) => ({
    wellId: well.well_id,
    rowIndex: well.row_index,
    columnIndex: well.column_index,
    state: well.prediction === "growth" ? "GROWTH" : "INHIBITED",
    confidence: well.confidence,
    reviewNeeded: true,
  }));
}

export function parseStoredPredictions(value: unknown): NormalizedImagePrediction[] {
  return storedPredictionSchema.parse(value);
}

export function wellKey(rowIndex: number, columnIndex: number): string {
  return `${rowIndex}:${columnIndex}`;
}
