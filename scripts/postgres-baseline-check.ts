import {
  assertPostgresSchemaProvider,
  createPostgresPrisma,
  failIfUnsafe,
  hasPrismaMigrationsTable,
  inspectRequiredPostgresObjects,
  requirePostgresUrl,
} from "./postgres-utils";

async function main() {
  assertPostgresSchemaProvider();
  requirePostgresUrl();
  const prisma = createPostgresPrisma();
  try {
    const hasHistory = await hasPrismaMigrationsTable(prisma);
    const findings = await inspectRequiredPostgresObjects(prisma);
    const summary = {
      prismaMigrationsTable: hasHistory ? "MATCH" : "MISSING",
      baselineAllowed: !hasHistory && findings.every((finding) => finding.status === "MATCH"),
      findings,
      nextStep: hasHistory
        ? "Run prisma migrate status/deploy. Baseline resolve is not needed."
        : "Take a backup, review this report, then run postgres:baseline only with BACKUP_CONFIRMED=yes and BASELINE_APPROVED=yes.",
    };
    console.log(JSON.stringify(summary, null, 2));
    failIfUnsafe(findings);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
