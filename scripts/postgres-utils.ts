import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

export const POSTGRES_SCHEMA_PATH = "prisma/postgresql/schema.prisma";
export const POSTGRES_MIGRATIONS_DIR = "prisma/postgresql/migrations";

export type BaselineStatus = "MATCH" | "MISSING" | "DIFFERENT" | "EXTRA" | "UNSAFE_TO_BASELINE";

export interface BaselineFinding {
  status: BaselineStatus;
  objectType: string;
  objectName: string;
  detail: string;
}

export function requirePostgresUrl(envName = "POSTGRES_PRISMA_DATABASE_URL"): string {
  const url = process.env[envName];
  if (!url) throw new Error(`${envName} is required.`);
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(`${envName} must use postgresql:// or postgres://. Refusing to run against SQLite or an unknown provider.`);
  }
  return url;
}

export function assertPostgresSchemaProvider(schemaPath = POSTGRES_SCHEMA_PATH): void {
  const schema = readFileSync(schemaPath, "utf8");
  if (!schema.includes('provider = "postgresql"')) {
    throw new Error(`${schemaPath} is not a PostgreSQL schema.`);
  }
  if (!schema.includes('url      = env("POSTGRES_PRISMA_DATABASE_URL")')) {
    throw new Error(`${schemaPath} must use POSTGRES_PRISMA_DATABASE_URL.`);
  }
}

export function createPostgresPrisma(url = requirePostgresUrl()): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}

export async function listTables(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  return new Set(rows.map((row) => row.table_name));
}

export async function hasPrismaMigrationsTable(prisma: PrismaClient): Promise<boolean> {
  return (await listTables(prisma)).has("_prisma_migrations");
}

export async function inspectRequiredPostgresObjects(prisma: PrismaClient): Promise<BaselineFinding[]> {
  const findings: BaselineFinding[] = [];
  const requiredTables = [
    "Organization", "User", "Sample", "Plate", "PlateDrug", "PlateWell",
    "BreakpointSet", "BreakpointRule", "RawMic", "SirInterpretation",
    "ImageAssessment", "ImagePrediction", "ImageReview", "ImageWellOverride",
    "ExportRecord", "AuditLog", "IdempotencyRecord", "UserInvite",
  ];
  const tables = await listTables(prisma);
  for (const table of requiredTables) {
    findings.push({
      status: tables.has(table) ? "MATCH" : "UNSAFE_TO_BASELINE",
      objectType: "table",
      objectName: table,
      detail: tables.has(table) ? "present" : "required table is missing",
    });
  }

  const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>>`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;
  const columnSet = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const requiredColumns = [
    "BreakpointSet.status",
    "BreakpointSet.contentHash",
    "BreakpointSet.contentHashAlgorithm",
    "BreakpointSet.contentHashVersion",
    "BreakpointSet.revision",
    "RawMic.status",
    "RawMic.supersedesId",
    "RawMic.breakpointSetId",
    "SirInterpretation.status",
    "SirInterpretation.supersedesId",
    "SirInterpretation.breakpointSetId",
    "Plate.wellRevision",
    "Plate.resultRevision",
    "IdempotencyRecord.key",
    "ExportRecord.metadataJson",
    "UserInvite.email",
    "UserInvite.redeemedAt",
    "UserInvite.redeemedByUserId",
  ];
  for (const column of requiredColumns) {
    findings.push({
      status: columnSet.has(column) ? "MATCH" : "UNSAFE_TO_BASELINE",
      objectType: "column",
      objectName: column,
      detail: columnSet.has(column) ? "present" : "required column is missing",
    });
  }

  const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
  `;
  const indexByName = new Map(indexes.map((row) => [row.indexname, row.indexdef]));
  const requiredPartialIndexes = [
    ["RawMic_current_plate_drug_key", "WHERE (status = 'CURRENT'"],
    ["SirInterpretation_current_plate_drug_key", "WHERE (status = 'CURRENT'"],
    ["BreakpointSet_formal_org_standard_version_key", "WHERE (status = ANY"],
  ];
  for (const [name, expectedFragment] of requiredPartialIndexes) {
    const definition = indexByName.get(name) ?? "";
    findings.push({
      status: definition.includes(expectedFragment) ? "MATCH" : "UNSAFE_TO_BASELINE",
      objectType: "partial_index",
      objectName: name,
      detail: definition ? definition : "partial index is missing",
    });
  }

  const triggers = await prisma.$queryRaw<Array<{ trigger_name: string; event_object_table: string }>>`
    SELECT trigger_name, event_object_table
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
  `;
  const triggerSet = new Set(triggers.map((row) => `${row.event_object_table}.${row.trigger_name}`));
  for (const trigger of [
    "BreakpointSet.breakpoint_set_immutable_update",
    "BreakpointSet.breakpoint_set_immutable_delete",
    "BreakpointRule.breakpoint_rule_immutable_change",
  ]) {
    findings.push({
      status: triggerSet.has(trigger) ? "MATCH" : "UNSAFE_TO_BASELINE",
      objectType: "trigger",
      objectName: trigger,
      detail: triggerSet.has(trigger) ? "present" : "required trigger is missing",
    });
  }

  const enumLabels = await prisma.$queryRaw<Array<{ typname: string; enumlabel: string }>>`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname IN ('Role', 'BreakpointSetStatus', 'ResultRecordStatus')
  `;
  const enumSet = new Set(enumLabels.map((row) => `${row.typname}.${row.enumlabel}`));
  for (const value of ["Role.AUDITOR", "BreakpointSetStatus.APPROVED", "ResultRecordStatus.CURRENT"]) {
    findings.push({
      status: enumSet.has(value) ? "MATCH" : "UNSAFE_TO_BASELINE",
      objectType: "enum",
      objectName: value,
      detail: enumSet.has(value) ? "present" : "required enum value is missing",
    });
  }

  return findings;
}

export function failIfUnsafe(findings: BaselineFinding[]): void {
  const unsafe = findings.filter((finding) => finding.status === "UNSAFE_TO_BASELINE");
  if (unsafe.length > 0) {
    console.error(JSON.stringify({ status: "UNSAFE_TO_BASELINE", unsafe }, null, 2));
    process.exit(2);
  }
}

export function runPrisma(args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const command = process.platform === "win32" ? "node_modules\\.bin\\prisma.cmd" : "node_modules/.bin/prisma";
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed with status ${result.status}`);
  }
}
