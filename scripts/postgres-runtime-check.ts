import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

export interface SafeUrlShape {
  scheme: string;
  username: string;
  host: string;
  port: string;
  database: string;
  hasPassword: boolean;
  queryKeys: string[];
  hasSslMode: boolean;
  likelyNeonHost: boolean;
  likelyPooledHost: boolean;
}

export interface RuntimeCheckConfig {
  appUrl: string;
  migrationUrl?: string;
  shape: SafeUrlShape;
  warnings: string[];
}

export function parseSafePostgresUrlShape(rawUrl: string): SafeUrlShape {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("POSTGRES_APP_DATABASE_URL must use postgresql:// or postgres://.");
  }

  const queryKeys = Array.from(new Set(Array.from(parsed.searchParams.keys()))).sort();
  const host = parsed.hostname.toLowerCase();
  return {
    scheme: parsed.protocol.replace(":", ""),
    username: decodeURIComponent(parsed.username),
    host: parsed.hostname,
    port: parsed.port,
    database: parsed.pathname.replace(/^\//, ""),
    hasPassword: parsed.password.length > 0,
    queryKeys,
    hasSslMode: parsed.searchParams.has("sslmode"),
    likelyNeonHost: host.includes("neon.tech"),
    likelyPooledHost: host.includes("pooler"),
  };
}

export function resolveRuntimeCheckConfig(env: NodeJS.ProcessEnv = process.env): RuntimeCheckConfig {
  const appUrl = env.POSTGRES_APP_DATABASE_URL;
  if (!appUrl) {
    throw new Error("POSTGRES_APP_DATABASE_URL is required for the runtime connection check.");
  }

  const shape = parseSafePostgresUrlShape(appUrl);
  const migrationUrl = env.POSTGRES_PRISMA_DATABASE_URL;
  if (migrationUrl && migrationUrl === appUrl) {
    throw new Error("POSTGRES_APP_DATABASE_URL must not be the migration database credential.");
  }

  const warnings: string[] = [];
  if (!shape.hasPassword) {
    warnings.push("URL has no password component.");
  }
  if (shape.likelyNeonHost && !shape.hasSslMode) {
    warnings.push("Neon URL has no sslmode query parameter; verify query parameters were not dropped.");
  }
  if (/owner|admin|postgres|migration/i.test(shape.username)) {
    warnings.push("Runtime username looks like an owner/admin/migration role; verify it is the least-privilege app role.");
  }

  return { appUrl, migrationUrl, shape, warnings };
}

function redactDatabaseUrls(message: string): string {
  return message.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[REDACTED_DATABASE_URL]");
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    const maybeCodedError = error as Error & { code?: unknown };
    return {
      name: error.name,
      message: redactDatabaseUrls(error.message),
      code: typeof maybeCodedError.code === "string" ? maybeCodedError.code : undefined,
    };
  }
  return { name: "UnknownError", message: "Unknown runtime connection check failure." };
}

export async function runRuntimeConnectionCheck(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let config: RuntimeCheckConfig;
  try {
    config = resolveRuntimeCheckConfig(env);
  } catch (error) {
    console.error(JSON.stringify({
      status: "CONFIG_ERROR",
      error: serializeError(error),
    }, null, 2));
    return 2;
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: config.appUrl,
      },
    },
  });

  try {
    const identity = await prisma.$queryRaw<Array<{
      current_user: string;
      current_database: string;
      current_schema: string;
    }>>`
      SELECT current_user, current_database(), current_schema()
    `;
    const users = await prisma.$queryRaw<Array<{ user_count: number }>>`
      SELECT COUNT(*)::int AS user_count FROM "User"
    `;

    console.log(JSON.stringify({
      status: "OK",
      urlShape: config.shape,
      warnings: config.warnings,
      database: {
        currentUser: identity[0]?.current_user,
        currentDatabase: identity[0]?.current_database,
        currentSchema: identity[0]?.current_schema,
        userCount: users[0]?.user_count ?? 0,
      },
      checks: {
        usedPostgresAppDatabaseUrlOnly: true,
        runtimeUserMatchesUrlUser: identity[0]?.current_user === config.shape.username,
      },
    }, null, 2));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({
      status: "CONNECTION_ERROR",
      urlShape: config.shape,
      warnings: config.warnings,
      error: serializeError(error),
    }, null, 2));
    return 3;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRuntimeConnectionCheck().then((code) => {
    process.exitCode = code;
  });
}
