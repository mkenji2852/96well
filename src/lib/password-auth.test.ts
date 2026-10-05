import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  isPasswordAcceptable,
  normalizeLoginEmail,
  readCookieValue,
  verifyPassword,
} from "./password-auth";

describe("password auth helpers", () => {
  it("hashes passwords without storing plaintext", () => {
    const encoded = hashPassword("correct horse battery staple");
    expect(encoded).not.toContain("correct horse");
    expect(verifyPassword("correct horse battery staple", encoded)).toBe(true);
    expect(verifyPassword("wrong password", encoded)).toBe(false);
  });

  it("normalizes email addresses and enforces password length", () => {
    expect(normalizeLoginEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(isPasswordAcceptable("short")).toBe(false);
    expect(isPasswordAcceptable("long-enough-password")).toBe(true);
  });

  it("hashes session tokens for storage", () => {
    const token = createSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hash);
  });

  it("reads session cookies without trusting other cookie values", () => {
    const request = new Request("https://example.test", {
      headers: { cookie: "a=1; micplate_session=secret-token; b=2" },
    });
    expect(readCookieValue(request, "micplate_session")).toBe("secret-token");
  });
});

