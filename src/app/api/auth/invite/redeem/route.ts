import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  PASSWORD_SESSION_COOKIE,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeLoginEmail,
  sessionCookieOptions,
  sessionExpiresAt,
} from "@/lib/password-auth";
import { prisma } from "@/lib/prisma";
import { redeemInviteSchema } from "@/lib/validation";

function invalidInvite() {
  return NextResponse.json(
    { error: { code: "UNAUTHENTICATED", message: "招待コードが無効、期限切れ、または使用済みです。" } },
    { status: 401 },
  );
}

function displayNameFromEmail(email: string): string {
  return email.split("@")[0] || "Research user";
}

export async function POST(request: Request) {
  try {
    const parsed = redeemInviteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return invalidInvite();

    const email = normalizeLoginEmail(parsed.data.email);
    const inviteTokenHash = hashSessionToken(parsed.data.inviteToken);
    const sessionToken = createSessionToken();
    const sessionTokenHash = hashSessionToken(sessionToken);
    const expiresAt = sessionExpiresAt();
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.userInvite.findUnique({
        where: { inviteTokenHash },
        select: {
          id: true,
          organizationId: true,
          email: true,
          role: true,
          active: true,
          expiresAt: true,
          redeemedAt: true,
          organization: { select: { active: true } },
        },
      });
      if (
        !invite ||
        invite.email !== email ||
        !invite.active ||
        invite.redeemedAt ||
        !invite.organization.active ||
        (invite.expiresAt && invite.expiresAt <= now)
      ) {
        return null;
      }

      const existingUser = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existingUser) {
        return { kind: "existing-user" as const };
      }

      const user = await tx.user.create({
        data: {
          organizationId: invite.organizationId,
          email,
          name: displayNameFromEmail(email),
          externalSubject: null,
          role: invite.role,
          active: true,
          passwordCredential: {
            create: { passwordHash: hashPassword(parsed.data.password) },
          },
        },
        select: {
          id: true,
          organizationId: true,
          role: true,
          active: true,
          organization: { select: { active: true } },
        },
      });

      const redeemed = await tx.userInvite.updateMany({
        where: {
          id: invite.id,
          active: true,
          redeemedAt: null,
          inviteTokenHash,
        },
        data: {
          active: false,
          redeemedAt: now,
          redeemedByUserId: user.id,
        },
      });
      if (redeemed.count !== 1) return null;

      const session = await tx.userSession.create({
        data: {
          userId: user.id,
          tokenHash: sessionTokenHash,
          expiresAt,
        },
        select: { id: true },
      });

      await tx.auditLog.createMany({
        data: [
          {
            actorId: user.id,
            actorLabel: user.id,
            action: "USER_INVITE_REDEEMED",
            entityType: "UserInvite",
            entityId: invite.id,
            afterJson: {
              organizationId: invite.organizationId,
              userId: user.id,
              role: invite.role,
              passwordCredentialCreated: true,
            },
          },
          {
            actorId: user.id,
            actorLabel: user.id,
            action: "USER_PASSWORD_ACCOUNT_CREATED",
            entityType: "User",
            entityId: user.id,
            afterJson: {
              organizationId: invite.organizationId,
              role: invite.role,
              inviteId: invite.id,
              sessionId: `password-session:${session.id}`,
            },
          },
        ],
      });

      return { kind: "user" as const, user, sessionId: session.id };
    });

    if (!result) return invalidInvite();
    if (result.kind === "existing-user") {
      return NextResponse.json(
        { error: { code: "USER_ALREADY_EXISTS", message: "このメールアドレスのユーザーは既に登録済みです。ログインしてください。" } },
        { status: 409 },
      );
    }

    const response = NextResponse.json({
      user: {
        userId: result.user.id,
        organizationId: result.user.organizationId,
        role: result.user.role,
        sessionId: `password-session:${result.sessionId}`,
      },
    }, { status: 201 });
    response.cookies.set(PASSWORD_SESSION_COOKIE, sessionToken, sessionCookieOptions(process.env));
    return response;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: { code: "INVITE_REDEEM_CONFLICT", message: "招待の利用が競合しました。ログイン済みでない場合は管理者へ確認してください。" } },
        { status: 409 },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "招待登録に失敗しました。" } },
      { status: 500 },
    );
  }
}
