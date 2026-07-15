import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertPostgresSchemaProvider } from "../../scripts/postgres-utils";

describe("PostgreSQL release safety files", () => {
  it("uses a dedicated PostgreSQL Prisma schema and migration lock", () => {
    expect(() => assertPostgresSchemaProvider()).not.toThrow();
    expect(readFileSync("prisma/postgresql/migrations/migration_lock.toml", "utf8")).toContain('provider = "postgresql"');
  });

  it("keeps SQLite migrations locked to SQLite", () => {
    expect(readFileSync("prisma/migrations/migration_lock.toml", "utf8")).toContain('provider = "sqlite"');
  });

  it("manages PostgreSQL-only hardening in migrations", () => {
    const hardening = readFileSync("prisma/postgresql/migrations/0002_production_hardening/migration.sql", "utf8");
    expect(hardening).toContain('CREATE UNIQUE INDEX "RawMic_current_plate_drug_key"');
    expect(hardening).toContain('CREATE UNIQUE INDEX "SirInterpretation_current_plate_drug_key"');
    expect(hardening).toContain("AST_BREAKPOINT_IMMUTABLE_RULE");
    expect(hardening).toContain("contentHashAlgorithm");
    expect(hardening).toContain("contentHashVersion");
  });

  it("documents least-privilege application role restrictions", () => {
    const rolesSql = readFileSync("prisma/postgresql/hardening/roles.sql", "utf8");
    expect(rolesSql).toContain("REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER");
    expect(rolesSql).toContain('GRANT DELETE ON');
    expect(rolesSql).toContain('"Sample", "Plate", "PlateDrug", "PlateWell"');
    expect(rolesSql).toContain('"IdempotencyRecord", "BreakpointRule"');
    expect(rolesSql).not.toContain("PASSWORD '");
  });
});
