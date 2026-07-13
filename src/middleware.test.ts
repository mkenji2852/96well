import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "../middleware";

const productionEnv = {
  NODE_ENV: "production",
  RESEARCH_PUBLIC_MODE: "true",
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "research-team.cloudflareaccess.com",
  CLOUDFLARE_ACCESS_AUD: "access-aud",
  RESEARCH_PUBLIC_ALLOWED_HOSTS: "96well-testing.micplate-testing.com",
};

function stubEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
}

function request(path: string, host: string) {
  return new Request(`https://${host}${path}`, {
    headers: {
      host,
    },
  });
}

describe("research-public middleware host guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets non research-public mode keep the existing behavior", async () => {
    stubEnv({
      NODE_ENV: "production",
      RESEARCH_PUBLIC_MODE: "false",
    });

    const response = await middleware(request("/", "site.netlify.app") as never);

    expect(response.status).toBe(200);
  });

  it("fails closed when allowed hosts are not configured", async () => {
    stubEnv({
      ...productionEnv,
      RESEARCH_PUBLIC_ALLOWED_HOSTS: "",
    });

    const response = await middleware(request("/", "96well-testing.micplate-testing.com") as never);

    expect(response.status).toBe(403);
  });

  it("passes host validation for the configured custom domain before requiring Access JWT", async () => {
    stubEnv(productionEnv);

    const response = await middleware(request("/", "96well-testing.micplate-testing.com") as never);

    expect(response.status).toBe(401);
  });

  it.each([
    ["/", "site.netlify.app"],
    ["/breakpoints", "site.netlify.app"],
    ["/review/image", "site.netlify.app"],
    ["/api/me", "site.netlify.app"],
    ["/", "deploy-preview-1--site.netlify.app"],
    ["/", "branch-name--site.netlify.app"],
    ["/", "unknown.example.com"],
  ])("rejects direct or unknown host %s on %s", async (path, host) => {
    stubEnv(productionEnv);

    const response = await middleware(request(path, host) as never);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "FORBIDDEN", message: "Access is restricted to authorized research users." },
    });
  });
});
