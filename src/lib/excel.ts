import ExcelJS from "exceljs";
import { formatMic } from "@/lib/mic";
import { formatInterpretation } from "@/lib/rule-engine";
import type { ExportProfile, MicModifier, NoBreakpointOutputPolicy, RawMicOperator, SirCategory } from "@/types/domain";

export const EXPORT_PROFILES = ["ANONYMIZED", "CLINICAL_INTERNAL", "AUDIT_FULL"] as const satisfies readonly ExportProfile[];

export interface ExportSnapshot {
  plateId: string;
  plateRevision: string;
  wellRevision: number;
  resultRevision: number;
  breakpointSetId: string | null;
  rawMicIds: string[];
  sirInterpretationIds: string[];
  imageReviewIds: string[];
}

export interface ExportMetadata {
  exportId: string;
  profile: ExportProfile;
  generatedAt: Date;
  pseudonymousSampleId: string;
  breakpointSetId: string | null;
  breakpointStandard: string | null;
  breakpointVersion: string | null;
  breakpointContentHash: string | null;
  breakpointStatus: string | null;
  breakpointApprovedByUserId: string | null;
  breakpointApprovedAt: Date | null;
  noBreakpointPolicy: NoBreakpointOutputPolicy;
  includeNotes?: boolean;
  reason?: string | null;
  snapshot: ExportSnapshot;
}

interface ExportData {
  plate: {
    id: string;
    name: string;
    status: string;
    wellRevision: number;
    resultRevision: number;
    updatedAt: Date;
    sampleId: string;
    sample: { id?: string; sampleCode: string; organism: string | null; notes?: string | null; createdAt: Date };
    drugs: Array<{ id: string; rowIndex: number; drugName: string; unit: string; concentrations: unknown }>;
    wells: Array<{
      rowIndex: number;
      columnIndex: number;
      state: string;
      source: string;
      confidence: number | null;
      needsReview: boolean;
      observedAt: Date;
    }>;
    rawMics: Array<{
      id: string;
      breakpointSetId: string;
      value: number | null;
      modifier: MicModifier;
      rawMicOperator: string | null;
      calculationMethod: string;
      calculationEngineVersion: string;
      sourceWellRevision: number;
      status: string;
      supersedesId: string | null;
      supersededAt: Date | null;
      createdAt: Date;
      reviewRequired: boolean;
      rationaleJson: unknown;
      plateDrugId?: string;
      plateDrug: { drugName: string; unit: string };
      interpretations: Array<{
        id: string;
        breakpointSetId: string;
        category: string;
        standard: string | null;
        ruleVersion: string | null;
        ruleEngineVersion: string;
        status: string;
        supersedesId: string | null;
        supersededAt: Date | null;
        calculatedAt: Date;
        susceptibleMax: number | null;
        resistantMin: number | null;
        rationaleJson: unknown;
      }>;
    }>;
    imageAssessments?: Array<{
      id: string;
      status: string;
      manualReviewRequired: boolean;
      createdAt: Date;
      reviews: Array<{
        id: string;
        reviewerUserId: string | null;
        decision: string;
        reviewedAt: Date;
        rejectionReason: string | null;
        overrideReason: string | null;
      }>;
      overrides: Array<{
        id: string;
        reviewerUserId: string | null;
        rowIndex: number;
        columnIndex: number;
        beforeState: string;
        afterState: string;
        reason: string;
        modelVersion: string;
        createdAt: Date;
      }>;
    }>;
  };
  auditLogs: Array<{
    createdAt: Date;
    actorId: string | null;
    actorLabel: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeJson: unknown;
    afterJson: unknown;
  }>;
  metadata: ExportMetadata;
}

const navy = "FF17324D";
const teal = "FF147D78";
const headerStyle: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: navy } },
  alignment: { vertical: "middle", wrapText: true },
  border: { bottom: { style: "medium", color: { argb: teal } } },
};

