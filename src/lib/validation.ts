import { z } from "zod";

export const createSampleSchema = z.object({
  sampleCode: z.string().trim().min(1).max(80),
  organism: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  plateName: z.string().trim().min(1).max(120).optional(),
  drugs: z.array(
    z.object({
      rowIndex: z.number().int().min(0).max(95).optional(),
      drugName: z.string().trim().min(1).max(120),
      unit: z.string().trim().min(1).max(30),
      concentrations: z.array(z.number().positive()).length(12).optional(),
      wells: z.array(z.object({
        rowIndex: z.number().int().min(0).max(7),
        columnIndex: z.number().int().min(0).max(11),
        concentration: z.number().positive(),
      }).strict()).min(1).max(96).optional(),
    }).strict().refine((value) => Boolean(value.concentrations) || Boolean(value.wells), {
      message: "concentrations or wells is required",
    }),
  ).min(1).max(96),
});

export const createBreakpointSchema = z.object({
  drugName: z.string().trim().min(1).max(120),
  organism: z.string().trim().max(120).optional(),
  standard: z.enum(["CLSI", "EUCAST", "JANIS_COMPAT"]),
  version: z.string().trim().min(1).max(80),
  susceptibleMax: z.number().nonnegative(),
  resistantMin: z.number().positive(),
  unit: z.string().trim().min(1).max(30),
}).refine((value) => value.susceptibleMax < value.resistantMin, {
  message: "resistantMin must be greater than susceptibleMax",
});

const breakpointStandardSchema = z.enum(["CLSI", "EUCAST", "JANIS_COMPAT"]);
const nullableDateSchema = z.string().datetime({ offset: true }).nullable().optional();

export const createBreakpointSetSchema = z.object({
  standard: breakpointStandardSchema,
  version: z.string().trim().min(1).max(80),
  organism: z.string().trim().max(120).nullable().optional(),
  unit: z.string().trim().min(1).max(30).default("µg/mL"),
  method: z.string().trim().min(1).max(80).default("BROTH_MICRODILUTION"),
  effectiveFrom: nullableDateSchema,
  effectiveTo: nullableDateSchema,
  sourceDocumentReference: z.string().trim().max(500).nullable().optional(),
  sourceDocumentChecksum: z.string().trim().max(128).nullable().optional(),
}).strict().refine((value) => {
  if (!value.effectiveFrom || !value.effectiveTo) return true;
  return new Date(value.effectiveFrom).getTime() < new Date(value.effectiveTo).getTime();
}, { message: "effectiveToはeffectiveFromより後に設定してください。", path: ["effectiveTo"] });

export const updateBreakpointSetSchema = createBreakpointSetSchema.partial().extend({
  expectedRevision: z.number().int().min(0),
}).strict();

export const breakpointRuleSchema = z.object({
  drugName: z.string().trim().min(1).max(120),
  organism: z.string().trim().max(120).nullable().optional(),
  susceptibleMax: z.number().nonnegative(),
  resistantMin: z.number().positive(),
  intermediateMin: z.number().nonnegative().nullable().optional(),
  intermediateMax: z.number().nonnegative().nullable().optional(),
  unit: z.string().trim().min(1).max(30),
  method: z.string().trim().min(1).max(80),
  exceptionJson: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.susceptibleMax >= value.resistantMin) {
    context.addIssue({ code: "custom", message: "resistantMinはsusceptibleMaxより大きくしてください。", path: ["resistantMin"] });
  }
  if (value.intermediateMin != null && value.intermediateMin <= value.susceptibleMax) {
    context.addIssue({ code: "custom", message: "intermediateMinはsusceptibleMaxより大きくしてください。", path: ["intermediateMin"] });
  }
  if (value.intermediateMax != null && value.intermediateMax >= value.resistantMin) {
    context.addIssue({ code: "custom", message: "intermediateMaxはresistantMinより小さくしてください。", path: ["intermediateMax"] });
  }
  if (value.intermediateMin != null && value.intermediateMax != null && value.intermediateMin > value.intermediateMax) {
    context.addIssue({ code: "custom", message: "intermediateMinはintermediateMax以下にしてください。", path: ["intermediateMax"] });
  }
});

export const createBreakpointRuleSchema = breakpointRuleSchema.safeExtend({
  expectedRevision: z.number().int().min(0),
}).strict();

export const updateBreakpointRuleSchema = breakpointRuleSchema.partial().safeExtend({
  expectedRevision: z.number().int().min(0),
}).strict();

export const approveBreakpointSetSchema = z.object({
  expectedRevision: z.number().int().min(0),
  approvalComment: z.string().trim().max(1000).nullable().optional(),
}).strict();

export const retireBreakpointSetSchema = z.object({
  expectedRevision: z.number().int().min(0),
  reason: z.string().trim().min(1).max(1000),
}).strict();

export const cloneBreakpointSetSchema = z.object({
  version: z.string().trim().min(1).max(80),
}).strict();

const wellStateSchema = z.enum(["UNREAD", "GROWTH", "INHIBITED", "CONTAMINATED", "SKIPPED"]);
const confirmedWellSchema = z.object({
  rowIndex: z.number().int().min(0).max(7),
  columnIndex: z.number().int().min(0).max(11),
  state: wellStateSchema,
}).strict();

function hasUniqueWellCoordinates(wells: Array<{ rowIndex: number; columnIndex: number }>): boolean {
  return new Set(wells.map((well) => `${well.rowIndex}:${well.columnIndex}`)).size === wells.length;
}

export const savePlateSchema = z.object({
  wells: z.array(z.object({
    rowIndex: z.number().int().min(0).max(7),
    columnIndex: z.number().int().min(0).max(11),
    state: wellStateSchema,
    source: z.literal("MANUAL").default("MANUAL"),
  }).strict()).max(96).refine(hasUniqueWellCoordinates, {
    message: "well coordinates must be unique",
  }),
  breakpointSetId: z.string().trim().max(200).optional(),
  breakpointChangeReason: z.string().trim().min(1).max(1000).optional(),
  expectedRevision: z.number().int().min(0).optional(),
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  breakpointStandard: z.enum(["CLSI", "EUCAST", "JANIS_COMPAT"]).optional(),
  breakpointVersion: z.string().trim().min(1).max(80).optional(),
}).refine((value) => Boolean(value.breakpointStandard) === Boolean(value.breakpointVersion), {
  message: "breakpointStandard and breakpointVersion must be supplied together",
});

export const approveImageAssessmentSchema = z.object({
  breakpointSetId: z.string().trim().min(1).max(200).optional(),
  breakpointChangeReason: z.string().trim().min(1).max(1000).optional(),
  confirmedWells: z.array(confirmedWellSchema).length(96).refine(hasUniqueWellCoordinates, {
    message: "96個のウェル確認結果が必要です",
  }),
  overrideReason: z.string().trim().min(1).max(1000).optional(),
}).strict();

export const rejectImageAssessmentSchema = z.object({
  rejectionReason: z.string().trim().min(1).max(1000),
}).strict();

export const overrideImageWellSchema = confirmedWellSchema.extend({
  reason: z.string().trim().min(1).max(1000),
}).strict();
