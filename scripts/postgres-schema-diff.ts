import { readFileSync } from "node:fs";
import { assertPostgresSchemaProvider } from "./postgres-utils";

function comparableModelBody(schema: string): string {
  return schema
    .replace(/datasource db \{[\s\S]*?\}\s*/m, "")
    .replace(/provider = "postgresql"/g, 'provider = "sqlite"')
    .replace(/url\s+= env\("POSTGRES_PRISMA_DATABASE_URL"\)/g, 'url      = env("DATABASE_URL")')
    .replace(/\r\n/g, "\n")
    .trim();
}

function main() {
  assertPostgresSchemaProvider();
  const sqliteSchema = readFileSync("prisma/schema.prisma", "utf8");
  const postgresSchema = readFileSync("prisma/postgresql/schema.prisma", "utf8");
  const sqliteComparable = comparableModelBody(sqliteSchema);
  const postgresComparable = comparableModelBody(postgresSchema);
  if (sqliteComparable !== postgresComparable) {
    console.error("SQLite and PostgreSQL Prisma schemas differ outside the datasource block.");
    process.exit(2);
  }
  console.log("SQLite/PostgreSQL Prisma schemas match outside the datasource block.");
}

main();
