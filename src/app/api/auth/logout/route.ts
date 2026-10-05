import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  PASSWORD_SESSION_COOKIE,
  clearSessionCookieOptions,
  hashSessionToken,
  readCookieValue,
} from "@/lib/password-auth";

export async function POST(request: Request) {
  const token = readCookieValue(request, PASSWORD_SESSION_COOKIE);
  if (token) {
    await prisma.userSession.updateMany({
      where: { tokenHash: hashSessionToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    }).catch(() => undefined);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PASSWORD_SESSION_COOKIE, "", clearSessionCookieOptions(process.env));
  return response;
}

