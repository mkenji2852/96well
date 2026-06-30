import { z } from "zod";

const qcFlagsSchema = z.object({
  blur: z.boolean(),
  glare: z.boolean(),
  low_exposure: z.boolean(),
  skew: z.boolean(),
});

const wellPredictionSchema = z.object({
  well_id: z.string(),
  row_index: z.number().int().min(0).max(7),
  column_index: z.number().int().min(0).max(11),
  center: z.object({ x: z.number().int(), y: z.number().int() }),
  radius: z.number().int().positive(),
  prediction: z.enum(["growth", "no_growth"]),
  confidence: z.number().min(0).max(1),
  review_needed: z.boolean(),
  features: z.object({
    mean_intensity: z.number(),
    intensity_std: z.number(),
    dark_fraction: z.number().min(0).max(1),
  }),
});

const analysisSchema = z.object({
  service_version: z.string().min(1),
  qc_score: z.number().min(0).max(1),
  qc_flags: qcFlagsSchema,
  detected_wells: z.number().int().min(0).max(96),
  confidence: z.number().min(0).max(1),
  review_needed: z.boolean(),
  wells: z.array(wellPredictionSchema).max(96),
});

export type PlateImageAnalysis = z.infer<typeof analysisSchema>;

export interface ImageAnalysisOptions {
  baseUrl?: string;
  confidenceThreshold?: number;
  fileName?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class ImageAnalysisServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ImageAnalysisServiceError";
  }
}

export async function analyzePlateImage(
  image: Blob,
  options: ImageAnalysisOptions = {},
): Promise<PlateImageAnalysis> {
  const baseUrl = (options.baseUrl ?? process.env.IMAGE_ANALYSIS_URL ?? "http://127.0.0.1:8001").replace(/\/$/, "");
  const confidenceThreshold = options.confidenceThreshold ?? 0.85;
  if (confidenceThreshold < 0 || confidenceThreshold > 1) {
    throw new RangeError("confidenceThreshold must be between 0 and 1");
  }

  const form = new FormData();
  form.append("image", image, options.fileName ?? "plate-image.jpg");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${baseUrl}/v1/analyze?confidence_threshold=${confidenceThreshold}`,
      { method: "POST", body: form, signal: controller.signal },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new ImageAnalysisServiceError(`Image analysis failed (${response.status}): ${detail}`, response.status);
    }
    const parsed = analysisSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ImageAnalysisServiceError(`Invalid image analysis response: ${parsed.error.message}`);
    }

    const wells = parsed.data.wells.map((well) => ({
      ...well,
      review_needed: well.review_needed || well.confidence < confidenceThreshold,
    }));
    const hasQcFlag = Object.values(parsed.data.qc_flags).some(Boolean);
    return {
      ...parsed.data,
      wells,
      review_needed:
        parsed.data.review_needed ||
        parsed.data.confidence < confidenceThreshold ||
        parsed.data.detected_wells !== 96 ||
        hasQcFlag ||
        wells.some((well) => well.review_needed),
    };
  } catch (error) {
    if (error instanceof ImageAnalysisServiceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ImageAnalysisServiceError("Image analysis timed out");
    }
    throw new ImageAnalysisServiceError(error instanceof Error ? error.message : "Image analysis failed");
  } finally {
    clearTimeout(timeout);
  }
}