const DANGEROUS_FORMULA_PREFIX = /^[=+\-@\t\r\n]/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function parseExportProfile(value: string | null): ExportProfile {
  return EXPORT_PROFILES.includes(value as ExportProfile) ? value as ExportProfile : "ANONYMIZED";
}

export function safeExcelText(value: string | null | undefined): string {
  if (value == null) return "";
  const normalized = String(value).replace(CONTROL_CHARS, " ").replace(/[\r\n\t]+/g, " ").trim();
  return DANGEROUS_FORMULA_PREFIX.test(normalized) ? `'${normalized}` : normalized;
}

function auditRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function auditString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return value == null ? "" : safeExcelText(String(value));
}

function styleHeader(row: ExcelJS.Row): void {
  row.height = 28;
  row.eachCell((cell) => { cell.style = headerStyle; });
}

function configureSheet(sheet: ExcelJS.Worksheet): void {
  sheet.properties.defaultRowHeight = 20;
  sheet.state = "visible";
  sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.headerFooter.oddFooter = "Page &P / &N";
}

function currentRawMics(plate: ExportData["plate"]) {
  return plate.rawMics.filter((mic) => mic.status === "CURRENT");
}

function currentInterpretation(mic: ExportData["plate"]["rawMics"][number]) {
  return mic.interpretations.find((item) => item.status === "CURRENT") ?? mic.interpretations[0] ?? null;
}

function categoryFor(interpretation: ReturnType<typeof currentInterpretation>): SirCategory {
  return (interpretation?.category ?? "NO_BREAKPOINT") as SirCategory;
}

function wellName(rowIndex: number, columnIndex: number): string {
  return `${String.fromCharCode(65 + rowIndex)}${columnIndex + 1}`;
}

function concentrationFor(drug: { concentrations: unknown }, columnIndex: number): number | null {
  const concentrations = Array.isArray(drug.concentrations) ? drug.concentrations : [];
  const value = concentrations[columnIndex];
  return typeof value === "number" ? value : null;
}

function addTitle(sheet: ExcelJS.Worksheet, title: string): void {
  sheet.addRow([title]);
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: navy } };
}

