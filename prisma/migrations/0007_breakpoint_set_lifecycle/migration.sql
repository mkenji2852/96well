PRAGMA foreign_keys=OFF;

CREATE TABLE "new_BreakpointSet" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "standard" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "organism" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'µg/mL',
  "method" TEXT NOT NULL DEFAULT 'BROTH_MICRODILUTION',
  "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'APPROVED', 'RETIRED')),
  "approvedAt" DATETIME,
  "approvedByUserId" TEXT,
  "retiredAt" DATETIME,
  "retiredByUserId" TEXT,
  "retireReason" TEXT,
  "approvalComment" TEXT,
  "sourceDocumentReference" TEXT,
  "sourceDocumentChecksum" TEXT,
  "effectiveFrom" DATETIME,
  "effectiveTo" DATETIME,
  "supersedesBreakpointSetId" TEXT,
  "contentHash" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BreakpointSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BreakpointSet_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BreakpointSet_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BreakpointSet_retiredByUserId_fkey" FOREIGN KEY ("retiredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BreakpointSet_supersedesBreakpointSetId_fkey" FOREIGN KEY ("supersedesBreakpointSetId") REFERENCES "BreakpointSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_BreakpointSet" (
  "id", "organizationId", "standard", "version", "organism", "unit", "method", "status",
  "effectiveFrom", "effectiveTo", "revision", "createdAt", "updatedAt"
)
SELECT
  "id", "organizationId", "standard", "version", "organism",
  COALESCE((SELECT br."unit" FROM "BreakpointRule" br WHERE br."breakpointSetId" = "BreakpointSet"."id" ORDER BY br."id" LIMIT 1), 'µg/mL'),
  'BROTH_MICRODILUTION', 'DRAFT', "validFrom", "validTo", 0, "createdAt", CURRENT_TIMESTAMP
FROM "BreakpointSet";

DROP TABLE "BreakpointSet";
ALTER TABLE "new_BreakpointSet" RENAME TO "BreakpointSet";

CREATE INDEX "BreakpointSet_organizationId_status_effectiveFrom_effectiveTo_idx"
  ON "BreakpointSet"("organizationId", "status", "effectiveFrom", "effectiveTo");
CREATE INDEX "BreakpointSet_organizationId_standard_version_idx"
  ON "BreakpointSet"("organizationId", "standard", "version");
CREATE UNIQUE INDEX "BreakpointSet_formal_org_standard_version_key"
  ON "BreakpointSet"("organizationId", "standard", "version")
  WHERE "status" IN ('APPROVED', 'RETIRED');
CREATE INDEX "BreakpointSet_supersedesBreakpointSetId_idx" ON "BreakpointSet"("supersedesBreakpointSetId");
CREATE INDEX "BreakpointSet_createdByUserId_idx" ON "BreakpointSet"("createdByUserId");
CREATE INDEX "BreakpointSet_approvedByUserId_idx" ON "BreakpointSet"("approvedByUserId");
CREATE INDEX "BreakpointSet_retiredByUserId_idx" ON "BreakpointSet"("retiredByUserId");

CREATE TABLE "new_BreakpointRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "breakpointSetId" TEXT NOT NULL,
  "drugName" TEXT NOT NULL,
  "organism" TEXT,
  "standard" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "susceptibleMax" REAL NOT NULL,
  "resistantMin" REAL NOT NULL,
  "intermediateMin" REAL,
  "intermediateMax" REAL,
  "unit" TEXT NOT NULL DEFAULT 'µg/mL',
  "method" TEXT NOT NULL DEFAULT 'BROTH_MICRODILUTION',
  "exceptionJson" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BreakpointRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BreakpointRule_breakpointSetId_fkey" FOREIGN KEY ("breakpointSetId") REFERENCES "BreakpointSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_BreakpointRule" (
  "id", "organizationId", "breakpointSetId", "drugName", "organism", "standard", "version",
  "susceptibleMax", "resistantMin", "unit", "method", "createdAt", "updatedAt"
)
SELECT
  "id", "organizationId", "breakpointSetId", "drugName", "organism", "standard", "version",
  "susceptibleMax", "resistantMin", "unit", 'BROTH_MICRODILUTION', "createdAt", CURRENT_TIMESTAMP
FROM "BreakpointRule"
WHERE "breakpointSetId" IS NOT NULL;

