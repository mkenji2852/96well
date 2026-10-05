import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  PASSWORD_SESSION_COOKIE,
  createSessionToken,
  hashSessionToken,
  normalizeLoginEmail,
  sessionCookieOptions,
  sessionExpiresAt,
  verifyPassword,
} from "@/lib/password-auth";
import { loginSchema } from "@/lib/validation";

function unauthorized() {
  return NextResponse.json(
    { error: { code: "UNAUTHENTICATED", message: "メールアドレスまたはパスワードが正しくありません。" } },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return unauthorized();

    const email = normalizeLoginEmail(parsed.data.email);
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        organizationId: true,
        role: true,
        active: true,
        organization: { select: { active: true } },
        passwordCredential: { select: { passwordHash: true } },
      },
    });
    if (!user || !user.active || !user.organization.active || !user.passwordCredential) {
      return unauthorized();
    }
    if (!verifyPassword(parsed.data.password, user.passwordCredential.passwordHash)) {
      return unauthorized();
    }

    const token = createSessionToken();
    const expiresAt = sessionExpiresAt();
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.userSession.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(token),
          expiresAt,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorLabel: user.id,
          action: "USER_PASSWORD_LOGIN",
          entityType: "User",
          entityId: user.id,
          afterJson: {
            organizationId: user.organizationId,
            role: user.role,
            sessionId: `password-session:${created.id}`,
          },
        },
      });
      return created;
    });

    const response = NextResponse.json({
      user: {
        userId: user.id,
        organizationId: user.organizationId,
        role: user.role,
        sessionId: `password-session:${session.id}`,
      },
    });
    response.cookies.set(PASSWORD_SESSION_COOKIE, token, sessionCookieOptions(process.env));
    return response;
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "ログインに失敗しました。" } },
      { status: 500 },
    );
  }
}
