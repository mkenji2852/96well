import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { buildPlateWorkbook } from "../src/lib/excel";

const prisma = new PrismaClient();

async function main() {
  const plate = await prisma.plate.findFirst({
    where: { sample: { sampleCode: "SEED-001" } },
    include: {
      sample: true,
      drugs: { orderBy: { rowIndex: "asc" } },
      wells: true,
      rawMics: {
        where: { status: "CURRENT" },
        include: {
          plateDrug: true,
          interpretations: { where: { status: "CURRENT", standard: "CLSI", ruleVersion: "2026.1" }, take: 1 },
        },
      },
      imageAssessments: { include: { reviews: true, overrides: true } },
    },
  });
  if (!plate) throw new Error("Run pnpm db:seed before export:sample");

  const auditLogs = await prisma.auditLog.findMany({
    where: { OR: [{ entityType: "Plate", entityId: plate.id }, { entityType: "Sample", entityId: plate.sampleId }] },
    orderBy: { createdAt: "asc" },
  });
  const exportId = randomUUID();
  const generatedAt = new Date();
  const rawMicIds = plate.rawMics.map((mic) => mic.id);
  const sirInterpretationIds = plate.rawMics.flatMap((mic) => mic.interpretations.map((interpretation) => interpretation.id));
  const metadata = {
    exportId,
    profile: "ANONYMIZED" as const,
    generatedAt,
    pseudonymousSampleId: `AST-${exportId.slice(0, 12)}`,
    breakpointSetId: plate.rawMics[0]?.breakpointSetId ?? null,
    breakpointStandard: "CLSI",
    breakpointVersion: "2026.1",
    breakpointContentHash: null,
    breakpointStatus: null,
    breakpointApprovedByUserId: null,
    breakpointApprovedAt: null,
    noBreakpointPolicy: "AS_NO_BREAKPOINT" as const,
    snapshot: {
      plateId: plate.id,
      plateRevision: plate.updatedAt.toISOString(),
      wellRevision: plate.wellRevision,
      resultRevision: plate.resultRevision,
      breakpointSetId: plate.rawMics[0]?.breakpointSetId ?? null,
      rawMicIds,
      sirInterpretationIds,
      imageReviewIds: [],
    },
  };
  const buffer = await buildPlateWorkbook({ plate, auditLogs, metadata });
  const outputDir = join(process.cwd(), "outputs");
  const fileName = "sample-mic-export.xlsx";
  const outputPath = join(outputDir, fileName);
  const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, buffer);
  const storedMetadata = { ...metadata, generatedAt: generatedAt.toISOString() };
  await prisma.$transaction([
    prisma.exportRecord.create({
      data: {
        id: exportId,
        plateId: plate.id,
        organizationId: plate.organizationId,
        fileName,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: buffer.byteLength,
        checksumSha256,
        breakpointStandard: metadata.breakpointStandard,
        breakpointVersion: metadata.breakpointVersion,
        breakpointContentHash: metadata.breakpointContentHash,
        metadataJson: storedMetadata as Prisma.InputJsonValue,
        actorLabel: "sample-export",
      },
    }),
    prisma.auditLog.create({
      data: {
        actorLabel: "sample-export",
        action: "EXCEL_EXPORTED",
        entityType: "Plate",
        entityId: plate.id,
        afterJson: { exportId, fileName, sizeBytes: buffer.byteLength, checksumSha256, metadata: storedMetadata },
      },
    }),
  ]);
  console.log(`${outputPath}\nsha256=${checksumSha256}`);
}

main().finally(async () => prisma.$disconnect());
