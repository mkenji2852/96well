import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

export type PlateWellBulkUpsertInput = {
  rowIndex: number;
  columnIndex: number;
  state: string;
};

export function buildBulkPlateWellUpsertSql({
  plateId,
  wells,
  confirmedByUserId,
  confirmedAt,
  createId = randomUUID,
}: {
  plateId: string;
  wells: PlateWellBulkUpsertInput[];
  confirmedByUserId: string;
  confirmedAt: Date;
  createId?: () => string;
}): Prisma.Sql | null {
  if (wells.length === 0) return null;

  const manualSource = "MANUAL";
  const rows = wells.map((well) => Prisma.sql`(
    ${createId()},
    ${plateId},
    ${well.rowIndex},
    ${well.columnIndex},
    ${well.state}::"WellState",
    ${manualSource}::"DataSource",
    ${null}::double precision,
    ${false},
    ${confirmedAt},
    ${null}::text,
    ${confirmedByUserId},
    ${confirmedAt}
  )`);

  return Prisma.sql`
    INSERT INTO "PlateWell" (
      "id",
      "plateId",
      "rowIndex",
      "columnIndex",
      "state",
      "source",
      "confidence",
      "needsReview",
      "observedAt",
      "sourcePredictionId",
      "confirmedByUserId",
      "confirmedAt"
    )
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("plateId", "rowIndex", "columnIndex")
    DO UPDATE SET
      "state" = EXCLUDED."state",
      "source" = EXCLUDED."source",
      "confidence" = EXCLUDED."confidence",
      "needsReview" = EXCLUDED."needsReview",
      "observedAt" = EXCLUDED."observedAt",
      "sourcePredictionId" = EXCLUDED."sourcePredictionId",
      "confirmedByUserId" = EXCLUDED."confirmedByUserId",
      "confirmedAt" = EXCLUDED."confirmedAt"
  `;
}

export async function bulkUpsertPlateWells(
  tx: Prisma.TransactionClient,
  args: {
    plateId: string;
    wells: PlateWellBulkUpsertInput[];
    confirmedByUserId: string;
    confirmedAt: Date;
  },
): Promise<void> {
  const sql = buildBulkPlateWellUpsertSql(args);
  if (!sql) return;
  await tx.$executeRaw(sql);
}
