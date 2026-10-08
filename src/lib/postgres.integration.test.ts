import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { calculateBreakpointContentHash } from "./breakpoint-lifecycle";
import { recalculatePlateResults } from "./plate-results";

const postgresUrl =
  process.env.POSTGRES_TEST_DATABASE_URL ?? process.env.POSTGRES_PRISMA_DATABASE_URL;

const describePostgres = postgresUrl ? describe : describe.skip;
const safePostgresUrl = postgresUrl ?? "postgresql://skip:skip@localhost:5432/skip";

function prismaFor(url: string) {
  return new PrismaClient({
    datasources: {
      db: {
        url,
      },
    },
  });
}

describePostgres("PostgreSQL production hardening", () => {
  const prisma = prismaFor(safePostgresUrl);

  beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "SirInterpretation",
      "RawMic",
      "PlateWell",
      "PlateDrug",
      "BreakpointRule",
      "BreakpointSet",
      "Plate",
      "Sample",
      "User",
      "Organization"
    RESTART IDENTITY CASCADE
  `);
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
    await executeStatements([
      `INSERT INTO "Organization" ("id", "name")
       VALUES ('org-pg', 'PG Org')`,

      `INSERT INTO "User" ("id", "organizationId", "name", "email", "role")
       VALUES ('admin-pg', 'org-pg', 'Admin', 'admin-pg@example.test', 'ADMIN')`,

      `INSERT INTO "BreakpointSet" (
         "id",
         "organizationId",
         "standard",
         "version",
         "organism",
         "status",
         "approvedAt",
         "approvedByUserId",
         "retiredAt",
         "retiredByUserId",
         "retireReason",
         "contentHash",
         "contentHashAlgorithm",
         "contentHashVersion",
         "createdByUserId",
         "updatedAt"
       )
       VALUES (
         'bps-pg',
         'org-pg',
         'CLSI',
         '2026.1',
         'E. coli',
         '${status}',
         now(),
         'admin-pg',
         ${status === "RETIRED" ? "now(), 'admin-pg', 'superseded'" : "NULL, NULL, NULL"},
         'hash-pg',
         'sha256',
         1,
         'admin-pg',
         now()
       )`,
    ]);
  }

  it("rejects direct updates and deletes for APPROVED BreakpointSet and rules", async () => {
    await seedApprovedBreakpointSet("APPROVED");

    await expect(
      prisma.$executeRawUnsafe(`UPDATE "BreakpointSet" SET "version" = 'tampered' WHERE "id" = 'bps-pg'`),
    ).rejects.toThrow(/AST_BREAKPOINT_IMMUTABLE_SET_CONTENT/);

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "BreakpointSet" WHERE "id" = 'bps-pg'`),
    ).rejects.toThrow(/AST_BREAKPOINT_IMMUTABLE_SET_DELETE/);

    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "BreakpointRule" (
          "id",
          "organizationId",
          "breakpointSetId",
          "drugName",
          "standard",
          "version",
          "susceptibleMax",
          "resistantMin",
          "unit",
          "method",
          "updatedAt"
        )
        VALUES ('rule-pg', 'org-pg', 'bps-pg', 'AMP', 'CLSI', '2026.1', 1, 4, 'µg/mL', 'BROTH_MICRODILUTION', now())
      `),
    ).rejects.toThrow(/AST_BREAKPOINT_IMMUTABLE_RULE/);
  });

  it("allows DRAFT edits and clone-like independent DRAFT rules", async () => {
    await executeStatements([
      `INSERT INTO "Organization" ("id", "name")
       VALUES ('org-pg', 'PG Org')`,

      `INSERT INTO "User" ("id", "organizationId", "name", "email", "role")
       VALUES ('admin-pg', 'org-pg', 'Admin', 'admin-pg@example.test', 'ADMIN')`,

      `INSERT INTO "BreakpointSet" (
         "id",
         "organizationId",
         "standard",
         "version",
         "organism",
         "status",
         "createdByUserId",
         "updatedAt"
       )
       VALUES ('bps-draft', 'org-pg', 'CLSI', '2026.2', 'E. coli', 'DRAFT', 'admin-pg', now())`,
    ]);

    await expect(
      prisma.$executeRawUnsafe(`UPDATE "BreakpointSet" SET "version" = '2026.3' WHERE "id" = 'bps-draft'`),
    ).resolves.toBeGreaterThanOrEqual(0);

    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "BreakpointRule" (
          "id",
          "organizationId",
          "breakpointSetId",
          "drugName",
          "standard",
          "version",
          "susceptibleMax",
          "resistantMin",
          "unit",
          "method",
          "updatedAt"
        )
        VALUES ('rule-draft', 'org-pg', 'bps-draft', 'AMP', 'CLSI', '2026.3', 1, 4, 'µg/mL', 'BROTH_MICRODILUTION', now())
      `),
    ).resolves.toBeGreaterThanOrEqual(0);
  });

  it("enforces CURRENT uniqueness for RawMic and SirInterpretation", async () => {
    await seedApprovedBreakpointSet("APPROVED");

    await executeStatements([
      `INSERT INTO "Sample" ("id", "organizationId", "createdByUserId", "sampleCode", "updatedAt")
       VALUES ('sample-pg', 'org-pg', 'admin-pg', 'S-PG', now())`,

      `INSERT INTO "Plate" ("id", "sampleId", "organizationId", "name", "updatedAt")
       VALUES ('plate-pg', 'sample-pg', 'org-pg', 'Plate PG', now())`,

      `INSERT INTO "PlateDrug" ("id", "plateId", "rowIndex", "drugName", "unit", "concentrations")
       VALUES ('drug-pg', 'plate-pg', 0, 'AMP', 'µg/mL', '[1,2,4]'::jsonb)`,

      `INSERT INTO "RawMic" (
         "id",
         "plateId",
         "plateDrugId",
         "modifier",
         "breakpointSetId",
         "status",
         "createdByUserId"
       )
       VALUES ('raw-current-1', 'plate-pg', 'drug-pg', 'EQUAL', 'bps-pg', 'CURRENT', 'admin-pg')`,
    ]);

    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "RawMic" (
          "id",
          "plateId",
          "plateDrugId",
          "modifier",
          "breakpointSetId",
          "status",
          "createdByUserId"
        )
        VALUES ('raw-current-2', 'plate-pg', 'drug-pg', 'EQUAL', 'bps-pg', 'CURRENT', 'admin-pg')
      `),
    ).rejects.toThrow(/plateId.*plateDrugId|already exists/);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "SirInterpretation" (
        "id",
        "rawMicId",
        "plateId",
        "plateDrugId",
        "breakpointSetId",
        "category",
        "status"
      )
      VALUES ('sir-current-1', 'raw-current-1', 'plate-pg', 'drug-pg', 'bps-pg', 'S', 'CURRENT')
    `);

    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "SirInterpretation" (
          "id",
          "rawMicId",
          "plateId",
          "plateDrugId",
          "breakpointSetId",
          "category",
          "status"
        )
        VALUES ('sir-current-2', 'raw-current-1', 'plate-pg', 'drug-pg', 'bps-pg', 'R', 'CURRENT')
      `),
    ).rejects.toThrow(/plateId.*plateDrugId|already exists/);
  });

  it("keeps RETIRED BreakpointSet immutable", async () => {
    await seedApprovedBreakpointSet("RETIRED");

    await expect(
      prisma.$executeRawUnsafe(`UPDATE "BreakpointSet" SET "status" = 'APPROVED' WHERE "id" = 'bps-pg'`),
    ).rejects.toThrow(/AST_BREAKPOINT_RETIRED_FINAL/);
  });

  it("bulk-appends 96 MIC/SIR results using the runtime role and keeps prior results", async () => {
    const org = await prisma.organization.create({ data: { name: "Synthetic calculation test" } });
    const user = await prisma.user.create({ data: { organizationId: org.id, name: "Synthetic reviewer", email: "bulk@example.test", role: "REVIEWER" } });
    const draft = await prisma.breakpointSet.create({ data: {
      organizationId: org.id, standard: "CLSI", version: "synthetic-bulk-1", organism: "E. coli",
      rules: { create: { organizationId: org.id, drugName: "Drug X", organism: "E. coli", standard: "CLSI", version: "synthetic-bulk-1", susceptibleMax: 4, resistantMin: 16 } },
    }, include: { rules: true } });
    await prisma.breakpointSet.update({ where: { id: draft.id }, data: {
      status: "APPROVED", contentHash: calculateBreakpointContentHash(draft), contentHashAlgorithm: "sha256", contentHashVersion: 1,
      approvedAt: new Date(), approvedByUserId: user.id,
    } });
    const sample = await prisma.sample.create({ data: {
      organizationId: org.id, sampleCode: "SYNTHETIC-BULK-96", organism: "E. coli", plates: { create: {
        organizationId: org.id, name: "Synthetic plate",
        drugs: { createMany: { data: Array.from({ length: 96 }, (_, index) => ({
          rowIndex: index, drugName: "Drug X", concentrations: { mode: "wells", wells: [{ rowIndex: Math.floor(index / 12), columnIndex: index % 12, concentration: 8 }] },
        })) } },
        wells: { createMany: { data: Array.from({ length: 96 }, (_, index) => ({ rowIndex: Math.floor(index / 12), columnIndex: index % 12, state: "INHIBITED" as const, source: "MANUAL" as const })) } },
      } },
    }, include: { plates: true } });
    const runtime = process.env.POSTGRES_APP_TEST_DATABASE_URL ? prismaFor(process.env.POSTGRES_APP_TEST_DATABASE_URL) : prisma;
    try {
      const actor = { userId: user.id, organizationId: org.id, role: "REVIEWER" as const, sessionId: "synthetic-bulk" };
      for (let index = 0; index < 2; index++) {
        const results = await runtime.$transaction(tx => recalculatePlateResults(tx, sample.plates[0].id, actor, { breakpointSetId: draft.id }), { maxWait: 5000, timeout: 20000 });
        expect(results).toHaveLength(96);
      }
      const plateId = sample.plates[0].id;
      expect(await runtime.rawMic.count({ where: { plateId } })).toBe(192);
      expect(await runtime.rawMic.count({ where: { plateId, status: "CURRENT" } })).toBe(96);
      expect(await runtime.sirInterpretation.count({ where: { plateId } })).toBe(192);
      expect(await runtime.sirInterpretation.count({ where: { plateId, status: "CURRENT" } })).toBe(96);
    } finally { if (runtime !== prisma) await runtime.$disconnect(); }
  });

  it("accepts 96 flexible drug slots and still rejects invalid well coordinates", async () => {
    const org = await prisma.organization.create({ data: { name: "Synthetic layout test" } });
    const sample = await prisma.sample.create({
      data: { organizationId: org.id, sampleCode: "SYNTHETIC-96", plates: { create: {
        organizationId: org.id, name: "Flexible layout",
        drugs: { createMany: { data: Array.from({ length: 96 }, (_, index) => ({
          rowIndex: index, drugName: `Synthetic drug ${index}`, unit: "mg/L",
          concentrations: { mode: "wells", wells: [{ rowIndex: Math.floor(index / 12), columnIndex: index % 12, concentration: 1 }] },
        })) } },
      } } },
      include: { plates: { include: { drugs: true } } },
    });
    const plate = sample.plates[0];
    expect(plate.drugs).toHaveLength(96);
    await expect(prisma.plateDrug.create({ data: {
      plateId: plate.id, rowIndex: 96, drugName: "Out of range", concentrations: [],
    } })).rejects.toThrow();
    await expect(prisma.plateWell.create({ data: {
      plateId: plate.id, rowIndex: 8, columnIndex: 0,
    } })).rejects.toThrow();
    await expect(prisma.plateWell.create({ data: {
      plateId: plate.id, rowIndex: 0, columnIndex: 12,
    } })).rejects.toThrow();
    expect(await prisma.plateDrug.count({ where: { plateId: plate.id } })).toBe(96);
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
