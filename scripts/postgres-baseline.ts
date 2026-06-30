import { readdirSync } from "node:fs";
import {
  POSTGRES_MIGRATIONS_DIR,
  assertPostgresSchemaProvider,
  createPostgresPrisma,
  failIfUnsafe,
  hasPrismaMigrationsTable,
  inspectRequiredPostgresObjects,
  requirePostgresUrl,
  runPrisma,
} from "./postgres-utils";

async function main() {
  assertPostgresSchemaProvider();
  const url = requirePostgresUrl();
  if (process.env.BACKUP_CONFIRMED !== "yes") {
    throw new Error("Refusing baseline: set BACKUP_CONFIRMED=yes after creating and verifying a backup.");
  }
  if (process.env.BASELINE_APPROVED !== "yes") {
    throw new Error("Refusing baseline: set BASELINE_APPROVED=yes after manual review of postgres-baseline-check output.");
  }

  const prisma = createPostgresPrisma(url);
  try {
    if (await hasPrismaMigrationsTable(prisma)) {
      throw new Error("_prisma_migrations already exists. Use migrate status/deploy instead of baseline.");
    }
    const findings = await inspectRequiredPostgresObjects(prisma);
    failIfUnsafe(findings);
  } finally {
    await prisma.$disconnect();
  }

  const migrations = readdirSync(POSTGRES_MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migration of migrations) {
    runPrisma(["migrate", "resolve", "--schema", "prisma/postgresql/schema.prisma", "--applied", migration]);
  }
  runPrisma(["migrate", "status", "--schema", "prisma/postgresql/schema.prisma"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
