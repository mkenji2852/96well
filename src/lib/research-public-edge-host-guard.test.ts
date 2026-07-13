import { describe, expect, it } from "vitest";
import { evaluateResearchPublicHostGuard } from "../../netlify/edge-functions/research-public-host-guard";

const productionEnv = {
  NODE_ENV: "production",
  RESEARCH_PUBLIC_MODE: "true",
  RESEARCH_PUBLIC_ALLOWED_HOSTS: "96well-testing.micplate-testing.com",
};

function request(host: string, path = "/") {
  return new Request(`https://${host}${path}`, {
    headers: { host },
  });
}

describe("Netlify Edge research-public host guard", () => {
  it("passes the configured staging custom domain", () => {
    expect(evaluateResearchPublicHostGuard(
      request("96well-testing.micplate-testing.com"),
      productionEnv,
    )).toEqual({ action: "pass" });
  });

  it("rejects the Netlify default domain", () => {
    expect(evaluateResearchPublicHostGuard(
      request("site.netlify.app"),
      productionEnv,
    )).toEqual({ action: "reject", status: 403, reason: "HOST_FORBIDDEN" });
  });

  it("rejects deploy preview hosts", () => {
    expect(evaluateResearchPublicHostGuard(
      request("deploy-preview-123--site.netlify.app"),
      productionEnv,
    )).toEqual({ action: "reject", status: 403, reason: "HOST_FORBIDDEN" });
  });

  it("rejects branch deploy hosts", () => {
    expect(evaluateResearchPublicHostGuard(
      request("feature-branch--site.netlify.app"),
      productionEnv,
    )).toEqual({ action: "reject", status: 403, reason: "HOST_FORBIDDEN" });
  });

  it("rejects unknown hosts", () => {
    expect(evaluateResearchPublicHostGuard(
      request("unknown.example.com"),
      productionEnv,
    )).toEqual({ action: "reject", status: 403, reason: "HOST_FORBIDDEN" });
  });

  it("fails closed when allowed hosts are missing", () => {
    expect(evaluateResearchPublicHostGuard(
      request("96well-testing.micplate-testing.com"),
      { NODE_ENV: "production", RESEARCH_PUBLIC_MODE: "true" },
    )).toEqual({ action: "reject", status: 403, reason: "CONFIG_MISSING" });
  });

  it("passes when research-public mode is disabled", () => {
    expect(evaluateResearchPublicHostGuard(
      request("site.netlify.app"),
      { NODE_ENV: "production", RESEARCH_PUBLIC_MODE: "false" },
    )).toEqual({ action: "pass" });
  });

  it("does not trust x-forwarded-host when the actual host is direct Netlify", () => {
    const directRequest = new Request("https://site.netlify.app/", {
      headers: {
        host: "site.netlify.app",
        "x-forwarded-host": "96well-testing.micplate-testing.com",
      },
    });

    expect(evaluateResearchPublicHostGuard(directRequest, productionEnv))
      .toEqual({ action: "reject", status: 403, reason: "HOST_FORBIDDEN" });
  });
});
