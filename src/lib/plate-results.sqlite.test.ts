import { PrismaClient } from "@prisma/client";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { calculateBreakpointContentHash } from "./breakpoint-lifecycle";
import { recalculatePlateResults } from "./plate-results";

const require = createRequire(import.meta.url);
const clientDirectory = path.dirname(require.resolve(".prisma/client/default.js", {
  paths: [path.dirname(require.resolve("@prisma/client"))],
}));
const sqliteClient = /provider\s*=\s*"sqlite"/.test(readFileSync(path.join(clientDirectory, "schema.prisma"), "utf8"));

it.skipIf(!sqliteClient)("atomically appends 96 MIC/SIR results and rolls back a failed SIR batch", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "96well-results-"));
  const filename = path.join(directory, "test.db");
  const database = new DatabaseSync(filename);
  try {
    for (const entry of readdirSync("prisma/migrations", { withFileTypes: true }).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      database.exec(readFileSync(path.join("prisma/migrations", entry.name, "migration.sql"), "utf8"));
    }
  } finally { database.close(); }
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${filename.replaceAll("\\", "/")}` } } });
  try {
    const org = await prisma.organization.create({ data: { name: "Synthetic result test" } });
    const user = await prisma.user.create({ data: { organizationId: org.id, name: "Synthetic reviewer", email: "reviewer@example.test", role: "REVIEWER" } });
    const draft = await prisma.breakpointSet.create({
      data: { organizationId: org.id, standard: "CLSI", version: "synthetic-1", organism: "E. coli",
        rules: { create: { organizationId: org.id, drugName: "Drug X", organism: "E. coli", standard: "CLSI", version: "synthetic-1", susceptibleMax: 4, resistantMin: 16 } },
      }, include: { rules: true },
    });
    await prisma.breakpointSet.update({ where: { id: draft.id }, data: {
      status: "APPROVED", contentHash: calculateBreakpointContentHash(draft),
      contentHashAlgorithm: "sha256", contentHashVersion: 1, approvedAt: new Date(), approvedByUserId: user.id,
    } });
    const sample = await prisma.sample.create({ data: {
      organizationId: org.id, sampleCode: "SYNTHETIC-96", organism: "E. coli", plates: { create: {
        organizationId: org.id, name: "Synthetic 96", drugs: { createMany: { data: Array.from({ length: 96 }, (_, index) => ({
          rowIndex: index, drugName: "Drug X", concentrations: { mode: "wells", wells: [{ rowIndex: Math.floor(index / 12), columnIndex: index % 12, concentration: 8 }] },
        })) } },
        wells: { createMany: { data: Array.from({ length: 96 }, (_, index) => ({ rowIndex: Math.floor(index / 12), columnIndex: index % 12, state: "INHIBITED" as const, source: "MANUAL" as const })) } },
      } },
    }, include: { plates: true } });
    const plateId = sample.plates[0].id;
    const actor = { userId: user.id, organizationId: org.id, role: "REVIEWER" as const, sessionId: "synthetic-session" };
    const selection = { breakpointSetId: draft.id };
    for (let index = 0; index < 2; index++) {
      const results = await prisma.$transaction(tx => recalculatePlateResults(tx, plateId, actor, selection));
      expect(results).toHaveLength(96);
    }
    expect(await prisma.rawMic.count({ where: { plateId } })).toBe(192);
    expect(await prisma.rawMic.count({ where: { plateId, status: "CURRENT" } })).toBe(96);
    expect(await prisma.sirInterpretation.count({ where: { plateId, status: "CURRENT" } })).toBe(96);
    const current = await prisma.rawMic.findMany({ where: { plateId, status: "CURRENT" } });
    expect(current.every(item => item.supersedesId !== null)).toBe(true);
    const revision = (await prisma.plate.findUniqueOrThrow({ where: { id: plateId } })).resultRevision;
    const auditCount = await prisma.auditLog.count();
    await expect(prisma.$transaction(async tx => {
      const failed = new Proxy(tx, {
        get(target, key) {
          if (key === "sirInterpretation") return new Proxy(target.sirInterpretation, {
            get(delegate, method) {
              if (method === "createMany") return async () => { throw new Error("Synthetic SIR failure"); };
              return Reflect.get(delegate, method);
            },
          });
          return Reflect.get(target, key);
        },
      });
      return recalculatePlateResults(failed, plateId, actor, selection);
    })).rejects.toThrow("Synthetic SIR failure");
    expect(await prisma.rawMic.count({ where: { plateId } })).toBe(192);
    expect((await prisma.rawMic.findMany({ where: { plateId, status: "CURRENT" } })).map(item => item.id).sort()).toEqual(current.map(item => item.id).sort());
    expect(await prisma.sirInterpretation.count({ where: { plateId, status: "CURRENT" } })).toBe(96);
    expect((await prisma.plate.findUniqueOrThrow({ where: { id: plateId } })).resultRevision).toBe(revision);
    expect(await prisma.auditLog.count()).toBe(auditCount);
  } finally {
    await prisma.$disconnect();
    rmSync(directory, { recursive: true });
  }
}, 20000);