function addSummarySheet(workbook: ExcelJS.Workbook, { plate, metadata }: ExportData): void {
  const sheet = workbook.addWorksheet("Summary");
  configureSheet(sheet);
  sheet.views = [{ state: "frozen", ySplit: 11, showGridLines: false }];
  addTitle(sheet, "MIC Plate Result");
  sheet.addRows([
    ["Profile", metadata.profile, "Export sample ID", metadata.pseudonymousSampleId],
    ["Organism", safeExcelText(plate.sample.organism ?? "Not specified"), "Status", safeExcelText(plate.status)],
    ["Breakpoint standard", safeExcelText(metadata.breakpointStandard ?? "Saved result"), "Breakpoint version", safeExcelText(metadata.breakpointVersion ?? "Saved result")],
    ["Breakpoint content hash", metadata.profile === "ANONYMIZED" ? "Not included" : safeExcelText(metadata.breakpointContentHash?.slice(0, 16) ?? "")],
    ["Generated at", metadata.generatedAt.toISOString(), "No-breakpoint policy", metadata.noBreakpointPolicy],
    ["Well revision", metadata.snapshot.wellRevision, "Result revision", metadata.snapshot.resultRevision],
    ["Legend", "S = Susceptible | I = Intermediate/Increased exposure | R = Resistant | ND = Not determined"],
  ]);
  if (metadata.profile !== "ANONYMIZED") {
    sheet.addRow(["Sample code", safeExcelText(plate.sample.sampleCode)]);
  }
  if (metadata.profile !== "ANONYMIZED" && metadata.includeNotes) {
    sheet.addRow(["Notes", safeExcelText(plate.sample.notes ?? "")]);
  }
  sheet.addRow([]);

  const headers = metadata.profile === "ANONYMIZED"
    ? [
      "Export Sample ID", "Organism", "Drug", "Raw MIC", "MIC Value", "Unit", "Interpretation",
      "Breakpoint Standard", "Breakpoint Version", "MIC Engine", "SIR Engine", "Review Required", "Source Well Revision",
    ]
    : [
      "Sample Code", "Organism", "Drug", "Raw MIC", "MIC Value", "Unit", "Interpretation",
      "Breakpoint Standard", "Breakpoint Version", "MIC Engine", "SIR Engine", "Review Required", "Source Well Revision",
      "RawMic ID", "SirInterpretation ID", "Breakpoint Set ID",
    ];
  sheet.addRow(headers);
  const headerRowNumber = sheet.rowCount;
  styleHeader(sheet.getRow(headerRowNumber));

  for (const mic of currentRawMics(plate)) {
    const interpretation = currentInterpretation(mic);
    const operator = (mic.rawMicOperator as RawMicOperator | null) ?? null;
    const category = categoryFor(interpretation);
    const common = [
      metadata.profile === "ANONYMIZED" ? metadata.pseudonymousSampleId : safeExcelText(plate.sample.sampleCode),
      safeExcelText(plate.sample.organism ?? ""),
      safeExcelText(mic.plateDrug.drugName),
      formatMic(mic.value, operator ?? mic.modifier),
      mic.value,
      safeExcelText(mic.plateDrug.unit),
      formatInterpretation(category, metadata.noBreakpointPolicy),
      safeExcelText(interpretation?.standard ?? ""),
      safeExcelText(interpretation?.ruleVersion ?? ""),
      safeExcelText(mic.calculationEngineVersion),
      safeExcelText(interpretation?.ruleEngineVersion ?? ""),
      mic.reviewRequired ? "YES" : "NO",
      mic.sourceWellRevision,
    ];
    const row = sheet.addRow(metadata.profile === "ANONYMIZED"
      ? common
      : [...common, mic.id, interpretation?.id ?? "", mic.breakpointSetId]);
    const interpretationCell = row.getCell(7);
    const fills: Record<string, string> = { S: "FFD9EAD3", I: "FFFFF2CC", R: "FFF4CCCC", NO_BREAKPOINT: "FFE7E6E6", "N/A": "FFE7E6E6" };
    const fill = fills[String(interpretationCell.value)];
    if (fill) interpretationCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    interpretationCell.font = { bold: true };
  }

  sheet.columns = (metadata.profile === "ANONYMIZED"
    ? [20, 22, 20, 16, 12, 12, 18, 18, 18, 24, 24, 16, 20]
    : [18, 22, 20, 16, 12, 12, 18, 18, 18, 24, 24, 16, 20, 28, 28, 28]
  ).map((width) => ({ width }));
  sheet.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: headerRowNumber, column: headers.length } };
}