DROP TABLE "BreakpointRule";
ALTER TABLE "new_BreakpointRule" RENAME TO "BreakpointRule";

CREATE UNIQUE INDEX "BreakpointRule_breakpointSetId_drugName_organism_unit_method_key"
  ON "BreakpointRule"("breakpointSetId", "drugName", "organism", "unit", "method");
CREATE INDEX "BreakpointRule_organizationId_idx" ON "BreakpointRule"("organizationId");
CREATE INDEX "BreakpointRule_breakpointSetId_idx" ON "BreakpointRule"("breakpointSetId");

CREATE TRIGGER "BreakpointSet_immutable_content"
BEFORE UPDATE ON "BreakpointSet"
WHEN OLD."status" IN ('APPROVED', 'RETIRED') AND (
  NEW."standard" IS NOT OLD."standard" OR
  NEW."version" IS NOT OLD."version" OR
  NEW."organism" IS NOT OLD."organism" OR
  NEW."unit" IS NOT OLD."unit" OR
  NEW."method" IS NOT OLD."method" OR
  NEW."effectiveFrom" IS NOT OLD."effectiveFrom" OR
  NEW."effectiveTo" IS NOT OLD."effectiveTo" OR
  NEW."sourceDocumentReference" IS NOT OLD."sourceDocumentReference" OR
  NEW."sourceDocumentChecksum" IS NOT OLD."sourceDocumentChecksum" OR
  NEW."supersedesBreakpointSetId" IS NOT OLD."supersedesBreakpointSetId" OR
  NEW."contentHash" IS NOT OLD."contentHash" OR
  NEW."approvedAt" IS NOT OLD."approvedAt" OR
  NEW."approvedByUserId" IS NOT OLD."approvedByUserId"
)
BEGIN
  SELECT RAISE(ABORT, 'immutable breakpoint set content');
END;

CREATE TRIGGER "BreakpointSet_retirement_metadata_immutable"
BEFORE UPDATE ON "BreakpointSet"
WHEN OLD."status" = 'RETIRED' AND (
  NEW."retiredAt" IS NOT OLD."retiredAt" OR
  NEW."retiredByUserId" IS NOT OLD."retiredByUserId" OR
  NEW."retireReason" IS NOT OLD."retireReason"
)
BEGIN
  SELECT RAISE(ABORT, 'retirement metadata is immutable');
END;

CREATE TRIGGER "BreakpointSet_invalid_transition"
BEFORE UPDATE OF "status" ON "BreakpointSet"
WHEN
  (OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPROVED', 'RETIRED')) OR
  (OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED')
BEGIN
  SELECT RAISE(ABORT, 'invalid breakpoint set transition');
END;

CREATE TRIGGER "BreakpointSet_prevent_immutable_delete"
BEFORE DELETE ON "BreakpointSet"
WHEN OLD."status" IN ('APPROVED', 'RETIRED')
BEGIN
  SELECT RAISE(ABORT, 'immutable breakpoint set cannot be deleted');
END;

CREATE TRIGGER "BreakpointRule_draft_insert_only"
BEFORE INSERT ON "BreakpointRule"
WHEN (SELECT "status" FROM "BreakpointSet" WHERE "id" = NEW."breakpointSetId") <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'rules can be inserted only for draft breakpoint sets');
END;

CREATE TRIGGER "BreakpointRule_draft_update_only"
BEFORE UPDATE ON "BreakpointRule"
WHEN
  (SELECT "status" FROM "BreakpointSet" WHERE "id" = OLD."breakpointSetId") <> 'DRAFT' OR
  (SELECT "status" FROM "BreakpointSet" WHERE "id" = NEW."breakpointSetId") <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'rules can be updated only for draft breakpoint sets');
END;

CREATE TRIGGER "BreakpointRule_draft_delete_only"
BEFORE DELETE ON "BreakpointRule"
WHEN (SELECT "status" FROM "BreakpointSet" WHERE "id" = OLD."breakpointSetId") <> 'DRAFT'
BEGIN
  SELECT RAISE(ABORT, 'rules can be deleted only for draft breakpoint sets');
END;

ALTER TABLE "ExportRecord" ADD COLUMN "breakpointStandard" TEXT;
ALTER TABLE "ExportRecord" ADD COLUMN "breakpointVersion" TEXT;
ALTER TABLE "ExportRecord" ADD COLUMN "breakpointContentHash" TEXT;

PRAGMA foreign_keys=ON;
