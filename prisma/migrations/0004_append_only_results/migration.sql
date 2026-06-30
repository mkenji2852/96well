PRAGMA foreign_keys=OFF;

ALTER TABLE "Plate" ADD COLUMN "wellRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Plate" ADD COLUMN "resultRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Plate" ADD COLUMN "lastCalculatedAt" DATETIME;
ALTER TABLE "Plate" ADD COLUMN "lastBreakpointSetId" TEXT;

CREATE TABLE "BreakpointSet" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "standard" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "organism" TEXT,
  "approved" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" DATETIME,
  "validTo" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BreakpointSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BreakpointSet_organizationId_active_approved_idx" ON "BreakpointSet"("organizationId", "active", "approved");
CREATE INDEX "BreakpointSet_organizationId_standard_version_idx" ON "BreakpointSet"("organizationId", "standard", "version");

INSERT INTO "BreakpointSet" ("id", "organizationId", "standard", "version", "organism", "approved", "active")
SELECT 'legacy-unassigned:' || "id", "id", 'LEGACY_UNASSIGNED', 'legacy', NULL, true, true
FROM "Organization";

INSERT INTO "BreakpointSet" ("id", "organizationId", "standard", "version", "organism", "approved", "active", "validFrom", "createdAt")
SELECT DISTINCT
  'bps:' || "organizationId" || ':' || "standard" || ':' || "version" || ':' || COALESCE("organism", '__ANY__'),
  "organizationId",
  "standard",
  "version",
  "organism",
  true,
  "active",
  "validFrom",
  MIN("createdAt")
FROM "BreakpointRule"
GROUP BY "organizationId", "standard", "version", "organism", "active", "validFrom";

CREATE TABLE "new_BreakpointRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "breakpointSetId" TEXT,
  "drugName" TEXT NOT NULL,
  "organism" TEXT,
  "standard" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "susceptibleMax" REAL NOT NULL,
  "resistantMin" REAL NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'ﾂｵg/mL',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BreakpointRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BreakpointRule_breakpointSetId_fkey" FOREIGN KEY ("breakpointSetId") REFERENCES "BreakpointSet"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BreakpointRule" ("id", "organizationId", "breakpointSetId", "drugName", "organism", "standard", "version", "susceptibleMax", "resistantMin", "unit", "active", "validFrom", "createdAt")
SELECT
  "id",
  "organizationId",
  'bps:' || "organizationId" || ':' || "standard" || ':' || "version" || ':' || COALESCE("organism", '__ANY__'),
  "drugName",
  "organism",
  "standard",
  "version",
  "susceptibleMax",
  "resistantMin",
  "unit",
  "active",
  "validFrom",
  "createdAt"
FROM "BreakpointRule";
DROP TABLE "BreakpointRule";
ALTER TABLE "new_BreakpointRule" RENAME TO "BreakpointRule";
CREATE UNIQUE INDEX "BreakpointRule_organizationId_drugName_organism_standard_version_key"
  ON "BreakpointRule"("organizationId", "drugName", "organism", "standard", "version");
CREATE INDEX "BreakpointRule_organizationId_active_idx" ON "BreakpointRule"("organizationId", "active");
CREATE INDEX "BreakpointRule_breakpointSetId_idx" ON "BreakpointRule"("breakpointSetId");