function addWellsSheet(workbook: ExcelJS.Workbook, { plate, metadata }: ExportData): void {
  const sheet = workbook.addWorksheet("Wells");
  configureSheet(sheet);
  const includeInternal = metadata.profile === "AUDIT_FULL";
  const headers = [
    ...(includeInternal ? ["Plate ID", "Sample ID"] : []),
    metadata.profile === "ANONYMIZED" ? "Export Sample ID" : "Sample Code",
    "Organism", "Drug", "Well", "Row", "Column", "Concentration", "Unit", "Raw State", "Source", "Confidence", "Review Required", "Observed At",
  ];
  sheet.addRow(headers);
  styleHeader(sheet.getRow(1));
  for (const drug of plate.drugs) {
    for (let columnIndex = 0; columnIndex < 12; columnIndex += 1) {
      const well = plate.wells.find((item) => item.rowIndex === drug.rowIndex && item.columnIndex === columnIndex);
      sheet.addRow([
        ...(includeInternal ? [plate.id, plate.sampleId] : []),
        metadata.profile === "ANONYMIZED" ? metadata.pseudonymousSampleId : safeExcelText(plate.sample.sampleCode),
        safeExcelText(plate.sample.organism ?? ""),
        safeExcelText(drug.drugName),
        wellName(drug.rowIndex, columnIndex),
        String.fromCharCode(65 + drug.rowIndex),
        columnIndex + 1,
        concentrationFor(drug, columnIndex),
        safeExcelText(drug.unit),
        safeExcelText(well?.state ?? "UNREAD"),
        safeExcelText(well?.source ?? "MANUAL"),
        well?.confidence ?? null,
        well?.needsReview ? "YES" : "NO",
        well?.observedAt ?? null,
      ]);
    }
  }
  sheet.columns = headers.map((header) => ({ header, width: header.includes("Observed") ? 22 : Math.max(12, Math.min(28, header.length + 8)) }));
  sheet.getColumn(headers.indexOf("Concentration") + 1).numFmt = "0.####";
  sheet.getColumn(headers.indexOf("Confidence") + 1).numFmt = "0.0%";
  sheet.getColumn(headers.indexOf("Observed At") + 1).numFmt = "yyyy-mm-dd hh:mm:ss";
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

function addMethodSheet(workbook: ExcelJS.Workbook, { metadata }: ExportData): void {
  const sheet = workbook.addWorksheet("Method");
  configureSheet(sheet);
  sheet.columns = [{ width: 30 }, { width: 72 }];
  addTitle(sheet, "Export Method and Privacy Profile");
  sheet.addRows([
    ["Profile", metadata.profile],
    ["Generated at", metadata.generatedAt.toISOString()],
    ["Export ID", metadata.exportId],
    ["Pseudonymization", "ANONYMIZED exports use an export-scoped random sample ID. The mapping is not included in the workbook."],
    ["Formula injection handling", "All user-provided strings are written as strings and prefixed when they start with formula metacharacters."],
    ["Breakpoint standard", safeExcelText(metadata.breakpointStandard ?? "")],
    ["Breakpoint version", safeExcelText(metadata.breakpointVersion ?? "")],
    ["Breakpoint content hash", metadata.profile === "AUDIT_FULL" ? safeExcelText(metadata.breakpointContentHash ?? "") : safeExcelText(metadata.breakpointContentHash?.slice(0, 16) ?? "")],
    ["Breakpoint set ID included in workbook", metadata.profile === "ANONYMIZED" ? "NO" : "YES"],
    ["Raw audit JSON included", metadata.profile === "AUDIT_FULL" ? "NO - allowed fields only" : "NO"],
    ["Hidden sheets", "NO"],
    ["Macros", "NO"],
    ["External data connections", "NO"],
  ]);
  if (metadata.profile === "AUDIT_FULL") {
    sheet.addRows([
      ["Breakpoint status", safeExcelText(metadata.breakpointStatus ?? "")],
      ["Breakpoint approved by user ID", safeExcelText(metadata.breakpointApprovedByUserId ?? "")],
      ["Breakpoint approved at", metadata.breakpointApprovedAt?.toISOString() ?? ""],
    ]);
  }
}

function addReviewSummarySheet(workbook: ExcelJS.Workbook, { plate }: ExportData): void {
  const sheet = workbook.addWorksheet("ReviewSummary");
  configureSheet(sheet);
  sheet.columns = [
    { header: "Assessment Status", key: "status", width: 20 },
    { header: "Manual Review Required", key: "manualReviewRequired", width: 24 },
    { header: "Decision", key: "decision", width: 16 },
    { header: "Reviewed At", key: "reviewedAt", width: 22 },
    { header: "Reviewer", key: "reviewer", width: 18 },
    { header: "Override Count", key: "overrideCount", width: 16 },
  ];
  styleHeader(sheet.getRow(1));
  for (const assessment of plate.imageAssessments ?? []) {
    const latestReview = [...assessment.reviews].sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime())[0];
    sheet.addRow({
      status: safeExcelText(assessment.status),
      manualReviewRequired: assessment.manualReviewRequired ? "YES" : "NO",
      decision: safeExcelText(latestReview?.decision ?? ""),
      reviewedAt: latestReview?.reviewedAt ?? null,
      reviewer: safeExcelText(latestReview?.reviewerUserId ?? ""),
      overrideCount: assessment.overrides.length,
    });
  }
  sheet.getColumn("reviewedAt").numFmt = "yyyy-mm-dd hh:mm:ss";
}

