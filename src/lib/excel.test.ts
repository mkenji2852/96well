import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildPlateWorkbook, buildPopulationWorkbook, parseExportProfile, safeExcelText, type ExportMetadata } from "./excel";
import type { ExportProfile } from "@/types/domain";

const generatedAt = new Date("2026-01-02T03:04:05Z");

function metadata(profile: ExportProfile, patch: Partial<ExportMetadata> = {}): ExportMetadata {
  return {
    exportId: "export-random-1",
    profile,
    generatedAt,
    pseudonymousSampleId: "AST-export-rand",
    breakpointSetId: "bps-1",
    breakpointStandard: "CLSI",
    breakpointVersion: "2026.1",
    breakpointContentHash: "a".repeat(64),
    breakpointStatus: "APPROVED",
    breakpointApprovedByUserId: "admin-1",
    breakpointApprovedAt: generatedAt,
    noBreakpointPolicy: "AS_BLANK",
    snapshot: {
      plateId: "plate-1",
      plateRevision: "2026-01-02T03:00:00.000Z",
      wellRevision: 7,
      resultRevision: 4,
      breakpointSetId: "bps-1",
      rawMicIds: ["raw-1"],
      sirInterpretationIds: ["sir-1"],
      imageReviewIds: ["review-1"],
    },
    ...patch,
  };
}

function plate() {
  return {
    id: "plate-1",
    sampleId: "sample-1",
    name: "Plate 1",
    status: "APPROVED",
    wellRevision: 7,
    resultRevision: 4,
    updatedAt: new Date("2026-01-02T03:00:00Z"),
    sample: {
      id: "sample-1",
      sampleCode: "=S-001",
      organism: "+E. coli",
      notes: "-private note",
      createdAt: new Date("2026-01-01"),
    },
    drugs: [{
      id: "drug-1",
      rowIndex: 0,
      drugName: "@Drug X",
      unit: "µg/mL",
      concentrations: [64, 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125],
    }],
    wells: [{ rowIndex: 0, columnIndex: 0, state: "INHIBITED", source: "MANUAL", confidence: null, needsReview: false, observedAt: generatedAt }],
    rawMics: [{
      id: "raw-1",
      plateDrugId: "drug-1",
      breakpointSetId: "bps-1",
      value: 2,
      modifier: "EQUAL" as const,
      rawMicOperator: "=",
      calculationMethod: "broth-microdilution-v2",
      calculationEngineVersion: "broth-microdilution-v2",
      sourceWellRevision: 7,
      status: "CURRENT",
      supersedesId: "raw-old",
      supersededAt: null,
      createdAt: generatedAt,
      reviewRequired: false,
      rationaleJson: { reasonCodes: [] },
      plateDrug: { drugName: "@Drug X", unit: "µg/mL" },
      interpretations: [{
        id: "sir-1",
        breakpointSetId: "bps-1",
        category: "S",
        standard: "CLSI",
        ruleVersion: "2026.1",
        ruleEngineVersion: "sir-rule-engine-v2",
        status: "CURRENT",
        supersedesId: "sir-old",
        supersededAt: null,
        calculatedAt: generatedAt,
        susceptibleMax: 2,
        resistantMin: 8,
        rationaleJson: { decisionCode: "EXACT_MIC_COMPARED" },
      }],
    }, {
      id: "raw-old",
      plateDrugId: "drug-1",
      breakpointSetId: "bps-1",
      value: 4,
      modifier: "EQUAL" as const,
      rawMicOperator: "=",
      calculationMethod: "broth-microdilution-v2",
      calculationEngineVersion: "broth-microdilution-v1",
      sourceWellRevision: 6,
      status: "SUPERSEDED",
      supersedesId: null,
      supersededAt: generatedAt,
      createdAt: generatedAt,
      reviewRequired: false,
      rationaleJson: {},
      plateDrug: { drugName: "@Drug X", unit: "µg/mL" },
      interpretations: [{
        id: "sir-old",
        breakpointSetId: "bps-1",
        category: "I",
        standard: "CLSI",
        ruleVersion: "2025.1",
        ruleEngineVersion: "sir-rule-engine-v1",
        status: "SUPERSEDED",
        supersedesId: null,
        supersededAt: generatedAt,
        calculatedAt: generatedAt,
        susceptibleMax: 2,
        resistantMin: 8,
        rationaleJson: {},
      }],
    }],
    imageAssessments: [{
      id: "assessment-1",
      status: "APPROVED",
      manualReviewRequired: false,
      createdAt: generatedAt,
      reviews: [{ id: "review-1", reviewerUserId: "reviewer-1", decision: "APPROVED", reviewedAt: generatedAt, rejectionReason: null, overrideReason: null }],
      overrides: [{ id: "override-1", reviewerUserId: "reviewer-1", rowIndex: 0, columnIndex: 0, beforeState: "GROWTH", afterState: "INHIBITED", reason: "=override reason", modelVersion: "opencv", createdAt: generatedAt }],
    }],
  };
}

