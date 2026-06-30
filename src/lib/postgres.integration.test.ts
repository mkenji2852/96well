import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const postgresUrl = process.env.POSTGRES_TEST_DATABASE_URL ?? process.env.POSTGRES_PRISMA_DATABASE_URL;
const describePostgres = postgresUrl ? describe : describe.skip;
const safePostgresUrl = postgresUrl ?? "postgresql://skip:skip@localhost:5432/skip";

function prismaFor(url: string) {
  return new PrismaClient({ datasources: { db: { url } } });
}

describePostgres("PostgreSQL production hardening", () => {
  const prisma = prismaFor(safePostgresUrl);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "RawMic"');
    await prisma.$executeRawUnsafe('DELETE FROM "SirInterpretation"');
    await prisma.$executeRawUnsafe('DELETE FROM "PlateDrug"');
    await prisma.$executeRawUnsafe('DELETE FROM "PlateWell"');
    await prisma.$executeRawUnsafe('DELETE FROM "BreakpointRule"');
    await prisma.$executeRawUnsafe('DELETE FROM "BreakpointSet"');
    await prisma.$executeRawUnsafe('DELETE FROM "Plate"');
    await prisma.$executeRawUnsafe('DELETE FROM "Sample"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$executeRawUnsafe('DELETE FROM "Organization"');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

async function executeStatements(statements: string[]) {
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

  async function seedApprovedBreakpointSet(status: "APPROVED" | "RETIRED" = "APPROVED") {
    await excuteStatements([
      INSERT INTO "Organization" ("id", "name") VALUES ('org-pg', 'PG Org');
      INSERT INTO "User" ("id", "organizationId", "name", "email", "role")
      VALUES ('admin-pg', 'org-pg', 'Admin', 'admin-pg@example.test', 'ADMIN');
      INSERT INTO "BreakpointSet" (
        "id", "organizationId", "standard", "version", "organism", "status",
        "approvedAt", "approvedByUserId", "retiredAt", "retiredByUserId", "retireReason",
        "contentHash", "contentHashAlgorithm", "contentHashVersion", "createdByUserId", "updatedAt"
      ) VALUES (
        'bps-pg', 'org-pg', 'CLSI', '2026.1', 'E. coli', '${status}',
        now(), 'admin-pg',
        ${status === "RETIRED" ? "now(), 'admin-pg', 'superseded'" : "NULL, NULL, NULL"},
        'hash-pg', 'sha256', 1, 'admin-pg', now()
      );
    ]);
  }

  it("rejects direct updates and deletes for APPROVED BreakpointSet and rules", async () => {
    await seedApprovedBreakpointSet("APPROVED");

    await expect(prisma.$executeRawUnsafe(`UPDATE "BreakpointSet" SET "version" = 'tampered' WHERE "id" = 'bps-pg'`))
      .rejects.toThrow(/AST_BREAKPOINT_IMMUTABLE_SET_CONTENT/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "BreakpointSet" WHERE "id" = 'bps-pg'`))
      .rejects.toThrow(/AST_BREAKPOINT_IMMUTABLE_SET_DELETE/);
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO "BreakpointRule" (
        "id", "organizationId", "breakpointSetId", "drugName", "standard", "version",
        "susceptibleMax", "resistantMin", "unit", "method", "updatedAt"
      ) VALUES ('rule-pg', 'org-pg', 'bps-pg', 'AMP', 'CLSI', '2026.1', 1, 4, 'µg/mL', 'BROTH_MICRODILUTION', now())
    `)).rejects.toThrow(/AST_BREAKPOINT_IMMUTABLE_RULE/);
  });

  it("allows DRAFT edits and clone-like independent DRAFT rules", async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Organization" ("id", "name") VALUES ('org-pg', 'PG Org');
      INSERT INTO "User" ("id", "organizationId", "name", "email", "role")
      VALUES ('admin-pg', 'org-pg', 'Admin', 'admin-pg@example.test', 'ADMIN');
      INSERT INTO "BreakpointSet" (
        "id", "organizationId", "standard", "version", "organism", "status", "createdByUserId", "updatedAt"
      ) VALUES ('bps-draft', 'org-pg', 'CLSI', '2026.2', 'E. coli', 'DRAFT', 'admin-pg', now());
    `);
    await expect(prisma.$executeRawUnsafe(`UPDATE "BreakpointSet" SET "version" = '2026.3' WHERE "id" = 'bps-draft'`))
      .resolves.toBeGreaterThanOrEqual(0);
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO "BreakpointRule" (
        "id", "organizationId", "breakpointSetId", "drugName", "standard", "version",
        "susceptibleMax", "resistantMin", "unit", "method", "updatedAt"
      ) VALUES ('rule-draft', 'org-pg', 'bps-draft', 'AMP', 'CLSI', '2026.3', 1, 4, 'µg/mL', 'BROTH_MICRODILUTION', now())
    `)).resolves.toBeGreaterThanOrEqual(0);
  });

  it("enforces CURRENT uniqueness for RawMic and SirInterpretation", async () => {
    await seedApprovedBreakpointSet("APPROVED");
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Sample" ("id", "organizationId", "createdByUserId", "sampleCode", "updatedAt")
      VALUES ('sample-pg', 'org-pg', 'admin-pg', 'S-PG', now());
      INSERT INTO "Plate" ("id", "sampleId", "organizationId", "name", "updatedAt")
      VALUES ('plate-pg', 'sample-pg', 'org-pg', 'Plate PG', now());
      INSERT INTO "PlateDrug" ("id", "plateId", "rowIndex", "drugName", "unit", "concentrations")
      VALUES ('drug-pg', 'plate-pg', 0, 'AMP', 'µg/mL', '[1,2,4]'::jsonb);
      INSERT INTO "RawMic" (
        "id", "plateId", "plateDrugId", "modifier", "breakpointSetId", "status", "createdByUserId"
      ) VALUES ('raw-current-1', 'plate-pg', 'drug-pg', 'EQUAL', 'bps-pg', 'CURRENT', 'admin-pg');
    `);
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO "RawMic" (
        "id", "plateId", "plateDrugId", "modifier", "breakpointSetId", "status", "createdByUserId"
      ) VALUES ('raw-current-2', 'plate-pg', 'drug-pg', 'EQUAL', 'bps-pg', 'CURRENT', 'admin-pg')
    `)).rejects.toThrow(/RawMic_current_plate_drug_key/);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "SirInterpretation" (
        "id", "rawMicId", "plateId", "plateDrugId", "breakpointSetId", "category", "status"
      ) VALUES ('sir-current-1', 'raw-current-1', 'plate-pg', 'drug-pg', 'bps-pg', 'S', 'CURRENT');
    `);
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO "SirInterpretation" (
        "id", "rawMicId", "plateId", "plateDrugId", "breakpointSetId", "category", "status"
      ) VALUES ('sir-current-2', 'raw-current-1', 'plate-pg', 'drug-pg', 'bps-pg', 'R', 'CURRENT')
    `)).rejects.toThrow(/SirInterpretation_current_plate_drug_key/);
  });

  it("keeps RETIRED BreakpointSet immutable", async () => {
    await seedApprovedBreakpointSet("RETIRED");
    await expect(prisma.$executeRawUnsafe(`UPDATE "BreakpointSet" SET "status" = 'APPROVED' WHERE "id" = 'bps-pg'`))
      .rejects.toThrow(/AST_BREAKPOINT_RETIRED_FINAL/);
  });
});

describePostgres("PostgreSQL application role", () => {
  const appUrl = process.env.POSTGRES_APP_TEST_DATABASE_URL;
  const describeAppRole = appUrl ? describe : describe.skip;
  const safeAppUrl = appUrl ?? "postgresql://skip:skip@localhost:5432/skip";

  describeAppRole("least privilege", () => {
    const appPrisma = prismaFor(safeAppUrl);
    afterAll(async () => {
      await appPrisma.$disconnect();
    });

    it("cannot run DDL or disable triggers", async () => {
      await expect(appPrisma.$executeRawUnsafe('DROP TABLE "AuditLog"')).rejects.toThrow();
      await expect(appPrisma.$executeRawUnsafe('ALTER TABLE "BreakpointSet" DISABLE TRIGGER ALL')).rejects.toThrow();
    });
  });
});