function addReviewHistorySheet(workbook: ExcelJS.Workbook, { plate }: ExportData): void {
  const sheet = workbook.addWorksheet("ReviewHistory");
  configureSheet(sheet);
  sheet.columns = [
    { header: "Assessment ID", key: "assessmentId", width: 28 },
    { header: "Assessment Status", key: "assessmentStatus", width: 20 },
    { header: "Review ID", key: "reviewId", width: 28 },
    { header: "Reviewer User ID", key: "reviewerUserId", width: 24 },
    { header: "Decision", key: "decision", width: 16 },
    { header: "Reviewed At", key: "reviewedAt", width: 22 },
    { header: "Rejection Reason", key: "rejectionReason", width: 42 },
    { header: "Override Reason", key: "overrideReason", width: 42 },
    { header: "Override Well", key: "overrideWell", width: 14 },
    { header: "Before", key: "before", width: 16 },
    { header: "After", key: "after", width: 16 },
    { header: "Override Reason Detail", key: "overrideReasonDetail", width: 42 },
    { header: "Model Version", key: "modelVersion", width: 20 },
  ];
  styleHeader(sheet.getRow(1));
  for (const assessment of plate.imageAssessments ?? []) {
    for (const review of assessment.reviews) {
      sheet.addRow({
        assessmentId: assessment.id,
        assessmentStatus: safeExcelText(assessment.status),
        reviewId: review.id,
        reviewerUserId: safeExcelText(review.reviewerUserId ?? ""),
        decision: safeExcelText(review.decision),
        reviewedAt: review.reviewedAt,
        rejectionReason: safeExcelText(review.rejectionReason ?? ""),
        overrideReason: safeExcelText(review.overrideReason ?? ""),
      });
    }
    for (const override of assessment.overrides) {
      sheet.addRow({
        assessmentId: assessment.id,
        assessmentStatus: safeExcelText(assessment.status),
        reviewerUserId: safeExcelText(override.reviewerUserId ?? ""),
        overrideWell: wellName(override.rowIndex, override.columnIndex),
        before: safeExcelText(override.beforeState),
        after: safeExcelText(override.afterState),
        overrideReasonDetail: safeExcelText(override.reason),
        modelVersion: safeExcelText(override.modelVersion),
      });
    }
  }
  sheet.getColumn("reviewedAt").numFmt = "yyyy-mm-dd hh:mm:ss";
}

