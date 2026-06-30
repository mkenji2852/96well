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

