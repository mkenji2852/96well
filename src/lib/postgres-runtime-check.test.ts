import { describe, expect, it } from "vitest";
import { parseSafePostgresUrlShape, resolveRuntimeCheckConfig } from "../../scripts/postgres-runtime-check";

describe("postgres runtime connection check configuration", () => {
  it("prints only a secret-safe PostgreSQL URL shape", () => {
    const shape = parseSafePostgresUrlShape(
      "postgresql://micplate_app:p%40ss%2Fword@ep-example-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    );

    expect(shape).toEqual({
      scheme: "postgresql",
      username: "micplate_app",
      host: "ep-example-pooler.us-east-1.aws.neon.tech",
      port: "",
      database: "neondb",
      hasPassword: true,
      queryKeys: ["channel_binding", "sslmode"],
      hasSslMode: true,
      likelyNeonHost: true,
      likelyPooledHost: true,
    });
  });

  it("requires POSTGRES_APP_DATABASE_URL", () => {
    expect(() => resolveRuntimeCheckConfig({} as NodeJS.ProcessEnv)).toThrow(
      "POSTGRES_APP_DATABASE_URL is required for the runtime connection check.",
    );
  });

  it("rejects SQLite URLs", () => {
    expect(() => resolveRuntimeCheckConfig({
      POSTGRES_APP_DATABASE_URL: "file:./dev.db",
    } as unknown as NodeJS.ProcessEnv)).toThrow("POSTGRES_APP_DATABASE_URL must use postgresql:// or postgres://.");
  });

  it("does not allow migration credential reuse for runtime", () => {
    const url = "postgresql://micplate_migration:secret@example.test:5432/neondb?sslmode=require";
    expect(() => resolveRuntimeCheckConfig({
      POSTGRES_APP_DATABASE_URL: url,
      POSTGRES_PRISMA_DATABASE_URL: url,
    } as unknown as NodeJS.ProcessEnv)).toThrow("POSTGRES_APP_DATABASE_URL must not be the migration database credential.");
  });

  it("warns when Neon query parameters look dropped", () => {
    const config = resolveRuntimeCheckConfig({
      POSTGRES_APP_DATABASE_URL: "postgresql://micplate_app:secret@ep-example.us-east-1.aws.neon.tech/neondb",
    } as unknown as NodeJS.ProcessEnv);

    expect(config.warnings).toContain("Neon URL has no sslmode query parameter; verify query parameters were not dropped.");
  });
});
