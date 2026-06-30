-- CreateEnum
CREATE TYPE "Role" AS ENUM ('TECHNICIAN', 'REVIEWER', 'ADMIN', 'AUDITOR');

-- CreateEnum
CREATE TYPE "PlateStatus" AS ENUM ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'SAVED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "WellState" AS ENUM ('UNREAD', 'GROWTH', 'INHIBITED', 'CONTAMINATED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('MANUAL', 'IMAGE_REVIEWED', 'IMAGE_ASSISTED');

-- CreateEnum
CREATE TYPE "ImageAssessmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'ANALYSIS_FAILED');

-- CreateEnum
CREATE TYPE "ImageReviewDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MicModifier" AS ENUM ('EQUAL', 'LESS_THAN_OR_EQUAL', 'GREATER_THAN', 'NOT_DETERMINED');

-- CreateEnum
CREATE TYPE "SirCategory" AS ENUM ('S', 'I', 'R', 'NO_BREAKPOINT', 'NOT_DETERMINED');

-- CreateEnum
CREATE TYPE "ResultRecordStatus" AS ENUM ('CURRENT', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BreakpointSetStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalSubject" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "sampleCode" TEXT NOT NULL,
    "organism" TEXT,
    "collectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plate" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PlateStatus" NOT NULL DEFAULT 'DRAFT',
    "layoutVersion" TEXT NOT NULL DEFAULT '96-well-v1',
    "wellRevision" INTEGER NOT NULL DEFAULT 0,
    "resultRevision" INTEGER NOT NULL DEFAULT 0,
    "lastCalculatedAt" TIMESTAMP(3),
    "lastBreakpointSetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlateDrug" (
    "id" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "drugName" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'µg/mL',
    "concentrations" JSONB NOT NULL,

    CONSTRAINT "PlateDrug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlateWell" (
    "id" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "columnIndex" INTEGER NOT NULL,
    "state" "WellState" NOT NULL DEFAULT 'UNREAD',
    "source" "DataSource" NOT NULL DEFAULT 'MANUAL',
    "confidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourcePredictionId" TEXT,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "PlateWell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawMic" (
    "id" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "plateDrugId" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "modifier" "MicModifier" NOT NULL,
    "rawMicOperator" TEXT,
    "endpointRule" TEXT,
    "calculationMethod" TEXT NOT NULL DEFAULT 'broth-microdilution-v2',
    "calculationEngineVersion" TEXT NOT NULL DEFAULT 'broth-microdilution-v2',
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "sourceWellRevision" INTEGER NOT NULL DEFAULT 0,
    "breakpointSetId" TEXT NOT NULL,
    "status" "ResultRecordStatus" NOT NULL DEFAULT 'CURRENT',
    "supersedesId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "rationaleJson" JSONB,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "RawMic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakpointSet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "organism" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'µg/mL',
    "method" TEXT NOT NULL DEFAULT 'BROTH_MICRODILUTION',
    "status" "BreakpointSetStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "retiredAt" TIMESTAMP(3),
    "retiredByUserId" TEXT,
    "retireReason" TEXT,
    "approvalComment" TEXT,
    "sourceDocumentReference" TEXT,
    "sourceDocumentChecksum" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "supersedesBreakpointSetId" TEXT,
    "contentHash" TEXT,
    "contentHashAlgorithm" TEXT NOT NULL DEFAULT 'sha256',
    "contentHashVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BreakpointSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakpointRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "breakpointSetId" TEXT NOT NULL,
    "drugName" TEXT NOT NULL,
    "organism" TEXT,
    "standard" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "susceptibleMax" DOUBLE PRECISION NOT NULL,
    "resistantMin" DOUBLE PRECISION NOT NULL,
    "intermediateMin" DOUBLE PRECISION,
    "intermediateMax" DOUBLE PRECISION,
    "unit" TEXT NOT NULL DEFAULT 'µg/mL',
    "method" TEXT NOT NULL DEFAULT 'BROTH_MICRODILUTION',
    "exceptionJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BreakpointRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SirInterpretation" (
    "id" TEXT NOT NULL,
    "rawMicId" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "plateDrugId" TEXT NOT NULL,
    "breakpointSetId" TEXT NOT NULL,
    "breakpointRuleId" TEXT,
    "category" "SirCategory" NOT NULL,
    "standard" TEXT,
    "ruleVersion" TEXT,
    "susceptibleMax" DOUBLE PRECISION,
    "resistantMin" DOUBLE PRECISION,
    "ruleEngineVersion" TEXT NOT NULL DEFAULT 'sir-rule-engine-v2',
    "status" "ResultRecordStatus" NOT NULL DEFAULT 'CURRENT',
    "supersedesId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "rationaleJson" JSONB,
    "interpretedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calculatedByUserId" TEXT,

    CONSTRAINT "SirInterpretation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportRecord" (
    "id" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "organizationId" TEXT,
    "actorUserId" TEXT,
    "profile" TEXT NOT NULL DEFAULT 'ANONYMIZED',
    "reason" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "breakpointStandard" TEXT,
    "breakpointVersion" TEXT,
    "breakpointContentHash" TEXT,
    "metadataJson" JSONB NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "downloadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageAssessment" (
    "id" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "imageReference" TEXT,
    "modelVersion" TEXT,
    "confidence" DOUBLE PRECISION,
    "predictedStates" JSONB,
    "status" "ImageAssessmentStatus" NOT NULL DEFAULT 'PENDING',
    "manualReviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImagePrediction" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "imageReference" TEXT,
    "modelVersion" TEXT NOT NULL,
    "qcScore" DOUBLE PRECISION,
    "qcFlags" JSONB,
    "detectedWells" INTEGER NOT NULL,
    "plateConfidence" DOUBLE PRECISION,
    "predictions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImagePrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageReview" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "decision" "ImageReviewDecision" NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejectionReason" TEXT,
    "overrideReason" TEXT,
    "confirmedWellsJson" JSONB,
    "overridesJson" JSONB,

    CONSTRAINT "ImageReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageWellOverride" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "imagePredictionId" TEXT NOT NULL,
    "reviewerUserId" TEXT,
    "rowIndex" INTEGER NOT NULL,
    "columnIndex" INTEGER NOT NULL,
    "beforeState" "WellState" NOT NULL,
    "afterState" "WellState" NOT NULL,
    "reason" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageWellOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_externalSubject_key" ON "User"("externalSubject");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "Sample_organizationId_createdAt_idx" ON "Sample"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_organizationId_sampleCode_key" ON "Sample"("organizationId", "sampleCode");

-- CreateIndex
CREATE INDEX "Plate_organizationId_createdAt_idx" ON "Plate"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlateDrug_plateId_rowIndex_key" ON "PlateDrug"("plateId", "rowIndex");

-- CreateIndex
CREATE INDEX "PlateWell_sourcePredictionId_idx" ON "PlateWell"("sourcePredictionId");

-- CreateIndex
CREATE INDEX "PlateWell_confirmedByUserId_idx" ON "PlateWell"("confirmedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PlateWell_plateId_rowIndex_columnIndex_key" ON "PlateWell"("plateId", "rowIndex", "columnIndex");

-- CreateIndex
CREATE INDEX "RawMic_plateId_plateDrugId_status_idx" ON "RawMic"("plateId", "plateDrugId", "status");

-- CreateIndex
CREATE INDEX "RawMic_breakpointSetId_idx" ON "RawMic"("breakpointSetId");

-- CreateIndex
CREATE INDEX "RawMic_supersedesId_idx" ON "RawMic"("supersedesId");

-- CreateIndex
CREATE INDEX "RawMic_createdByUserId_idx" ON "RawMic"("createdByUserId");

-- CreateIndex
CREATE INDEX "BreakpointSet_organizationId_status_effectiveFrom_effective_idx" ON "BreakpointSet"("organizationId", "status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "BreakpointSet_organizationId_standard_version_idx" ON "BreakpointSet"("organizationId", "standard", "version");

-- CreateIndex
CREATE INDEX "BreakpointSet_supersedesBreakpointSetId_idx" ON "BreakpointSet"("supersedesBreakpointSetId");

-- CreateIndex
CREATE INDEX "BreakpointSet_createdByUserId_idx" ON "BreakpointSet"("createdByUserId");

-- CreateIndex
CREATE INDEX "BreakpointSet_approvedByUserId_idx" ON "BreakpointSet"("approvedByUserId");

-- CreateIndex
CREATE INDEX "BreakpointSet_retiredByUserId_idx" ON "BreakpointSet"("retiredByUserId");

-- CreateIndex
CREATE INDEX "BreakpointRule_organizationId_idx" ON "BreakpointRule"("organizationId");

-- CreateIndex
CREATE INDEX "BreakpointRule_breakpointSetId_idx" ON "BreakpointRule"("breakpointSetId");

-- CreateIndex
CREATE UNIQUE INDEX "BreakpointRule_breakpointSetId_drugName_organism_unit_metho_key" ON "BreakpointRule"("breakpointSetId", "drugName", "organism", "unit", "method");

-- CreateIndex
CREATE INDEX "SirInterpretation_plateId_plateDrugId_breakpointSetId_statu_idx" ON "SirInterpretation"("plateId", "plateDrugId", "breakpointSetId", "status");

-- CreateIndex
CREATE INDEX "SirInterpretation_rawMicId_status_idx" ON "SirInterpretation"("rawMicId", "status");

-- CreateIndex
CREATE INDEX "SirInterpretation_breakpointSetId_idx" ON "SirInterpretation"("breakpointSetId");

-- CreateIndex
CREATE INDEX "SirInterpretation_supersedesId_idx" ON "SirInterpretation"("supersedesId");

-- CreateIndex
CREATE INDEX "SirInterpretation_calculatedByUserId_idx" ON "SirInterpretation"("calculatedByUserId");

-- CreateIndex
CREATE INDEX "ExportRecord_plateId_createdAt_idx" ON "ExportRecord"("plateId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportRecord_organizationId_createdAt_idx" ON "ExportRecord"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ExportRecord_actorUserId_createdAt_idx" ON "ExportRecord"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageAssessment_plateId_status_createdAt_idx" ON "ImageAssessment"("plateId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ImageAssessment_uploadedByUserId_idx" ON "ImageAssessment"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "ImagePrediction_assessmentId_createdAt_idx" ON "ImagePrediction"("assessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "ImagePrediction_plateId_createdAt_idx" ON "ImagePrediction"("plateId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageReview_assessmentId_reviewedAt_idx" ON "ImageReview"("assessmentId", "reviewedAt");

-- CreateIndex
CREATE INDEX "ImageReview_reviewerUserId_idx" ON "ImageReview"("reviewerUserId");

-- CreateIndex
CREATE INDEX "ImageWellOverride_assessmentId_rowIndex_columnIndex_idx" ON "ImageWellOverride"("assessmentId", "rowIndex", "columnIndex");

-- CreateIndex
CREATE INDEX "ImageWellOverride_imagePredictionId_idx" ON "ImageWellOverride"("imagePredictionId");

-- CreateIndex
CREATE INDEX "ImageWellOverride_reviewerUserId_idx" ON "ImageWellOverride"("reviewerUserId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_plateId_createdAt_idx" ON "IdempotencyRecord"("plateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_actorUserId_key_key" ON "IdempotencyRecord"("organizationId", "actorUserId", "key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plate" ADD CONSTRAINT "Plate_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plate" ADD CONSTRAINT "Plate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateDrug" ADD CONSTRAINT "PlateDrug_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateWell" ADD CONSTRAINT "PlateWell_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateWell" ADD CONSTRAINT "PlateWell_sourcePredictionId_fkey" FOREIGN KEY ("sourcePredictionId") REFERENCES "ImagePrediction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateWell" ADD CONSTRAINT "PlateWell_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMic" ADD CONSTRAINT "RawMic_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMic" ADD CONSTRAINT "RawMic_plateDrugId_fkey" FOREIGN KEY ("plateDrugId") REFERENCES "PlateDrug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMic" ADD CONSTRAINT "RawMic_breakpointSetId_fkey" FOREIGN KEY ("breakpointSetId") REFERENCES "BreakpointSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMic" ADD CONSTRAINT "RawMic_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "RawMic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawMic" ADD CONSTRAINT "RawMic_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakpointSet" ADD CONSTRAINT "BreakpointSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakpointSet" ADD CONSTRAINT "BreakpointSet_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakpointSet" ADD CONSTRAINT "BreakpointSet_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakpointSet" ADD CONSTRAINT "BreakpointSet_retiredByUserId_fkey" FOREIGN KEY ("retiredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakpointSet" ADD CONSTRAINT "BreakpointSet_supersedesBreakpointSetId_fkey" FOREIGN KEY ("supersedesBreakpointSetId") REFERENCES "BreakpointSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakpointRule" ADD CONSTRAINT "BreakpointRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakpointRule" ADD CONSTRAINT "BreakpointRule_breakpointSetId_fkey" FOREIGN KEY ("breakpointSetId") REFERENCES "BreakpointSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirInterpretation" ADD CONSTRAINT "SirInterpretation_rawMicId_fkey" FOREIGN KEY ("rawMicId") REFERENCES "RawMic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirInterpretation" ADD CONSTRAINT "SirInterpretation_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirInterpretation" ADD CONSTRAINT "SirInterpretation_plateDrugId_fkey" FOREIGN KEY ("plateDrugId") REFERENCES "PlateDrug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirInterpretation" ADD CONSTRAINT "SirInterpretation_breakpointSetId_fkey" FOREIGN KEY ("breakpointSetId") REFERENCES "BreakpointSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirInterpretation" ADD CONSTRAINT "SirInterpretation_breakpointRuleId_fkey" FOREIGN KEY ("breakpointRuleId") REFERENCES "BreakpointRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirInterpretation" ADD CONSTRAINT "SirInterpretation_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "SirInterpretation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SirInterpretation" ADD CONSTRAINT "SirInterpretation_calculatedByUserId_fkey" FOREIGN KEY ("calculatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportRecord" ADD CONSTRAINT "ExportRecord_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAssessment" ADD CONSTRAINT "ImageAssessment_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageAssessment" ADD CONSTRAINT "ImageAssessment_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagePrediction" ADD CONSTRAINT "ImagePrediction_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ImageAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImagePrediction" ADD CONSTRAINT "ImagePrediction_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageReview" ADD CONSTRAINT "ImageReview_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ImageAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageReview" ADD CONSTRAINT "ImageReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageWellOverride" ADD CONSTRAINT "ImageWellOverride_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "ImageAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageWellOverride" ADD CONSTRAINT "ImageWellOverride_imagePredictionId_fkey" FOREIGN KEY ("imagePredictionId") REFERENCES "ImagePrediction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageWellOverride" ADD CONSTRAINT "ImageWellOverride_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

