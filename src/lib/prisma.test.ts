import { describe, expect, it } from "vitest";
import { resolveRuntimeDatabaseUrl } from "./prisma";

describe("resolveRuntimeDatabaseUrl", () => {
  it("keeps local SQLite available outside production", () => {
    expect(resolveRuntimeDatabaseUrl({
      NODE_ENV: "development",
      DATABASE_URL: "file:./dev.db",
    } as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("rejects missing PostgreSQL app URL in research-public production", () => {
    expect(() => resolveRuntimeDatabaseUrl({
      NODE_ENV: "production",
      RESEARCH_PUBLIC_MODE: "true",
    } as NodeJS.ProcessEnv)).toThrow("POSTGRES_APP_DATABASE_URL is required in production.");
  });

  it("rejects SQLite DATABASE_URL in research-public production", () => {
    expect(() => resolveRuntimeDatabaseUrl({
      NODE_ENV: "production",
      RESEARCH_PUBLIC_MODE: "true",
      DATABASE_URL: "file:./research-public.db",
      POSTGRES_APP_DATABASE_URL: "postgresql://app:password@example.test:5432/db",
    } as NodeJS.ProcessEnv)).toThrow("Production must not use the SQLite DATABASE_URL.");
  });

  it("allows PostgreSQL app URL in research-public production", () => {
    expect(resolveRuntimeDatabaseUrl({
      NODE_ENV: "production",
      RESEARCH_PUBLIC_MODE: "true",
      POSTGRES_APP_DATABASE_URL: "postgresql://app:password@example.test:5432/db",
    } as NodeJS.ProcessEnv)).toBe("postgresql://app:password@example.test:5432/db");
  });

  it("does not fall back to the migration credential at runtime", () => {
    expect(() => resolveRuntimeDatabaseUrl({
      NODE_ENV: "production",
      RESEARCH_PUBLIC_MODE: "true",
      POSTGRES_PRISMA_DATABASE_URL: "postgresql://migration:password@example.test:5432/db",
    } as NodeJS.ProcessEnv)).toThrow("POSTGRES_APP_DATABASE_URL is required in production.");
  });

  it("rejects using the migration credential as the research-public app URL", () => {
    const url = "postgresql://migration:password@example.test:5432/db";
    expect(() => resolveRuntimeDatabaseUrl({
      NODE_ENV: "production",
      RESEARCH_PUBLIC_MODE: "true",
      POSTGRES_APP_DATABASE_URL: url,
      POSTGRES_PRISMA_DATABASE_URL: url,
    } as NodeJS.ProcessEnv)).toThrow("Research public runtime must not use the migration database credential.");
  });
});
