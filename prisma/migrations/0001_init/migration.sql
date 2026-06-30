PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'TECHNICIAN',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE TABLE IF NOT EXISTS "Sample" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sampleCode" TEXT NOT NULL,
  "organism" TEXT,
  "collectedAt" DATETIME,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "Sample_sampleCode_key" ON "Sample"("sampleCode");

CREATE TABLE IF NOT EXISTS "Plate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sampleId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "layoutVersion" TEXT NOT NULL DEFAULT '96-well-v1',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Plate_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PlateDrug" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plateId" TEXT NOT NULL,
  "rowIndex" INTEGER NOT NULL,
  "drugName" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'µg/mL',
  "concentrations" JSONB NOT NULL,
  CONSTRAINT "PlateDrug_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlateDrug_plateId_rowIndex_key" ON "PlateDrug"("plateId", "rowIndex");

CREATE TABLE IF NOT EXISTS "PlateWell" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plateId" TEXT NOT NULL,
  "rowIndex" INTEGER NOT NULL,
  "columnIndex" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'UNREAD',
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "confidence" REAL,
  "needsReview" BOOLEAN NOT NULL DEFAULT false,
  "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlateWell_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PlateWell_plateId_rowIndex_columnIndex_key" ON "PlateWell"("plateId", "rowIndex", "columnIndex");

CREATE TABLE IF NOT EXISTS "RawMic" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plateId" TEXT NOT NULL,
  "plateDrugId" TEXT NOT NULL,
  "value" REAL,
  "modifier" TEXT NOT NULL,
  "rawMicOperator" TEXT,
  "calculationMethod" TEXT NOT NULL DEFAULT 'broth-microdilution-v2',
  "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "rationaleJson" JSONB,
  "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RawMic_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RawMic_plateDrugId_fkey" FOREIGN KEY ("plateDrugId") REFERENCES "PlateDrug"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "BreakpointRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "drugName" TEXT NOT NULL,
  "organism" TEXT,
  "standard" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "susceptibleMax" REAL NOT NULL,
  "resistantMin" REAL NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'µg/mL',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "BreakpointRule_drugName_organism_standard_version_key" ON "BreakpointRule"("drugName", "organism", "standard", "version");

CREATE TABLE IF NOT EXISTS "SirInterpretation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "rawMicId" TEXT NOT NULL,
  "breakpointRuleId" TEXT,
  "category" TEXT NOT NULL,
  "standard" TEXT,
  "ruleVersion" TEXT,
  "susceptibleMax" REAL,
  "resistantMin" REAL,
  "rationaleJson" JSONB,
  "interpretedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SirInterpretation_rawMicId_fkey" FOREIGN KEY ("rawMicId") REFERENCES "RawMic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SirInterpretation_breakpointRuleId_fkey" FOREIGN KEY ("breakpointRuleId") REFERENCES "BreakpointRule"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ExportRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plateId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "metadataJson" JSONB NOT NULL,
  "actorLabel" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExportRecord_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ExportRecord_plateId_createdAt_idx" ON "ExportRecord"("plateId", "createdAt");

CREATE TABLE IF NOT EXISTS "ImageAssessment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plateId" TEXT NOT NULL,
  "imageReference" TEXT,
  "modelVersion" TEXT,
  "confidence" REAL,
  "predictedStates" JSONB,
  "manualReviewRequired" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImageAssessment_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT,
  "actorLabel" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

PRAGMA foreign_keys=ON;