function addInterpretationHistorySheet(workbook: ExcelJS.Workbook, { plate, metadata }: ExportData): void {
  const sheet = workbook.addWorksheet("InterpretationHistory");
  configureSheet(sheet);
  sheet.columns = [
    { header: "RawMic ID", key: "rawMicId", width: 28 },
    { header: "RawMic Status", key: "rawStatus", width: 16 },
    { header: "RawMic Supersedes", key: "rawSupersedes", width: 28 },
    { header: "RawMic Superseded At", key: "rawSupersededAt", width: 22 },
    { header: "SirInterpretation ID", key: "sirId", width: 28 },
    { header: "SIR Status", key: "sirStatus", width: 16 },
    { header: "SIR Supersedes", key: "sirSupersedes", width: 28 },
    { header: "SIR Superseded At", key: "sirSupersededAt", width: 22 },
    { header: "Drug", key: "drug", width: 20 },
    { header: "Raw MIC", key: "rawMic", width: 18 },
    { header: "Interpretation", key: "interpretation", width: 16 },
    { header: "Breakpoint Set ID", key: "breakpointSetId", width: 28 },
    { header: "Standard", key: "standard", width: 16 },
    { header: "Version", key: "version", width: 18 },
    { header: "MIC Engine", key: "micEngine", width: 24 },
    { header: "SIR Engine", key: "sirEngine", width: 24 },
    { header: "Source Well Revision", key: "sourceWellRevision", width: 20 },
    { header: "Created/Calculated At", key: "calculatedAt", width: 22 },
  ];
  styleHeader(sheet.getRow(1));
  for (const mic of plate.rawMics) {
    for (const interpretation of mic.interpretations) {
      sheet.addRow({
        rawMicId: mic.id,
        rawStatus: safeExcelText(mic.status),
        rawSupersedes: mic.supersedesId,
        rawSupersededAt: mic.supersededAt,
        sirId: interpretation.id,
        sirStatus: safeExcelText(interpretation.status),
        sirSupersedes: interpretation.supersedesId,
        sirSupersededAt: interpretation.supersededAt,
        drug: safeExcelText(mic.plateDrug.drugName),
        rawMic: formatMic(mic.value, (mic.rawMicOperator as RawMicOperator | null) ?? mic.modifier),
        interpretation: formatInterpretation(interpretation.category as SirCategory, metadata.noBreakpointPolicy),
        breakpointSetId: interpretation.breakpointSetId,
        standard: safeExcelText(interpretation.standard ?? ""),
        version: safeExcelText(interpretation.ruleVersion ?? ""),
        micEngine: safeExcelText(mic.calculationEngineVersion),
        sirEngine: safeExcelText(interpretation.ruleEngineVersion),
        sourceWellRevision: mic.sourceWellRevision,
        calculatedAt: interpretation.calculatedAt,
      });
    }
  }
  sheet.getColumn("rawSupersededAt").numFmt = "yyyy-mm-dd hh:mm:ss";
  sheet.getColumn("sirSupersededAt").numFmt = "yyyy-mm-dd hh:mm:ss";
  sheet.getColumn("calculatedAt").numFmt = "yyyy-mm-dd hh:mm:ss";
}

function addAuditSheet(workbook: ExcelJS.Workbook, { auditLogs }: ExportData): void {
  const sheet = workbook.addWorksheet("Audit");
  configureSheet(sheet);
  sheet.columns = [
    { header: "Timestamp", key: "createdAt", width: 22 },
    { header: "Actor User ID", key: "actorId", width: 24 },
    { header: "Action", key: "action", width: 28 },
    { header: "Entity Type", key: "entityType", width: 18 },
    { header: "Entity ID", key: "entityId", width: 28 },
    { header: "Before Status", key: "beforeStatus", width: 18 },
    { header: "After Status", key: "afterStatus", width: 18 },
    { header: "Export ID", key: "exportId", width: 28 },
    { header: "Profile", key: "profile", width: 18 },
    { header: "Reason", key: "reason", width: 42 },
    { header: "Plate ID", key: "plateId", width: 28 },
    { header: "Drug ID", key: "drugId", width: 28 },
    { header: "Previous Result ID", key: "previousResultId", width: 28 },
    { header: "New Result ID", key: "newResultId", width: 28 },
    { header: "Source Well Revision", key: "sourceWellRevision", width: 20 },
    { header: "Breakpoint Set ID", key: "breakpointSetId", width: 28 },
    { header: "Engine Version", key: "engineVersion", width: 24 },
    { header: "Error Code", key: "errorCode", width: 24 },
    { header: "Success", key: "success", width: 12 },
  ];
  styleHeader(sheet.getRow(1));
  auditLogs.forEach((item) => {
    const before = auditRecord(item.beforeJson);
    const after = auditRecord(item.afterJson);
    const row = sheet.addRow({
      createdAt: item.createdAt,
      actorId: safeExcelText(item.actorId ?? ""),
      action: safeExcelText(item.action),
      entityType: safeExcelText(item.entityType),
      entityId: safeExcelText(item.entityId),
      beforeStatus: auditString(before, "status"),
      afterStatus: auditString(after, "status"),
      exportId: auditString(after, "exportId") || auditString(before, "exportId"),
      profile: auditString(after, "profile") || auditString(before, "profile"),
      reason: auditString(after, "reason") || auditString(before, "reason"),
      plateId: auditString(after, "plateId") || auditString(before, "plateId"),
      drugId: auditString(after, "drugId") || auditString(before, "drugId"),
      previousResultId: auditString(after, "previousResultId") || auditString(before, "previousResultId"),
      newResultId: auditString(after, "newResultId") || auditString(before, "newResultId"),
      sourceWellRevision: after.sourceWellRevision ?? before.sourceWellRevision ?? "",
      breakpointSetId: auditString(after, "breakpointSetId") || auditString(before, "breakpointSetId"),
      engineVersion: auditString(after, "engineVersion") || auditString(before, "engineVersion"),
      errorCode: auditString(after, "errorCode") || auditString(before, "errorCode"),
      success: after.success ?? before.success ?? "",
    });
    row.height = 48;
    row.getCell(10).alignment = { wrapText: true, vertical: "top" };
  });
  sheet.getColumn("createdAt").numFmt = "yyyy-mm-dd hh:mm:ss";
}

