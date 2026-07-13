import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

type VerifyKey = JWTVerifyGetKey;

export class ResearchPublicAccessError extends Error {
  constructor(
    readonly code: "ACCESS_CONFIG_MISSING" | "ACCESS_JWT_MISSING" | "ACCESS_JWT_INVALID" | "ACCESS_HOST_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "ResearchPublicAccessError";
  }
}

export interface ResearchPublicAccessConfiguration {
  issuer: string;
  audience: string[];
  jwksUrl: string;
  allowedHosts: string[];
}

interface ResearchPublicAccessDependencies {
  env?: NodeJS.ProcessEnv;
  verifyToken?: (token: string, configuration: ResearchPublicAccessConfiguration) => Promise<JWTPayload>;
}

const accessJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end >= 0 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(":")[0] ?? "";
}

function normalizeTeamDomain(value: string): string {
  const raw = value.trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return new URL(raw).origin;
  return `https://${raw}`;
}

export function isResearchPublicProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RESEARCH_PUBLIC_MODE === "true" && env.NODE_ENV === "production";
}

export function researchPublicAccessConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): ResearchPublicAccessConfiguration | null {
  if (!isResearchPublicProduction(env)) return null;
  const teamDomain = env.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
  const audience = splitList(env.CLOUDFLARE_ACCESS_AUD);
  const allowedHosts = splitList(env.RESEARCH_PUBLIC_ALLOWED_HOSTS).map(normalizeHost).filter(Boolean);
  if (!teamDomain || audience.length === 0 || allowedHosts.length === 0) {
    throw new ResearchPublicAccessError("ACCESS_CONFIG_MISSING", "Research public access is not configured.");
  }

  const issuer = normalizeTeamDomain(teamDomain);
  const jwksUrl = env.CLOUDFLARE_ACCESS_JWKS_URL?.trim() || `${issuer}/cdn-cgi/access/certs`;
  try {
    new URL(issuer);
    new URL(jwksUrl);
  } catch {
    throw new ResearchPublicAccessError("ACCESS_CONFIG_MISSING", "Research public access configuration is invalid.");
  }
  return { issuer, audience, jwksUrl, allowedHosts };
}

function requestHosts(request: Request): string[] {
  const hosts = new Set<string>();
  hosts.add(normalizeHost(new URL(request.url).hostname));

  const hostHeader = request.headers.get("host");
  if (hostHeader) hosts.add(normalizeHost(hostHeader));

  return Array.from(hosts).filter(Boolean);
}

export function assertResearchPublicAllowedHost(
  request: Request,
  configuration: ResearchPublicAccessConfiguration,
): void {
  const hosts = requestHosts(request);
  if (hosts.length === 0 || hosts.some((host) => !configuration.allowedHosts.includes(host))) {
    throw new ResearchPublicAccessError("ACCESS_HOST_FORBIDDEN", "This host is not allowed for research public access.");
  }
}

function remoteJwks(jwksUrl: string) {
  let jwks = accessJwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    accessJwksCache.set(jwksUrl, jwks);
  }
  return jwks;
}

export async function verifyCloudflareAccessToken(
  token: string,
  configuration: ResearchPublicAccessConfiguration,
  key: VerifyKey = remoteJwks(configuration.jwksUrl),
): Promise<JWTPayload> {
  try {
    const verified = await jwtVerify(token, key, {
      issuer: configuration.issuer,
      audience: configuration.audience,
      algorithms: ["RS256", "ES256"],
    });
    return verified.payload;
  } catch {
    throw new ResearchPublicAccessError("ACCESS_JWT_INVALID", "Cloudflare Access token is invalid.");
  }
}

export async function requireResearchPublicAccess(
  request: Request,
  dependencies: ResearchPublicAccessDependencies = {},
): Promise<JWTPayload | null> {
  const env = dependencies.env ?? process.env;
  const configuration = researchPublicAccessConfiguration(env);
  if (!configuration) return null;

  assertResearchPublicAllowedHost(request, configuration);
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    throw new ResearchPublicAccessError("ACCESS_JWT_MISSING", "Cloudflare Access token is required.");
  }
  return (dependencies.verifyToken ?? verifyCloudflareAccessToken)(token, configuration);
}
