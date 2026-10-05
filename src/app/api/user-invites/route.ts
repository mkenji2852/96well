import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { createSessionToken, hashSessionToken, normalizeLoginEmail } from "@/lib/password-auth";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { createInviteSchema } from "@/lib/validation";

function displayNameFromEmail(email: string): string {
  return email.split("@")[0] || "Research user";
}

export async function POST(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "user:manage");
    const parsed = createInviteSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", message: "招待入力を確認してください。" }, details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const email = normalizeLoginEmail(parsed.data.email);
    const inviteToken = createSessionToken();
    const inviteTokenHash = hashSessionToken(inviteToken);
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email },
        select: { id: true, organizationId: true },
      });
      if (existingUser) {
        return { kind: "existing-user" as const };
      }

      const existingInvite = await tx.userInvite.findUnique({
        where: { organizationId_email: { organizationId: actor.organizationId, email } },
        select: { id: true, redeemedAt: true },
      });
      if (existingInvite?.redeemedAt) {
        return { kind: "redeemed-invite" as const };
      }

      const invite = existingInvite
        ? await tx.userInvite.update({
          where: { id: existingInvite.id },
          data: {
            role: parsed.data.role,
            active: true,
            expiresAt,
            inviteTokenHash,
            inviteCreatedAt: now,
            createdByUserId: actor.userId,
          },
          select: { id: true, organizationId: true, email: true, role: true, expiresAt: true },
        })
        : await tx.userInvite.create({
          data: {
            organizationId: actor.organizationId,
            email,
            role: parsed.data.role,
            active: true,
            expiresAt,
            inviteTokenHash,
            inviteCreatedAt: now,
            createdByUserId: actor.userId,
          },
          select: { id: true, organizationId: true, email: true, role: true, expiresAt: true },
        });

      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: existingInvite ? "USER_INVITE_UPDATED" : "USER_INVITE_CREATED",
          entityType: "UserInvite",
          entityId: invite.id,
          afterJson: {
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            inviteId: invite.id,
            email: invite.email,
            role: invite.role,
            expiresAt: invite.expiresAt?.toISOString() ?? null,
            inviteTokenIssued: true,
            sessionId: actor.sessionId,
          },
        },
      });

      return { kind: "invite" as const, invite };
    });

    if (result.kind === "existing-user") {
      return NextResponse.json(
        { error: { code: "USER_ALREADY_EXISTS", message: "このメールアドレスのユーザーは既に存在します。" } },
        { status: 409 },
      );
    }
    if (result.kind === "redeemed-invite") {
      return NextResponse.json(
        { error: { code: "INVITE_ALREADY_REDEEMED", message: "この招待は既に使用済みです。" } },
        { status: 409 },
      );
    }

    const origin = new URL(request.url).origin;
    const inviteUrl = `${origin}/?invite=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(result.invite.email)}`;
    return NextResponse.json({
      invite: {
        id: result.invite.id,
        email: result.invite.email,
        suggestedName: displayNameFromEmail(result.invite.email),
        role: result.invite.role,
        expiresAt: result.invite.expiresAt?.toISOString() ?? null,
        inviteToken,
        inviteUrl,
      },
    }, { status: 201 });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { error: { code: "INVITE_CONFLICT", message: "招待の作成が競合しました。再試行してください。" } },
        { status: 409 },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "招待作成に失敗しました。" } },
      { status: 500 },
    );
  }
}