function addExportMetadataSheet(workbook: ExcelJS.Workbook, { metadata }: ExportData): void {
  const sheet = workbook.addWorksheet("ExportMetadata");
  configureSheet(sheet);
  sheet.columns = [{ width: 30 }, { width: 100 }];
  addTitle(sheet, "Export Metadata");
  const snapshot = metadata.snapshot;
  sheet.addRows([
    ["Export ID", metadata.exportId],
    ["Profile", metadata.profile],
    ["Reason", safeExcelText(metadata.reason ?? "")],
    ["Plate ID", snapshot.plateId],
    ["Plate Revision", snapshot.plateRevision],
    ["Well Revision", snapshot.wellRevision],
    ["Result Revision", snapshot.resultRevision],
    ["Breakpoint Set ID", snapshot.breakpointSetId ?? ""],
    ["Breakpoint Content Hash", metadata.breakpointContentHash ?? ""],
    ["Breakpoint Status", metadata.breakpointStatus ?? ""],
    ["Breakpoint Approved By User ID", metadata.breakpointApprovedByUserId ?? ""],
    ["Breakpoint Approved At", metadata.breakpointApprovedAt?.toISOString() ?? ""],
    ["RawMic IDs", snapshot.rawMicIds.join(",")],
    ["SirInterpretation IDs", snapshot.sirInterpretationIds.join(",")],
    ["ImageReview IDs", snapshot.imageReviewIds.join(",")],
  ]);
}

export async function buildPlateWorkbook(data: ExportData): Promise<Buffer> {
  const { metadata } = data;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MIC Plate Recorder";
  workbook.lastModifiedBy = "MIC Plate Recorder";
  workbook.created = metadata.generatedAt;
  workbook.modified = metadata.generatedAt;
  workbook.subject = "MIC result export";
  workbook.title = "MIC Plate Result";
  workbook.company = "MIC Plate Recorder";
  workbook.keywords = metadata.profile === "AUDIT_FULL"
    ? "MIC, antimicrobial susceptibility, audit"
    : "MIC, antimicrobial susceptibility";

  addSummarySheet(workbook, data);
  addWellsSheet(workbook, data);
  addMethodSheet(workbook, data);
  if (metadata.profile === "CLINICAL_INTERNAL") addReviewSummarySheet(workbook, data);
  if (metadata.profile === "AUDIT_FULL") {
    addReviewHistorySheet(workbook, data);
    addInterpretationHistorySheet(workbook, data);
    addAuditSheet(workbook, data);
    addExportMetadataSheet(workbook, data);
  }

  for (const sheet of workbook.worksheets) {
    sheet.state = "visible";
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
