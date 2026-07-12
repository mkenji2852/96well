import { describe, expect, it } from "vitest";
import { requireAuthenticatedUser } from "./auth";

const testEnv = { NODE_ENV: "test" } as NodeJS.ProcessEnv;

describe("requireAuthenticatedUser", () => {
  it("rejects a request without a session", async () => {
    await expect(requireAuthenticatedUser(new Request("http://localhost/api/samples"), { env: testEnv }))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("does not grant permissions from x-user headers", async () => {
    const request = new Request("http://localhost/api/samples", {
      headers: {
        "x-user-role": "ADMIN",
        "x-user-id": "attacker",
        "x-organization-id": "org-other",
      },
    });
    await expect(requireAuthenticatedUser(request, { env: testEnv }))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("uses the database role and organization rather than token claims", async () => {
    const request = new Request("http://localhost/api/samples", {
      headers: { authorization: "Bearer signed-token" },
    });
    const actor = await requireAuthenticatedUser(request, {
      env: {
        NODE_ENV: "test",
        OIDC_ISSUER: "https://issuer.example",
        OIDC_AUDIENCE: "mic-api",
        OIDC_JWKS_URL: "https://issuer.example/jwks",
      },
      verifyToken: async () => ({ payload: { sub: "subject-1", sid: "session-1", role: "ADMIN", organizationId: "attacker-org" } }),
      findUserBySubject: async () => ({
        id: "user-1",
        organizationId: "org-a",
        role: "TECHNICIAN",
        active: true,
        organization: { active: true },
      }),
    });
    expect(actor).toEqual({ userId: "user-1", organizationId: "org-a", role: "TECHNICIAN", sessionId: "session-1" });
  });

  it("checks the research-public perimeter before API authentication", async () => {
    const request = new Request("https://research.example.test/api/samples", {
      headers: { authorization: "Bearer signed-token" },
    });
    await expect(requireAuthenticatedUser(request, {
      env: {
        NODE_ENV: "production",
        RESEARCH_PUBLIC_MODE: "true",
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: "research-team.cloudflareaccess.com",
        CLOUDFLARE_ACCESS_AUD: "access-aud",
        RESEARCH_PUBLIC_ALLOWED_HOSTS: "research.example.test",
        OIDC_ISSUER: "https://issuer.example",
        OIDC_AUDIENCE: "mic-api",
        OIDC_JWKS_URL: "https://issuer.example/jwks",
      },
      verifyToken: async () => ({ payload: { sub: "subject-1", sid: "session-1" } }),
      findUserBySubject: async () => ({
        id: "user-1",
        organizationId: "org-a",
        role: "TECHNICIAN",
        active: true,
        organization: { active: true },
      }),
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("keeps existing OIDC/RBAC resolution after the research-public perimeter passes", async () => {
    const request = new Request("https://research.example.test/api/samples", {
      headers: { authorization: "Bearer signed-token" },
    });
    const actor = await requireAuthenticatedUser(request, {
      env: {
        NODE_ENV: "production",
        RESEARCH_PUBLIC_MODE: "true",
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: "research-team.cloudflareaccess.com",
        CLOUDFLARE_ACCESS_AUD: "access-aud",
        RESEARCH_PUBLIC_ALLOWED_HOSTS: "research.example.test",
        OIDC_ISSUER: "https://issuer.example",
        OIDC_AUDIENCE: "mic-api",
        OIDC_JWKS_URL: "https://issuer.example/jwks",
      },
      requireResearchPublicAccess: async () => undefined,
      verifyToken: async () => ({ payload: { sub: "subject-1", sid: "session-1" } }),
      findUserBySubject: async () => ({
        id: "user-1",
        organizationId: "org-a",
        role: "TECHNICIAN",
        active: true,
        organization: { active: true },
      }),
    });
    expect(actor).toEqual({ userId: "user-1", organizationId: "org-a", role: "TECHNICIAN", sessionId: "session-1" });
  });

  it("maps a verified Cloudflare Access subject to the database user without an OIDC bearer token", async () => {
    const request = new Request("https://research.example.test/api/me", {
      headers: { "cf-access-jwt-assertion": "verified-access-token" },
    });
    const actor = await requireAuthenticatedUser(request, {
      env: {
        NODE_ENV: "production",
        RESEARCH_PUBLIC_MODE: "true",
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: "research-team.cloudflareaccess.com",
        CLOUDFLARE_ACCESS_AUD: "access-aud",
        RESEARCH_PUBLIC_ALLOWED_HOSTS: "research.example.test",
      },
      requireResearchPublicAccess: async () => ({
        sub: "cloudflare-subject-1",
        jti: "access-session-1",
        role: "ADMIN",
        organizationId: "attacker-org",
      }),
      findUserBySubject: async (subject) => {
        expect(subject).toBe("cloudflare-subject-1");
        return {
          id: "user-1",
          organizationId: "org-a",
          role: "REVIEWER",
          active: true,
          organization: { active: true },
        };
      },
    });
    expect(actor).toEqual({ userId: "user-1", organizationId: "org-a", role: "REVIEWER", sessionId: "access-session-1" });
  });

  it("fails closed for an unknown Cloudflare Access subject", async () => {
    const request = new Request("https://research.example.test/api/me", {
      headers: { "cf-access-jwt-assertion": "verified-access-token" },
    });
    await expect(requireAuthenticatedUser(request, {
      env: {
        NODE_ENV: "production",
        RESEARCH_PUBLIC_MODE: "true",
        CLOUDFLARE_ACCESS_TEAM_DOMAIN: "research-team.cloudflareaccess.com",
        CLOUDFLARE_ACCESS_AUD: "access-aud",
        RESEARCH_PUBLIC_ALLOWED_HOSTS: "research.example.test",
      },
      requireResearchPublicAccess: async () => ({ sub: "unknown-access-subject" }),
      findUserBySubject: async () => null,
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("does not assign TECHNICIAN when no database user exists", async () => {
    const request = new Request("http://localhost/api/samples", {
      headers: { authorization: "Bearer signed-token" },
    });
    await expect(requireAuthenticatedUser(request, {
      env: {
        NODE_ENV: "test",
        OIDC_ISSUER: "https://issuer.example",
        OIDC_AUDIENCE: "mic-api",
        OIDC_JWKS_URL: "https://issuer.example/jwks",
      },
      verifyToken: async () => ({ payload: { sub: "unknown", sid: "session-1" } }),
      findUserBySubject: async () => null,
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("enables development auth only with explicit development settings", async () => {
    const request = new Request("http://localhost/api/samples");
    const actor = await requireAuthenticatedUser(request, {
      env: { NODE_ENV: "development", DEV_AUTH_ENABLED: "true", DEV_AUTH_USER_ID: "dev-user" },
      findUserById: async () => ({
        id: "dev-user",
        organizationId: "org-dev",
        role: "ADMIN",
        active: true,
        organization: { active: true },
      }),
    });
    expect(actor.sessionId).toBe("development:dev-user");
    await expect(requireAuthenticatedUser(request, {
      env: { NODE_ENV: "production", DEV_AUTH_ENABLED: "true", DEV_AUTH_USER_ID: "dev-user" },
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