CREATE TABLE "new_RawMic" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "plateId" TEXT NOT NULL,
  "plateDrugId" TEXT NOT NULL,
  "value" REAL,
  "modifier" TEXT NOT NULL,
  "rawMicOperator" TEXT,
  "endpointRule" TEXT,
  "calculationMethod" TEXT NOT NULL DEFAULT 'broth-microdilution-v2',
  "calculationEngineVersion" TEXT NOT NULL DEFAULT 'broth-microdilution-v2',
  "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
  "sourceWellRevision" INTEGER NOT NULL DEFAULT 0,
  "breakpointSetId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CURRENT',
  "supersedesId" TEXT,
  "supersededAt" DATETIME,
  "rationaleJson" JSONB,
  "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  CONSTRAINT "RawMic_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RawMic_plateDrugId_fkey" FOREIGN KEY ("plateDrugId") REFERENCES "PlateDrug"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RawMic_breakpointSetId_fkey" FOREIGN KEY ("breakpointSetId") REFERENCES "BreakpointSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RawMic_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "RawMic"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RawMic_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RawMic" (
  "id", "plateId", "plateDrugId", "value", "modifier", "rawMicOperator", "endpointRule",
  "calculationMethod", "calculationEngineVersion", "reviewRequired", "sourceWellRevision",
  "breakpointSetId", "status", "supersedesId", "supersededAt", "rationaleJson",
  "calculatedAt", "createdAt", "createdByUserId"
)
WITH ranked AS (
  SELECT
    rm.*,
    ROW_NUMBER() OVER (PARTITION BY rm."plateId", rm."plateDrugId" ORDER BY rm."calculatedAt" DESC, rm."id" DESC) AS rn,
    COALESCE(
      (
        SELECT br."breakpointSetId"
        FROM "SirInterpretation" si
        JOIN "BreakpointRule" br ON br."id" = si."breakpointRuleId"
        WHERE si."rawMicId" = rm."id" AND br."breakpointSetId" IS NOT NULL
        ORDER BY si."interpretedAt" DESC
        LIMIT 1
      ),
      'legacy-unassigned:' || (SELECT p."organizationId" FROM "Plate" p WHERE p."id" = rm."plateId")
    ) AS selectedBreakpointSetId
  FROM "RawMic" rm
)
SELECT
  "id",
  "plateId",
  "plateDrugId",
  "value",
  "modifier",
  "rawMicOperator",
  "rawMicOperator",
  "calculationMethod",
  "calculationMethod",
  "reviewRequired",
  0,
  selectedBreakpointSetId,
  CASE WHEN rn = 1 THEN 'CURRENT' ELSE 'SUPERSEDED' END,
  NULL,
  CASE WHEN rn = 1 THEN NULL ELSE CURRENT_TIMESTAMP END,
  "rationaleJson",
  "calculatedAt",
  "calculatedAt",
  NULL
FROM ranked;
DROP TABLE "RawMic";
ALTER TABLE "new_RawMic" RENAME TO "RawMic";
CREATE INDEX "RawMic_plateId_plateDrugId_status_idx" ON "RawMic"("plateId", "plateDrugId", "status");
CREATE INDEX "RawMic_breakpointSetId_idx" ON "RawMic"("breakpointSetId");
CREATE INDEX "RawMic_supersedesId_idx" ON "RawMic"("supersedesId");
CREATE INDEX "RawMic_createdByUserId_idx" ON "RawMic"("createdByUserId");
CREATE UNIQUE INDEX "RawMic_current_plate_drug_key" ON "RawMic"("plateId", "plateDrugId") WHERE "status" = 'CURRENT';

