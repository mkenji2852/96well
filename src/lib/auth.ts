import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { AuthError } from "@/lib/api-auth-error";
import { prisma } from "@/lib/prisma";
import {
  isResearchPublicProduction,
  requireResearchPublicAccess,
  ResearchPublicAccessError,
} from "@/lib/research-public-access";
import type { UserRole } from "@/types/domain";

export interface AuthenticatedActor {
  userId: string;
  organizationId: string;
  role: UserRole;
  sessionId: string;
}

interface AuthenticatedUserRecord {
  id: string;
  organizationId: string;
  role: UserRole;
  active: boolean;
  organization: { active: boolean };
}

interface VerifiedToken {
  payload: JWTPayload;
}

interface AuthDependencies {
  env?: NodeJS.ProcessEnv;
  verifyToken?: (token: string, configuration: OidcConfiguration) => Promise<VerifiedToken>;
  requireResearchPublicAccess?: (request: Request) => Promise<JWTPayload | null | void>;
  findUserBySubject?: (subject: string) => Promise<AuthenticatedUserRecord | null>;
  findUserById?: (userId: string) => Promise<AuthenticatedUserRecord | null>;
}

interface OidcConfiguration {
  issuer: string;
  audience: string;
  jwksUrl: string;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function unauthenticated(message = "認証が必要です。"): never {
  throw new AuthError("UNAUTHENTICATED", message);
}

function oidcConfiguration(env: NodeJS.ProcessEnv): OidcConfiguration | null {
  const issuer = env.OIDC_ISSUER?.trim();
  const audience = env.OIDC_AUDIENCE?.trim();
  const jwksUrl = env.OIDC_JWKS_URL?.trim();
  if (!issuer || !audience || !jwksUrl) return null;
  try {
    new URL(issuer);
    new URL(jwksUrl);
  } catch {
    unauthenticated("認証設定が無効です。");
  }
  return { issuer, audience, jwksUrl };
}

async function verifyOidcToken(token: string, configuration: OidcConfiguration): Promise<VerifiedToken> {
  let jwks = jwksCache.get(configuration.jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(configuration.jwksUrl));
    jwksCache.set(configuration.jwksUrl, jwks);
  }
  return jwtVerify(token, jwks, {
    issuer: configuration.issuer,
    audience: configuration.audience,
    algorithms: ["RS256", "ES256"],
  });
}

async function findUserBySubject(subject: string): Promise<AuthenticatedUserRecord | null> {
  return prisma.user.findUnique({
    where: { externalSubject: subject },
    select: {
      id: true,
      organizationId: true,
      role: true,
      active: true,
      organization: { select: { active: true } },
    },
  });
}

async function findUserById(userId: string): Promise<AuthenticatedUserRecord | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      organizationId: true,
      role: true,
      active: true,
      organization: { select: { active: true } },
    },
  });
}

function actorFromUser(user: AuthenticatedUserRecord | null, sessionId: string): AuthenticatedActor {
  if (!user || !user.active || !user.organization.active) unauthenticated();
  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    sessionId,
  };
}

function sessionIdFromAccessPayload(payload: JWTPayload, subject: string): string {
  if (typeof payload.sid === "string") return payload.sid;
  if (typeof payload.jti === "string") return payload.jti;
  return `cloudflare-access:${subject}`;
}

export async function requireAuthenticatedUser(
  request: Request,
  dependencies: AuthDependencies = {},
): Promise<AuthenticatedActor> {
  const env = dependencies.env ?? process.env;
  let accessPayload: JWTPayload | null | void = null;
  try {
    accessPayload = await (dependencies.requireResearchPublicAccess ?? ((currentRequest: Request) =>
      requireResearchPublicAccess(currentRequest, { env })))(request);
  } catch (error) {
    if (error instanceof ResearchPublicAccessError) unauthenticated();
    throw error;
  }

  const configuration = oidcConfiguration(env);
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match || !configuration) unauthenticated("認証サービスが構成されていません。");
    try {
      const verified = await (dependencies.verifyToken ?? verifyOidcToken)(match[1], configuration);
      const subject = verified.payload.sub;
      const sessionId = typeof verified.payload.sid === "string"
        ? verified.payload.sid
        : typeof verified.payload.jti === "string" ? verified.payload.jti : null;
      if (!subject || !sessionId) unauthenticated();
      const user = await (dependencies.findUserBySubject ?? findUserBySubject)(subject);
      return actorFromUser(user, sessionId);
    } catch (error) {
      if (error instanceof AuthError) throw error;
      unauthenticated();
    }
  }

  if (isResearchPublicProduction(env) && accessPayload) {
    const subject = accessPayload.sub;
    if (!subject) unauthenticated();
    const user = await (dependencies.findUserBySubject ?? findUserBySubject)(subject);
    return actorFromUser(user, sessionIdFromAccessPayload(accessPayload, subject));
  }

  if (env.NODE_ENV === "production" && !configuration) {
    unauthenticated("認証サービスが構成されていません。");
  }

  const devEnabled = env.DEV_AUTH_ENABLED === "true";
  if (devEnabled) {
    if (env.NODE_ENV !== "development") unauthenticated("開発用認証は利用できません。");
    const userId = env.DEV_AUTH_USER_ID?.trim();
    if (!userId) unauthenticated("開発用認証が構成されていません。");
    const user = await (dependencies.findUserById ?? findUserById)(userId);
    return actorFromUser(user, `development:${userId}`);
  }

  unauthenticated();
}
