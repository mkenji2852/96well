ALTER TABLE "ExportRecord" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ExportRecord" ADD COLUMN "actorUserId" TEXT;
ALTER TABLE "ExportRecord" ADD COLUMN "profile" TEXT NOT NULL DEFAULT 'ANONYMIZED';
ALTER TABLE "ExportRecord" ADD COLUMN "reason" TEXT;
ALTER TABLE "ExportRecord" ADD COLUMN "expiresAt" DATETIME;
ALTER TABLE "ExportRecord" ADD COLUMN "downloadedAt" DATETIME;

CREATE INDEX IF NOT EXISTS "ExportRecord_organizationId_createdAt_idx"
  ON "ExportRecord"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "ExportRecord_actorUserId_createdAt_idx"
  ON "ExportRecord"("actorUserId", "createdAt");
