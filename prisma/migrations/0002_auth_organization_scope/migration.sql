PRAGMA foreign_keys=OFF;

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "Organization" ("id", "name", "active")
VALUES ('legacy-default-org', 'Legacy default organization', true);

CREATE TABLE "new_User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "externalSubject" TEXT,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_User" ("id", "organizationId", "name", "email", "role", "createdAt")
SELECT "id", 'legacy-default-org', "name", "email", "role", "createdAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_externalSubject_key" ON "User"("externalSubject");
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

CREATE TABLE "new_Sample" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "sampleCode" TEXT NOT NULL,
  "organism" TEXT,
  "collectedAt" DATETIME,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Sample_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Sample_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Sample" ("id", "organizationId", "sampleCode", "organism", "collectedAt", "notes", "createdAt", "updatedAt")
SELECT "id", 'legacy-default-org', "sampleCode", "organism", "collectedAt", "notes", "createdAt", "updatedAt" FROM "Sample";
DROP TABLE "Sample";
ALTER TABLE "new_Sample" RENAME TO "Sample";
CREATE INDEX "Sample_organizationId_createdAt_idx" ON "Sample"("organizationId", "createdAt");
CREATE UNIQUE INDEX "Sample_organizationId_sampleCode_key" ON "Sample"("organizationId", "sampleCode");

CREATE TABLE "new_Plate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sampleId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "layoutVersion" TEXT NOT NULL DEFAULT '96-well-v1',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Plate_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Plate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Plate" ("id", "sampleId", "organizationId", "name", "status", "layoutVersion", "createdAt", "updatedAt")
SELECT "id", "sampleId", 'legacy-default-org', "name", "status", "layoutVersion", "createdAt", "updatedAt" FROM "Plate";
DROP TABLE "Plate";
ALTER TABLE "new_Plate" RENAME TO "Plate";
CREATE INDEX "Plate_organizationId_createdAt_idx" ON "Plate"("organizationId", "createdAt");

CREATE TABLE "new_BreakpointRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "drugName" TEXT NOT NULL,
  "organism" TEXT,
  "standard" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "susceptibleMax" REAL NOT NULL,
  "resistantMin" REAL NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'µg/mL',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "validFrom" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BreakpointRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BreakpointRule" ("id", "organizationId", "drugName", "organism", "standard", "version", "susceptibleMax", "resistantMin", "unit", "active", "validFrom", "createdAt")
SELECT "id", 'legacy-default-org', "drugName", "organism", "standard", "version", "susceptibleMax", "resistantMin", "unit", "active", "validFrom", "createdAt" FROM "BreakpointRule";
DROP TABLE "BreakpointRule";
ALTER TABLE "new_BreakpointRule" RENAME TO "BreakpointRule";
CREATE UNIQUE INDEX "BreakpointRule_organizationId_drugName_organism_standard_version_key"
  ON "BreakpointRule"("organizationId", "drugName", "organism", "standard", "version");
CREATE INDEX "BreakpointRule_organizationId_active_idx" ON "BreakpointRule"("organizationId", "active");

PRAGMA foreign_keys=ON;
