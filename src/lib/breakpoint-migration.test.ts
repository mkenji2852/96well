import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsRoot = path.join(root, "prisma", "migrations");
const temporaryFiles: string[] = [];

function migrationFiles() {
  return fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, file: path.join(migrationsRoot, entry.name, "migration.sql") }))
    .filter((entry) => fs.existsSync(entry.file))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function database() {
  const file = path.join(os.tmpdir(), `breakpoint-migration-${randomUUID()}.db`);
  temporaryFiles.push(file);
  return new DatabaseSync(file);
}

afterEach(() => {
  while (temporaryFiles.length) {
    const file = temporaryFiles.pop();
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  }
});

describe("0007 breakpoint lifecycle migration", () => {
  it("applies all migrations to a clean SQLite database", () => {
    const db = database();
    try {
      for (const migration of migrationFiles()) db.exec(fs.readFileSync(migration.file, "utf8"));
      const columns = db.prepare("PRAGMA table_info('BreakpointSet')").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "status", "approvedAt", "approvedByUserId", "retiredAt", "retireReason",
        "supersedesBreakpointSetId", "contentHash", "createdByUserId", "revision",
      ]));
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("migrates legacy-approved data conservatively to DRAFT and enforces DB immutability", () => {
    const db = database();
    try {
      const migrations = migrationFiles();
      for (const migration of migrations.filter((entry) => entry.name < "0007")) {
        db.exec(fs.readFileSync(migration.file, "utf8"));
      }
      db.exec(`
        INSERT INTO "Organization" ("id", "name", "active") VALUES ('org-a', 'Org A', 1);
        INSERT INTO "User" ("id", "organizationId", "name", "email", "role", "active")
        VALUES ('admin-1', 'org-a', 'Admin', 'admin@example.test', 'ADMIN', 1);
        INSERT INTO "BreakpointSet" ("id", "organizationId", "standard", "version", "organism", "approved", "active")
        VALUES ('bps-legacy', 'org-a', 'CLSI', '2025.1', 'E. coli', 1, 1);
        INSERT INTO "BreakpointRule" (
          "id", "organizationId", "breakpointSetId", "drugName", "organism", "standard", "version",
          "susceptibleMax", "resistantMin", "unit", "active"
        ) VALUES (
          'rule-legacy', 'org-a', 'bps-legacy', 'Drug X', 'E. coli', 'CLSI', '2025.1',
          1, 4, 'mg/L', 1
        );
      `);
      const lifecycleMigration = migrations.find((entry) => entry.name === "0007_breakpoint_set_lifecycle");
      expect(lifecycleMigration).toBeDefined();
      db.exec(fs.readFileSync(lifecycleMigration!.file, "utf8"));

      const migrated = db.prepare('SELECT "status", "contentHash" FROM "BreakpointSet" WHERE "id" = ?').get("bps-legacy") as {
        status: string;
        contentHash: string | null;
      };
      expect(migrated).toEqual({ status: "DRAFT", contentHash: null });

      db.exec(`UPDATE "BreakpointSet" SET "status" = 'APPROVED', "contentHash" = 'fixed-hash' WHERE "id" = 'bps-legacy'`);
      expect(() => db.exec(`UPDATE "BreakpointRule" SET "susceptibleMax" = 2 WHERE "id" = 'rule-legacy'`))
        .toThrow(/draft breakpoint sets/);
      expect(() => db.exec(`UPDATE "BreakpointSet" SET "version" = 'tampered' WHERE "id" = 'bps-legacy'`))
        .toThrow(/immutable breakpoint set/);
      db.exec(`UPDATE "BreakpointSet" SET "status" = 'RETIRED', "retireReason" = 'replaced' WHERE "id" = 'bps-legacy'`);
      expect(() => db.exec(`UPDATE "BreakpointSet" SET "status" = 'DRAFT' WHERE "id" = 'bps-legacy'`))
        .toThrow(/invalid breakpoint set transition/);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
