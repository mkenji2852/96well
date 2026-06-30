ALTER TABLE "BreakpointSet" ADD COLUMN "contentHashAlgorithm" TEXT NOT NULL DEFAULT 'sha256';
ALTER TABLE "BreakpointSet" ADD COLUMN "contentHashVersion" INTEGER NOT NULL DEFAULT 1;

DROP TRIGGER IF EXISTS "BreakpointSet_immutable_content";
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
  NEW."contentHashAlgorithm" IS NOT OLD."contentHashAlgorithm" OR
  NEW."contentHashVersion" IS NOT OLD."contentHashVersion" OR
  NEW."approvedAt" IS NOT OLD."approvedAt" OR
  NEW."approvedByUserId" IS NOT OLD."approvedByUserId"
)
BEGIN
  SELECT RAISE(ABORT, 'immutable breakpoint set content');
END;
