import {
  assertPostgresSchemaProvider,
  createPostgresPrisma,
  failIfUnsafe,
  inspectRequiredPostgresObjects,
  requirePostgresUrl,
} from "./postgres-utils";

async function main() {
  assertPostgresSchemaProvider();
  requirePostgresUrl();
  const prisma = createPostgresPrisma();
  try {
    const findings = await inspectRequiredPostgresObjects(prisma);
    failIfUnsafe(findings);
    console.log(JSON.stringify({ status: "MATCH", findings }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
