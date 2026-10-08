import ExcelJS from "exceljs";
import { normalizeDrugAssignments } from "@/lib/drug-layout";
import { calculateRawMic, formatMic } from "@/lib/mic";
import { formatInterpretation } from "@/lib/rule-engine";
import { calculateMicStatistics, type PopulationMic } from "@/lib/mic-statistics";
import type { ExportProfile, MicModifier, NoBreakpointOutputPolicy, RawMicOperator, SirCategory, WellState } from "@/types/domain";

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

export interface ExportData {
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

function normalizeWellState(value: string | undefined): WellState {
  if (value === "UNREAD" || value === "GROWTH" || value === "INHIBITED" || value === "CONTAMINATED" || value === "SKIPPED") {
    return value;
  }
  return "UNREAD";
}

function addTitle(sheet: ExcelJS.Worksheet, title: string): void {
  sheet.addRow([title]);
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: navy } };
}

function breakpointApplicationFields(rationale: unknown): string[] {
  const data = rationale && typeof rationale === "object" ? rationale as Record<string, unknown> : {};
  const application = data.application && typeof data.application === "object" ? data.application as Record<string, unknown> : {};
  const breakpoint = data.breakpoint && typeof data.breakpoint === "object" ? data.breakpoint as Record<string, unknown> : {};
  const organism = application.breakpointOrganism ?? breakpoint.organism;
  return [
    safeExcelText(typeof organism === "string" ? organism : ""),
    application.mode === "RESEARCH_CROSS_ORGANISM" ? "RESEARCH ONLY: cross-organism application" : "",
  ];
}

function populationEntries(plate: ExportData["plate"]): Array<PopulationMic & { text: string; category: SirCategory }> {
  const current = currentRawMics(plate);
  return plate.drugs.flatMap(drug => {
    const saved = current.find(mic => mic.plateDrugId === drug.id || (!mic.plateDrugId && mic.plateDrug.drugName === drug.drugName && mic.plateDrug.unit === drug.unit));
    const assignments = normalizeDrugAssignments(drug);
    if (!saved && !assignments.length) return [];
    const derived = saved ? null : calculateRawMic(assignments.map(item => item.concentration), assignments.map(item => {
      const well = plate.wells.find(well => well.rowIndex === item.rowIndex && well.columnIndex === item.columnIndex);
      return normalizeWellState(well && (well.source === "MANUAL" || well.source === "IMAGE_REVIEWED") ? well.state : undefined);
    }));
    const operator: RawMicOperator | null = saved
      ? (saved.rawMicOperator as RawMicOperator | null) ?? (saved.modifier === "EQUAL" ? "=" : saved.modifier === "LESS_THAN_OR_EQUAL" ? "<=" : saved.modifier === "GREATER_THAN" ? ">" : null)
      : derived!.rawMicOperator;
    const value = saved ? saved.value : derived!.value;
    return [{
      sampleId: plate.sample.id ?? plate.sampleId, organism: plate.sample.organism, drugName: drug.drugName, unit: drug.unit,
      value, operator, needsReview: saved ? saved.reviewRequired || saved.sourceWellRevision !== plate.wellRevision : derived!.needsReview,
      text: formatMic(value, operator), category: saved ? categoryFor(currentInterpretation(saved)) : "NO_BREAKPOINT",
    }];
  });
}

