import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

import { isResearchPublicProduction } from "@/lib/research-public-access";

export function resolveRuntimeDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const appUrl = env.POSTGRES_APP_DATABASE_URL;
  const migrationUrl = env.POSTGRES_PRISMA_DATABASE_URL;
  const legacyUrl = env.DATABASE_URL;
  const isNextProductionBuild = env.NEXT_PHASE === "phase-production-build";
  if (env.NODE_ENV === "production") {
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
    if (isResearchPublicProduction(env) && migrationUrl && appUrl === migrationUrl) {
      throw new Error("Research public runtime must not use the migration database credential.");
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
