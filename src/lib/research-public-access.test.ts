import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  requireResearchPublicAccess,
  researchPublicAccessConfiguration,
  ResearchPublicAccessError,
  verifyCloudflareAccessToken,
  type ResearchPublicAccessConfiguration,
} from "./research-public-access";

const baseEnv = {
  NODE_ENV: "production",
  RESEARCH_PUBLIC_MODE: "true",
  CLOUDFLARE_ACCESS_TEAM_DOMAIN: "research-team.cloudflareaccess.com",
  CLOUDFLARE_ACCESS_AUD: "access-aud",
  RESEARCH_PUBLIC_ALLOWED_HOSTS: "research.example.test",
} as NodeJS.ProcessEnv;

function request(headers?: HeadersInit, host = "research.example.test") {
  return new Request(`https://${host}/api/me`, { headers });
}

async function signedToken(
  configuration: ResearchPublicAccessConfiguration,
  overrides: { issuer?: string; audience?: string; expiresIn?: string } = {},
) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const token = await new SignJWT({ sub: "access-user" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.issuer ?? configuration.issuer)
    .setAudience(overrides.audience ?? configuration.audience[0])
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "5m")
    .sign(privateKey);
  return { token, publicKey, jwk };
}

describe("research public Cloudflare Access boundary", () => {
  it("passes with a cryptographically valid Access JWT", async () => {
    const configuration = researchPublicAccessConfiguration(baseEnv)!;
    const { token, publicKey } = await signedToken(configuration);
    await expect(verifyCloudflareAccessToken(token, configuration, async () => publicKey)).resolves.toMatchObject({
      sub: "access-user",
    });
  });

  it("rejects a missing Access JWT", async () => {
    await expect(requireResearchPublicAccess(request(), { env: baseEnv }))
      .rejects.toMatchObject({ code: "ACCESS_JWT_MISSING" });
  });

  it("rejects an invalid signature", async () => {
    const configuration = researchPublicAccessConfiguration(baseEnv)!;
    const { token } = await signedToken(configuration);
    const { publicKey: otherPublicKey } = await generateKeyPair("RS256");
    await expect(verifyCloudflareAccessToken(token, configuration, async () => otherPublicKey))
      .rejects.toMatchObject({ code: "ACCESS_JWT_INVALID" });
  });

  it("rejects a wrong issuer", async () => {
    const configuration = researchPublicAccessConfiguration(baseEnv)!;
    const { token, publicKey } = await signedToken(configuration, { issuer: "https://wrong.example.test" });
    await expect(verifyCloudflareAccessToken(token, configuration, async () => publicKey))
      .rejects.toMatchObject({ code: "ACCESS_JWT_INVALID" });
  });

  it("rejects a wrong audience", async () => {
    const configuration = researchPublicAccessConfiguration(baseEnv)!;
    const { token, publicKey } = await signedToken(configuration, { audience: "wrong-aud" });
    await expect(verifyCloudflareAccessToken(token, configuration, async () => publicKey))
      .rejects.toMatchObject({ code: "ACCESS_JWT_INVALID" });
  });

  it("rejects an expired token", async () => {
    const configuration = researchPublicAccessConfiguration(baseEnv)!;
    const { token, publicKey } = await signedToken(configuration, { expiresIn: "-1s" });
    await expect(verifyCloudflareAccessToken(token, configuration, async () => publicKey))
      .rejects.toMatchObject({ code: "ACCESS_JWT_INVALID" });
  });

  it("fails closed when required config is missing", () => {
    expect(() => researchPublicAccessConfiguration({
      NODE_ENV: "production",
      RESEARCH_PUBLIC_MODE: "true",
    } as NodeJS.ProcessEnv)).toThrow(ResearchPublicAccessError);
  });

  it("rejects a direct API request without Access JWT", async () => {
    await expect(requireResearchPublicAccess(request(undefined, "research-app.netlify.app"), {
      env: { ...baseEnv, RESEARCH_PUBLIC_ALLOWED_HOSTS: "research.example.test,research-app.netlify.app" },
    })).rejects.toMatchObject({ code: "ACCESS_JWT_MISSING" });
  });

  it("rejects a Netlify-like host before trusting any user auth", async () => {
    await expect(requireResearchPublicAccess(request({ "cf-access-jwt-assertion": "anything" }, "deploy-preview-1--app.netlify.app"), {
      env: baseEnv,
      verifyToken: async () => ({ sub: "access-user" }),
    })).rejects.toMatchObject({ code: "ACCESS_HOST_FORBIDDEN" });
  });
});