function auditLogs() {
  return [{
    createdAt: generatedAt,
    actorId: "actor-1",
    actorLabel: "Actor Name",
    action: "PLATE_SAVED",
    entityType: "Plate",
    entityId: "plate-1",
    beforeJson: { status: "DRAFT", rawSecret: "do-not-export" },
    afterJson: { status: "APPROVED", exportId: "export-random-1", reason: "=audit reason" },
  }];
}

async function loadWorkbook(profile: ExportProfile, patch: Partial<ExportMetadata> = {}) {
  const buffer = await buildPlateWorkbook({ metadata: metadata(profile, patch), plate: plate(), auditLogs: auditLogs() });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
  return workbook;
}

function workbookText(workbook: ExcelJS.Workbook): string {
  const values: string[] = [
    workbook.creator ?? "",
    workbook.lastModifiedBy ?? "",
    workbook.subject ?? "",
    workbook.company ?? "",
  ];
  for (const sheet of workbook.worksheets) {
    values.push(sheet.name, sheet.state);
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        values.push(String(cell.value ?? ""));
      });
    });
  }
  return values.join("\n");
}

describe("buildPlateWorkbook privacy profiles", () => {
  it("exports multiple samples as rows with MIC50/MIC90 and no private fields", async () => {
    const samples = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512].map((value, index) => {
      const original = plate();
      return { plate: { ...original, sampleId: `sample-${index}`, sample: { ...original.sample, id: `sample-${index}`, sampleCode: `SMP-${index}` },
        rawMics: [{ ...original.rawMics[0], value, sourceWellRevision: original.wellRevision }],
      }, metadata: metadata("ANONYMIZED"), auditLogs: [] };
    });
    const buffer = await buildPopulationWorkbook(samples);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    const statistics = workbook.getWorksheet("MICStatistics")!;
    expect(statistics.getRow(2).getCell(5).value).toBe(10);
    expect(statistics.getRow(2).getCell(9).text).toBe("16");
    expect(statistics.getRow(2).getCell(10).text).toBe("256");
    const summary = workbook.getWorksheet("Summary")!;
    expect(summary.getRow(5).getCell(1).text).toBe("SMP-0");
    expect(summary.getRow(14).getCell(1).text).toBe("SMP-9");
    const text = workbookText(workbook);
    expect(text).not.toContain("-private note");
    expect(text).not.toContain("sample-0");
    expect(text).not.toContain("raw-1");
    expect(text).not.toContain("sir-1");
    expect(workbook.getWorksheet("Wells")!.rowCount).toBe(121);
  });
  it("puts each drug's MIC and interpretation in paired columns on one Sample-ID row", async () => {
    const workbook = await loadWorkbook("ANONYMIZED");
    const summary = workbook.getWorksheet("Summary")!;
    let header = 0;
    summary.eachRow(row => { if (row.getCell(2).value === "'@Drug X") header = row.number; });
    expect(summary.getRow(header).getCell(2).value).toBe("'@Drug X");
    expect(summary.getRow(header + 1).getCell(2).value).toBe("MIC (µg/mL)");
    expect(summary.getRow(header + 1).getCell(3).value).toBe("判定");
    expect(summary.getRow(header + 2).getCell(1).value).toBe("'=S-001");
    expect(summary.getRow(header + 2).getCell(2).value).toBe("2");
    expect(summary.getRow(header + 2).getCell(3).value).toBe("S");
    expect(summary.getRow(header + 1).getCell(1).isMerged).toBe(true);
    expect(summary.columnCount).toBe(3);
    expect(summary.views[0]).toMatchObject({ state: "frozen", xSplit: 1, ySplit: header + 1 });
    expect(workbookText(summary.workbook)).not.toContain("raw-old");
  });

  it("keeps MIC visible and leaves interpretation blank for NO_BREAKPOINT", async () => {
    const original = plate();
    const current = original.rawMics[0];
    const buffer = await buildPlateWorkbook({ metadata: metadata("ANONYMIZED"), auditLogs: [], plate: {
      ...original, rawMics: [{ ...current, interpretations: current.interpretations.map(item => ({ ...item, category: "NO_BREAKPOINT", standard: null, ruleVersion: null })) }],
    } });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    const summary = workbook.getWorksheet("Summary")!;
    let rowNumber = 0;
    summary.eachRow(row => { if (row.getCell(1).value === "'=S-001") rowNumber = row.number; });
    expect(summary.getRow(rowNumber).getCell(3).text).toBe("");
    expect(summary.getRow(rowNumber).getCell(2).text).toBe("2");
    expect(workbookText(workbook)).not.toContain("NO_BREAKPOINT");
  });

  it("places a second drug in the next MIC/interpretation column pair without duplicating the sample", async () => {
    const original = plate();
    const buffer = await buildPlateWorkbook({ metadata: metadata("ANONYMIZED"), auditLogs: [], plate: {
      ...original,
      drugs: [...original.drugs, { id: "drug-b", rowIndex: 1, drugName: "Drug B", unit: "µg/mL", concentrations: [8] }],
      wells: [...original.wells, { ...original.wells[0], rowIndex: 1, columnIndex: 0 }],
    } });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    const summary = workbook.getWorksheet("Summary")!;
    let sampleRow = 0;
    let occurrences = 0;
    summary.eachRow(row => { if (row.getCell(1).value === "'=S-001") { sampleRow = row.number; occurrences++; } });
    expect(occurrences).toBe(1);
    expect(summary.getRow(sampleRow).getCell(2).text).toBe("2");
    expect(summary.getRow(sampleRow).getCell(3).text).toBe("S");
    expect(summary.getRow(sampleRow).getCell(4).text).toContain("8");
    expect(summary.getRow(sampleRow).getCell(5).text).toBe("");
    expect(summary.getRow(sampleRow - 2).getCell(4).text).toBe("Drug B");
    expect(summary.columnCount).toBe(5);
    expect(summary.pageSetup.printArea).toContain("E");
  });
  it("labels cross-organism research interpretation without exporting its free-text reason", async () => {
    const original = plate();
    const current = original.rawMics[0];
    const buffer = await buildPlateWorkbook({
      metadata: metadata("ANONYMIZED"), auditLogs: [],
      plate: { ...original, rawMics: [{ ...current, interpretations: current.interpretations.map(item => ({
        ...item, rationaleJson: { application: {
          mode: "RESEARCH_CROSS_ORGANISM", breakpointOrganism: "Staphylococcus aureus",
          sampleOrganism: "E. coli", reason: "private-research-reason",
        } },
      })) }] },
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
    const text = workbookText(workbook);
    expect(text).toContain("Breakpoint Organism");
    expect(text).toContain("Staphylococcus aureus");
    expect(text).toContain("RESEARCH ONLY: cross-organism application");
    expect(text).not.toContain("private-research-reason");
  });
  it("defaults unknown profile input to ANONYMIZED", () => {
    expect(parseExportProfile(null)).toBe("ANONYMIZED");
    expect(parseExportProfile("CLINICAL_INTERNAL")).toBe("CLINICAL_INTERNAL");
    expect(parseExportProfile("evil")).toBe("ANONYMIZED");
  });

  it("creates an ANONYMIZED workbook with safe Sample-ID but without notes, actor, internal IDs, hidden sheets, or identifying properties", async () => {
    const workbook = await loadWorkbook("ANONYMIZED");
    const text = workbookText(workbook);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Wells", "Method"]);
    expect(workbook.worksheets.every((sheet) => sheet.state === "visible")).toBe(true);
    expect(text).toContain("AST-export-rand");
    expect(text).toContain("Sample Code");
    expect(text).toContain("'=S-001");
    expect(text).not.toContain("-private note");
    expect(text).not.toContain("Actor Name");
    expect(text).not.toContain("actor-1");
    expect(text).not.toContain("plate-1");
    expect(text).not.toContain("sample-1");
    expect(text).not.toContain("raw-1");
    expect(text).not.toContain("sir-1");
    expect(text).not.toContain("rawSecret");
  });

  it("sanitizes user-provided strings that could become Excel formulas", async () => {
    expect(safeExcelText("=cmd")).toBe("'=cmd");
    expect(safeExcelText("+sum")).toBe("'+sum");
    expect(safeExcelText("-secret")).toBe("'-secret");
    expect(safeExcelText("@user")).toBe("'@user");

    const workbook = await loadWorkbook("ANONYMIZED");
    const text = workbookText(workbook);
    expect(text).toContain("'+E. coli");
    expect(text).toContain("'@Drug X");
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => row.eachCell((cell) => {
        expect(typeof cell.value === "object" && cell.value !== null && "formula" in cell.value).toBe(false);
      }));
    }
  });

  it("adds InterpretationHistory and allowed audit fields only for AUDIT_FULL", async () => {
    const workbook = await loadWorkbook("AUDIT_FULL", {
      reason: "Regulatory inspection",
      snapshot: {
        ...metadata("AUDIT_FULL").snapshot,
        rawMicIds: ["raw-1", "raw-old"],
        sirInterpretationIds: ["sir-1", "sir-old"],
      },
    });
    const text = workbookText(workbook);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary", "Wells", "Method", "ReviewHistory", "InterpretationHistory", "Audit", "ExportMetadata",
    ]);
    expect(text).toContain("raw-old");
    expect(text).toContain("sir-old");
    expect(text).toContain("actor-1");
    expect(text).toContain("'=audit reason");
    expect(text).not.toContain("do-not-export");
  });
});