export async function buildPopulationWorkbook(data: ExportData[]): Promise<Buffer> {
  if (!data.length || data.length > 50) throw new Error("Select between 1 and 50 samples.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = workbook.lastModifiedBy = workbook.company = "MIC Plate Recorder";
  workbook.created = workbook.modified = data[0].metadata.generatedAt;
  workbook.title = "Research MIC population export";
  const records = data.map(item => ({ data: item, entries: populationEntries(item.plate) }));
  const keys = [...new Set(records.flatMap(record => record.entries.map(entry => JSON.stringify([entry.drugName, entry.unit]))))];
  if (keys.length > 200) throw new Error("Too many drug/unit groups for one export.");
  const summary = workbook.addWorksheet("Summary");
  configureSheet(summary);
  addTitle(summary, "研究用 MIC / 判定一覧");
  summary.addRow(["各Sampleの最新プレート1件。Breakpointなしは空白。MIC50/MIC90はMICStatisticsを参照。"]);
  const drugHeader = summary.addRow(["Sample-ID", "菌名", ...keys.flatMap(key => [safeExcelText(JSON.parse(key)[0]), ""])]);
  const fields = summary.addRow(["", "", ...keys.flatMap(key => [safeExcelText(`MIC (${JSON.parse(key)[1]})`), "判定"])]);
  styleHeader(drugHeader); styleHeader(fields);
  keys.forEach((_, index) => summary.mergeCells(drugHeader.number, index * 2 + 3, drugHeader.number, index * 2 + 4));
  for (const record of records) {
    const row: ExcelJS.CellValue[] = [safeExcelText(record.data.plate.sample.sampleCode), safeExcelText(record.data.plate.sample.organism ?? "")];
    for (const key of keys) {
      const [drugName, unit] = JSON.parse(key) as string[];
      const entries = record.entries.filter(entry => entry.drugName === drugName && entry.unit === unit);
      if (entries.length > 1) row.push(entries.map(entry => entry.text).join(" / "), "重複測定・集計除外");
      else if (entries.length === 1) row.push(entries[0].text, entries[0].category === "NO_BREAKPOINT" ? "" : formatInterpretation(entries[0].category));
      else row.push("", "");
    }
    const added = summary.addRow(row);
    keys.forEach((key, index) => {
      const [drugName, unit] = JSON.parse(key) as string[];
      if (record.entries.some(entry => entry.drugName === drugName && entry.unit === unit && entry.needsReview)) {
        added.getCell(index * 2 + 3).note = "要確認またはウェルrevision不一致のためMIC50/MIC90集計から除外しました。";
      }
    });
  }
  summary.columns = [{ width: 24 }, { width: 26 }, ...keys.flatMap(() => [{ width: 20 }, { width: 16 }])];
  summary.views = [{ state: "frozen", xSplit: 2, ySplit: fields.number, showGridLines: false }];
  const statistics = workbook.addWorksheet("MICStatistics");
  configureSheet(statistics);
  statistics.addRow(["菌名", "薬剤名", "単位", "対象Sample数", "集計数 N", "未確定・要確認除外", "重複測定除外", "境界付きMIC数", "MIC50", "MIC90"]);
  styleHeader(statistics.getRow(1));
  for (const result of calculateMicStatistics(records.flatMap(record => record.entries))) {
    statistics.addRow([safeExcelText(result.organism ?? "未設定"), safeExcelText(result.drugName), safeExcelText(result.unit),
      result.totalSamples, result.includedSamples, result.invalidSamples, result.duplicateSamples, result.qualifiedSamples, result.mic50, result.mic90]);
  }
  statistics.columns = [26, 26, 14, 18, 14, 24, 20, 18, 24, 24].map(width => ({ width }));
  statistics.addRow([]);
  statistics.addRow(["方式: nearest-rank（順位 ceil(N×0.50) / ceil(N×0.90)）。希釈濃度を補間しません。"]);
  statistics.addRow(["≤ / < / ≥ / > は境界として集計し、確定できない場合は区間または未確定を表示。菌種・薬剤・単位は混ぜません。"]);
  statistics.addRow(["同一Sampleの同一薬剤・単位の重複測定、未確定MIC、要確認結果は集計から除外。少数例もNを併記する研究用集計です。"]);
  const commonBreakpoint = data.find(item => item.metadata.breakpointSetId)?.metadata ?? data[0].metadata;
  addMethodSheet(workbook, { ...data[0], metadata: { ...data[0].metadata,
    breakpointSetId: commonBreakpoint.breakpointSetId, breakpointStandard: commonBreakpoint.breakpointStandard,
    breakpointVersion: commonBreakpoint.breakpointVersion, breakpointContentHash: commonBreakpoint.breakpointContentHash,
  } });
  const method = workbook.getWorksheet("Method")!;
  const wells = workbook.addWorksheet("Wells");
  for (const item of data) {
    addWellsSheet(workbook, item, wells);
    if (item !== data[0]) addResultDetails(method, item);
  }
  workbook.worksheets.forEach(sheet => { sheet.state = "visible"; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addSummarySheet(workbook: ExcelJS.Workbook, data: ExportData): void {
  const { plate, metadata } = data;
  const sheet = workbook.addWorksheet("Summary");
  configureSheet(sheet);
  sheet.columns = [{ width: 32 }, { width: 20 }, { width: 38 }];
  addTitle(sheet, "MIC / 判定一覧");
  sheet.mergeCells("A1:C1");
  sheet.addRow(["研究用・非臨床利用"]);
  sheet.mergeCells("A2:C2");
  sheet.addRows([
    ["菌名", "", safeExcelText(plate.sample.organism ?? "")],
    ["Breakpoint", "", safeExcelText([metadata.breakpointStandard, metadata.breakpointVersion].filter(Boolean).join(" "))],
    ["作成日時", "", metadata.generatedAt.toISOString()],
  ]);
  if (metadata.profile !== "ANONYMIZED" && metadata.includeNotes) {
    sheet.addRow(["Notes", "", safeExcelText(plate.sample.notes ?? "")]);
  }
  sheet.addRow([]);
  const consumed = new Set<string>();
  const entries: Array<{ drugName: string; unit: string; micText: string; category: SirCategory; needsReview: boolean; rationale?: unknown }> = [];

  const addDrug = (drugName: string, unit: string, micText: string, category: SirCategory, needsReview: boolean, rationale?: unknown) => {
    entries.push({ drugName, unit, micText, category, needsReview, rationale });
  };

  const current = currentRawMics(plate);
  for (const drug of plate.drugs) {
    const saved = current.find(mic => !consumed.has(mic.id) && (mic.plateDrugId ? mic.plateDrugId === drug.id : mic.plateDrug.drugName === drug.drugName && mic.plateDrug.unit === drug.unit));
    if (saved) {
      consumed.add(saved.id);
      const interpretation = currentInterpretation(saved);
      addDrug(drug.drugName, drug.unit, formatMic(saved.value, (saved.rawMicOperator as RawMicOperator | null) ?? saved.modifier), categoryFor(interpretation), saved.reviewRequired, interpretation?.rationaleJson);
    } else {
      const assignments = normalizeDrugAssignments(drug);
      if (!assignments.length) continue;
      const states = assignments.map(assignment => normalizeWellState(plate.wells.find(well => well.rowIndex === assignment.rowIndex && well.columnIndex === assignment.columnIndex)?.state));
      const mic = calculateRawMic(assignments.map(assignment => assignment.concentration), states);
      addDrug(drug.drugName, drug.unit, formatMic(mic.value, mic.rawMicOperator ?? mic.modifier), "NO_BREAKPOINT", mic.needsReview);
    }
  }
  for (const saved of current.filter(mic => !consumed.has(mic.id))) {
    const interpretation = currentInterpretation(saved);
    addDrug(saved.plateDrug.drugName, saved.plateDrug.unit, formatMic(saved.value, (saved.rawMicOperator as RawMicOperator | null) ?? saved.modifier), categoryFor(interpretation), saved.reviewRequired, interpretation?.rationaleJson);
  }
  const header = sheet.addRow(["Sample-ID", ...entries.flatMap(entry => [safeExcelText(entry.drugName), ""])]);
  const subheader = sheet.addRow(["", ...entries.flatMap(entry => [safeExcelText(`MIC (${entry.unit})`), "判定"])]);
  styleHeader(header);
  styleHeader(subheader);
  sheet.mergeCells(header.number, 1, subheader.number, 1);
  entries.forEach((_, index) => sheet.mergeCells(header.number, index * 2 + 2, header.number, index * 2 + 3));
  const result = sheet.addRow([safeExcelText(plate.sample.sampleCode), ...entries.flatMap(entry => [
    entry.micText, entry.category === "NO_BREAKPOINT" ? "" : formatInterpretation(entry.category),
  ])]);
  result.height = 28;
  const fills: Partial<Record<SirCategory, string>> = { S: "FFD9EAD3", I: "FFFFF2CC", R: "FFF4CCCC" };
  entries.forEach((entry, index) => {
    const mic = result.getCell(index * 2 + 2);
    const interpretation = result.getCell(index * 2 + 3);
    for (const cell of [mic, interpretation]) {
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.font = { bold: true, size: 12 };
    }
    if (fills[entry.category]) interpretation.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fills[entry.category]! } };
    if (entry.needsReview) mic.note = "要確認: 入力状態またはMIC結果を確認してください。";
    const application = breakpointApplicationFields(entry.rationale);
    if (application[1]) interpretation.note = `${application[1]} / ${application[0]}`;
  });
  sheet.columns = [{ width: 26 }, ...entries.flatMap(() => [{ width: 22 }, { width: 14 }])];
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: subheader.number, showGridLines: false }];
  const lastColumn = Math.max(3, entries.length * 2 + 1);
  sheet.unMergeCells("A1:C1");
  sheet.unMergeCells("A2:C2");
  sheet.mergeCells(1, 1, 1, lastColumn);
  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.addRow([]);
  const legend = sheet.addRow(["判定: S / I / R　空白: Breakpointなし　詳細・追跡情報: Method"]);
  sheet.mergeCells(legend.number, 1, legend.number, lastColumn);
  legend.height = 34;
  legend.getCell(1).alignment = { wrapText: true };
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(lastColumn).letter}${sheet.rowCount}`;
  sheet.pageSetup.printTitlesRow = `1:${subheader.number}`;
}

function addResultDetails(sheet: ExcelJS.Worksheet, { plate, metadata }: ExportData): void {
  sheet.addRow([]);
  sheet.addRow(["Calculation Details / 計算結果の追跡情報"]);

  const headers = metadata.profile === "ANONYMIZED"
    ? [
      "Sample Code", "Export Sample ID", "Organism", "Drug", "Raw MIC", "MIC Value", "Unit", "Interpretation",
      "Breakpoint Standard", "Breakpoint Version", "MIC Engine", "SIR Engine", "Review Required", "Source Well Revision",
    ]
    : [
      "Sample Code", "Organism", "Drug", "Raw MIC", "MIC Value", "Unit", "Interpretation",
      "Breakpoint Standard", "Breakpoint Version", "MIC Engine", "SIR Engine", "Review Required", "Source Well Revision",
      "RawMic ID", "SirInterpretation ID", "Breakpoint Set ID",
    ];
  headers.push("Breakpoint Organism", "Research Application");
  sheet.addRow(headers);
  const headerRowNumber = sheet.rowCount;
  styleHeader(sheet.getRow(headerRowNumber));

  for (const mic of currentRawMics(plate)) {
    const interpretation = currentInterpretation(mic);
    const operator = (mic.rawMicOperator as RawMicOperator | null) ?? null;
    const category = categoryFor(interpretation);
    const common = [
      safeExcelText(plate.sample.sampleCode),
      ...(metadata.profile === "ANONYMIZED" ? [metadata.pseudonymousSampleId] : []),
      safeExcelText(plate.sample.organism ?? ""),
      safeExcelText(mic.plateDrug.drugName),
      formatMic(mic.value, operator ?? mic.modifier),
      mic.value,
      safeExcelText(mic.plateDrug.unit),
      formatInterpretation(category, "AS_BLANK"),
      safeExcelText(interpretation?.standard ?? ""),
      safeExcelText(interpretation?.ruleVersion ?? ""),
      safeExcelText(mic.calculationEngineVersion),
      safeExcelText(interpretation?.ruleEngineVersion ?? ""),
      mic.reviewRequired ? "YES" : "NO",
      mic.sourceWellRevision,
    ];
    const applicationFields = breakpointApplicationFields(interpretation?.rationaleJson);
    const row = sheet.addRow(metadata.profile === "ANONYMIZED"
      ? [...common, ...applicationFields]
      : [...common, mic.id, interpretation?.id ?? "", mic.breakpointSetId, ...applicationFields]);
    const interpretationCell = row.getCell(metadata.profile === "ANONYMIZED" ? 8 : 7);
    const fills: Record<string, string> = { S: "FFD9EAD3", I: "FFFFF2CC", R: "FFF4CCCC", NO_BREAKPOINT: "FFE7E6E6", "N/A": "FFE7E6E6" };
    const fill = fills[String(interpretationCell.value)];
    if (fill) interpretationCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    interpretationCell.font = { bold: true };
  }

  const currentMicDrugIds = new Set(currentRawMics(plate).map((mic) => mic.plateDrugId).filter(Boolean));
  for (const drug of plate.drugs) {
    if (currentMicDrugIds.has(drug.id)) continue;
    const assignments = normalizeDrugAssignments(drug);
    if (assignments.length === 0) continue;

    const states = assignments.map((assignment) => normalizeWellState(
      plate.wells.find((well) => well.rowIndex === assignment.rowIndex && well.columnIndex === assignment.columnIndex)?.state,
    ));
    const raw = calculateRawMic(assignments.map((assignment) => assignment.concentration), states);
    const common = [
      safeExcelText(plate.sample.sampleCode),
      ...(metadata.profile === "ANONYMIZED" ? [metadata.pseudonymousSampleId] : []),
      safeExcelText(plate.sample.organism ?? ""),
      safeExcelText(drug.drugName),
      formatMic(raw.value, raw.rawMicOperator ?? raw.modifier),
      raw.value,
      safeExcelText(drug.unit),
      "",
      "",
      "",
      safeExcelText(raw.method),
      "",
      raw.needsReview ? "YES" : "NO",
      metadata.snapshot.wellRevision,
    ];
    const row = sheet.addRow(metadata.profile === "ANONYMIZED"
      ? [...common, "", ""]
      : [...common, "", "", "", "", ""]);
    const interpretationCell = row.getCell(metadata.profile === "ANONYMIZED" ? 8 : 7);
    interpretationCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7E6E6" } };
    interpretationCell.font = { bold: true };
  }

  sheet.columns = (metadata.profile === "ANONYMIZED"
    ? [18, 20, 22, 20, 16, 12, 12, 18, 18, 18, 24, 24, 16, 20]
    : [18, 22, 20, 16, 12, 12, 18, 18, 18, 24, 24, 16, 20, 28, 28, 28]
  ).concat([24, 42]).map((width) => ({ width }));
  sheet.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: headerRowNumber, column: headers.length } };
}

function addWellsSheet(workbook: ExcelJS.Workbook, { plate, metadata }: ExportData, existing?: ExcelJS.Worksheet): void {
  const sheet = existing ?? workbook.addWorksheet("Wells");
  configureSheet(sheet);
  const includeInternal = metadata.profile === "AUDIT_FULL";
  const headers = [
    ...(includeInternal ? ["Plate ID", "Sample ID"] : []),
    "Sample Code",
    ...(metadata.profile === "ANONYMIZED" ? ["Export Sample ID"] : []),
    "Organism", "Drug", "Well", "Row", "Column", "Concentration", "Unit", "Raw State", "Source", "Confidence", "Review Required", "Observed At",
  ];
  if (!sheet.rowCount) sheet.addRow(headers);
  styleHeader(sheet.getRow(1));
  for (const drug of plate.drugs) {
    for (const assignment of normalizeDrugAssignments(drug)) {
      const well = plate.wells.find((item) => item.rowIndex === assignment.rowIndex && item.columnIndex === assignment.columnIndex);
      sheet.addRow([
        ...(includeInternal ? [plate.id, plate.sampleId] : []),
        safeExcelText(plate.sample.sampleCode),
        ...(metadata.profile === "ANONYMIZED" ? [metadata.pseudonymousSampleId] : []),
        safeExcelText(plate.sample.organism ?? ""),
        safeExcelText(drug.drugName),
        wellName(assignment.rowIndex, assignment.columnIndex),
        String.fromCharCode(65 + assignment.rowIndex),
        assignment.columnIndex + 1,
        assignment.concentration,
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

function addMethodSheet(workbook: ExcelJS.Workbook, data: ExportData): void {
  const { metadata } = data;
  const sheet = workbook.addWorksheet("Method");
  configureSheet(sheet);
  sheet.columns = [{ width: 30 }, { width: 72 }];
  addTitle(sheet, "Export Method and Privacy Profile");
  sheet.addRows([
    ["Profile", metadata.profile],
    ["Generated at", metadata.generatedAt.toISOString()],
    ["Export sample ID", metadata.pseudonymousSampleId],
    ["Well revision", metadata.snapshot.wellRevision],
    ["Result revision", metadata.snapshot.resultRevision],
    ["No-breakpoint display", "Blank"],
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
  addResultDetails(sheet, data);
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
