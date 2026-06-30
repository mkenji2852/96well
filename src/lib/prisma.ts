import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function resolveRuntimeDatabaseUrl(): string | undefined {
  const appUrl = process.env.POSTGRES_APP_DATABASE_URL;
  const legacyUrl = process.env.DATABASE_URL;
  const isNextProductionBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (process.env.NODE_ENV === "production") {
    if (isNextProductionBuild) {
      return undefined;
    }
    if (!appUrl) {
      throw new Error("POSTGRES_APP_DATABASE_URL is required in production.");
    }
    if (!/^postgres(ql)?:\/\//.test(appUrl)) {
      throw new Error("Production database URL must be PostgreSQL.");
    }
    if (legacyUrl?.startsWith("file:") || legacyUrl?.startsWith("sqlite:")) {
      throw new Error("Production must not use the SQLite DATABASE_URL.");
    }
    return appUrl;
  }
  if (appUrl) {
    if (!/^postgres(ql)?:\/\//.test(appUrl)) {
      throw new Error("POSTGRES_APP_DATABASE_URL must be PostgreSQL when set.");
    }
    return appUrl;
  }
  return undefined;
}

const runtimeDatabaseUrl = resolveRuntimeDatabaseUrl();

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  ...(runtimeDatabaseUrl ? { datasources: { db: { url: runtimeDatabaseUrl } } } : {}),
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
