PRAGMA foreign_keys=OFF;

CREATE TABLE "ImagePrediction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assessmentId" TEXT NOT NULL,
  "plateId" TEXT NOT NULL,
  "imageReference" TEXT,
  "modelVersion" TEXT NOT NULL,
  "qcScore" REAL,
  "qcFlags" JSONB,
  "detectedWells" INTEGER NOT NULL,
  "plateConfidence" REAL,
  "predictions" JSONB NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImagePrediction_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ImageAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ImagePrediction_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ImagePrediction_assessmentId_createdAt_idx" ON "ImagePrediction"("assessmentId", "createdAt");
CREATE INDEX "ImagePrediction_plateId_createdAt_idx" ON "ImagePrediction"("plateId", "createdAt");

CREATE TABLE "ImageReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assessmentId" TEXT NOT NULL,
  "reviewerUserId" TEXT,
  "decision" TEXT NOT NULL,
  "reviewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rejectionReason" TEXT,
  "overrideReason" TEXT,
  "confirmedWellsJson" JSONB,
  "overridesJson" JSONB,
  CONSTRAINT "ImageReview_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ImageAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ImageReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ImageReview_assessmentId_reviewedAt_idx" ON "ImageReview"("assessmentId", "reviewedAt");
CREATE INDEX "ImageReview_reviewerUserId_idx" ON "ImageReview"("reviewerUserId");

CREATE TABLE "ImageWellOverride" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "assessmentId" TEXT NOT NULL,
  "imagePredictionId" TEXT NOT NULL,
  "reviewerUserId" TEXT,
  "rowIndex" INTEGER NOT NULL,
  "columnIndex" INTEGER NOT NULL,
  "beforeState" TEXT NOT NULL,
  "afterState" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImageWellOverride_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ImageAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ImageWellOverride_imagePredictionId_fkey" FOREIGN KEY ("imagePredictionId") REFERENCES "ImagePrediction"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ImageWellOverride_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ImageWellOverride_assessmentId_rowIndex_columnIndex_idx" ON "ImageWellOverride"("assessmentId", "rowIndex", "columnIndex");
CREATE INDEX "ImageWellOverride_imagePredictionId_idx" ON "ImageWellOverride"("imagePredictionId");
CREATE INDEX "ImageWellOverride_reviewerUserId_idx" ON "ImageWellOverride"("reviewerUserId");

ALTER TABLE "ImageAssessment" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "ImageAssessment" ADD COLUMN "uploadedByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ImageAssessment_plateId_status_createdAt_idx" ON "ImageAssessment"("plateId", "status", "createdAt");
CREATE INDEX "ImageAssessment_uploadedByUserId_idx" ON "ImageAssessment"("uploadedByUserId");

ALTER TABLE "PlateWell" ADD COLUMN "sourcePredictionId" TEXT REFERENCES "ImagePrediction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlateWell" ADD COLUMN "confirmedByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlateWell" ADD COLUMN "confirmedAt" DATETIME;
CREATE INDEX "PlateWell_sourcePredictionId_idx" ON "PlateWell"("sourcePredictionId");
CREATE INDEX "PlateWell_confirmedByUserId_idx" ON "PlateWell"("confirmedByUserId");

UPDATE "ImageAssessment"
SET "status" = 'REVIEW_REQUIRED',
    "manualReviewRequired" = true
WHERE "status" = 'PENDING';

UPDATE "PlateWell"
SET "needsReview" = true
WHERE "source" = 'IMAGE_ASSISTED';

UPDATE "Plate"
SET "status" = 'REVIEW_REQUIRED'
WHERE "id" IN (
  SELECT DISTINCT "plateId"
  FROM "PlateWell"
  WHERE "source" = 'IMAGE_ASSISTED'
);

PRAGMA foreign_keys=ON;
