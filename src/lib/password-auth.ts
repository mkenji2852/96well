import { pbkdf2Sync, randomBytes, timingSafeEqual, createHash } from "node:crypto";

export const PASSWORD_SESSION_COOKIE = "micplate_session";
export const PASSWORD_SESSION_DAYS = 30;

const HASH_ALGORITHM = "pbkdf2_sha256";
const HASH_ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPasswordAcceptable(password: string): boolean {
  return password.length >= 10 && password.length <= 200;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const key = pbkdf2Sync(password, salt, HASH_ITERATIONS, KEY_LENGTH, DIGEST).toString("base64url");
  return `${HASH_ALGORITHM}$${HASH_ITERATIONS}$${salt}$${key}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, iterationsRaw, salt, expectedRaw] = encoded.split("$");
  if (algorithm !== HASH_ALGORITHM || !iterationsRaw || !salt || !expectedRaw) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;
  const actual = pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST);
  const expected = Buffer.from(expectedRaw, "base64url");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function sessionExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + PASSWORD_SESSION_DAYS * 24 * 60 * 60 * 1000);
}

export function cookieMaxAgeSeconds(): number {
  return PASSWORD_SESSION_DAYS * 24 * 60 * 60;
}

export function sessionCookieOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: cookieMaxAgeSeconds(),
  };
}

export function clearSessionCookieOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    ...sessionCookieOptions(env),
    maxAge: 0,
  };
}

export function readCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=");
    if (rawName === name) return rawValue.join("=") || null;
  }
  return null;
}