CREATE TABLE "new_SirInterpretation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "rawMicId" TEXT NOT NULL,
  "plateId" TEXT NOT NULL,
  "plateDrugId" TEXT NOT NULL,
  "breakpointSetId" TEXT NOT NULL,
  "breakpointRuleId" TEXT,
  "category" TEXT NOT NULL,
  "standard" TEXT,
  "ruleVersion" TEXT,
  "susceptibleMax" REAL,
  "resistantMin" REAL,
  "ruleEngineVersion" TEXT NOT NULL DEFAULT 'sir-rule-engine-v2',
  "status" TEXT NOT NULL DEFAULT 'CURRENT',
  "supersedesId" TEXT,
  "supersededAt" DATETIME,
  "rationaleJson" JSONB,
  "interpretedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "calculatedByUserId" TEXT,
  CONSTRAINT "SirInterpretation_rawMicId_fkey" FOREIGN KEY ("rawMicId") REFERENCES "RawMic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SirInterpretation_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SirInterpretation_plateDrugId_fkey" FOREIGN KEY ("plateDrugId") REFERENCES "PlateDrug"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SirInterpretation_breakpointSetId_fkey" FOREIGN KEY ("breakpointSetId") REFERENCES "BreakpointSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SirInterpretation_breakpointRuleId_fkey" FOREIGN KEY ("breakpointRuleId") REFERENCES "BreakpointRule"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SirInterpretation_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "SirInterpretation"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SirInterpretation_calculatedByUserId_fkey" FOREIGN KEY ("calculatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SirInterpretation" (
  "id", "rawMicId", "plateId", "plateDrugId", "breakpointSetId", "breakpointRuleId",
  "category", "standard", "ruleVersion", "susceptibleMax", "resistantMin",
  "ruleEngineVersion", "status", "supersedesId", "supersededAt", "rationaleJson",
  "interpretedAt", "calculatedAt", "calculatedByUserId"
)
WITH ranked AS (
  SELECT
    si.*,
    rm."plateId" AS derivedPlateId,
    rm."plateDrugId" AS derivedPlateDrugId,
    COALESCE(br."breakpointSetId", rm."breakpointSetId") AS derivedBreakpointSetId,
    rm."status" AS rawStatus,
    ROW_NUMBER() OVER (
      PARTITION BY rm."plateId", rm."plateDrugId"
      ORDER BY si."interpretedAt" DESC, si."id" DESC
    ) AS rn
  FROM "SirInterpretation" si
  JOIN "RawMic" rm ON rm."id" = si."rawMicId"
  LEFT JOIN "BreakpointRule" br ON br."id" = si."breakpointRuleId"
)
SELECT
  "id",
  "rawMicId",
  derivedPlateId,
  derivedPlateDrugId,
  derivedBreakpointSetId,
  "breakpointRuleId",
  "category",
  "standard",
  "ruleVersion",
  "susceptibleMax",
  "resistantMin",
  'sir-rule-engine-v2',
  CASE WHEN rawStatus = 'CURRENT' AND rn = 1 THEN 'CURRENT' ELSE 'SUPERSEDED' END,
  NULL,
  CASE WHEN rawStatus = 'CURRENT' AND rn = 1 THEN NULL ELSE CURRENT_TIMESTAMP END,
  "rationaleJson",
  "interpretedAt",
  "interpretedAt",
  NULL
FROM ranked;
DROP TABLE "SirInterpretation";
ALTER TABLE "new_SirInterpretation" RENAME TO "SirInterpretation";
CREATE INDEX "SirInterpretation_plateId_plateDrugId_breakpointSetId_status_idx"
  ON "SirInterpretation"("plateId", "plateDrugId", "breakpointSetId", "status");
CREATE INDEX "SirInterpretation_rawMicId_status_idx" ON "SirInterpretation"("rawMicId", "status");
CREATE INDEX "SirInterpretation_breakpointSetId_idx" ON "SirInterpretation"("breakpointSetId");
CREATE INDEX "SirInterpretation_supersedesId_idx" ON "SirInterpretation"("supersedesId");
CREATE INDEX "SirInterpretation_calculatedByUserId_idx" ON "SirInterpretation"("calculatedByUserId");
CREATE UNIQUE INDEX "SirInterpretation_current_plate_drug_key"
  ON "SirInterpretation"("plateId", "plateDrugId") WHERE "status" = 'CURRENT';

UPDATE "Plate"
SET
  "lastBreakpointSetId" = (
    SELECT rm."breakpointSetId"
    FROM "RawMic" rm
    WHERE rm."plateId" = "Plate"."id" AND rm."status" = 'CURRENT'
    ORDER BY rm."createdAt" DESC
    LIMIT 1
  ),
  "lastCalculatedAt" = (
    SELECT MAX(rm."createdAt")
    FROM "RawMic" rm
    WHERE rm."plateId" = "Plate"."id" AND rm."status" = 'CURRENT'
  );

PRAGMA foreign_keys=ON;
