import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildPlateWorkbook, parseExportProfile, safeExcelText, type ExportMetadata } from "./excel";
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
    noBreakpointPolicy: "AS_NO_BREAKPOINT",
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
  it("defaults unknown profile input to ANONYMIZED", () => {
    expect(parseExportProfile(null)).toBe("ANONYMIZED");
    expect(parseExportProfile("CLINICAL_INTERNAL")).toBe("CLINICAL_INTERNAL");
    expect(parseExportProfile("evil")).toBe("ANONYMIZED");
  });

  it("creates an ANONYMIZED workbook without sample code, notes, actor, internal IDs, hidden sheets, or identifying properties", async () => {
    const workbook = await loadWorkbook("ANONYMIZED");
    const text = workbookText(workbook);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Wells", "Method"]);
    expect(workbook.worksheets.every((sheet) => sheet.state === "visible")).toBe(true);
    expect(text).toContain("AST-export-rand");
    expect(text).not.toContain("=S-001");
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
