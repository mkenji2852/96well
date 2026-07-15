import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { updateUserSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

function serializeUser(user: {
  id: string;
  name: string;
  email: string;
  externalSubject: string | null;
  role: string;
  active: boolean;
  createdAt: Date;
}) {
  return { ...user, createdAt: user.createdAt.toISOString() };
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "user:manage");
    const { id } = await params;
    const parsed = updateUserSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", message: "ユーザー入力を確認してください。" }, details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    if (id === actor.userId && parsed.data.active === false) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", message: "自分自身を無効化することはできません。" } },
        { status: 400 },
      );
    }
    if (id === actor.userId && parsed.data.role && parsed.data.role !== "ADMIN") {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", message: "自分自身のADMIN権限を外すことはできません。" } },
        { status: 400 },
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findFirst({
        where: { id, organizationId: actor.organizationId },
        select: {
          id: true,
          name: true,
          email: true,
          externalSubject: true,
          role: true,
          active: true,
          createdAt: true,
        },
      });
      if (!before) return null;

      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
          ...(parsed.data.externalSubject !== undefined
            ? { externalSubject: parsed.data.externalSubject?.trim() || null }
            : {}),
          ...(parsed.data.role !== undefined ? { role: parsed.data.role } : {}),
          ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          externalSubject: true,
          role: true,
          active: true,
          createdAt: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.userId,
          actorLabel: actor.userId,
          action: "USER_UPDATED",
          entityType: "User",
          entityId: updated.id,
          beforeJson: {
            role: before.role,
            active: before.active,
            hasExternalSubject: Boolean(before.externalSubject),
          },
          afterJson: {
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            userId: updated.id,
            role: updated.role,
            active: updated.active,
            hasExternalSubject: Boolean(updated.externalSubject),
            sessionId: actor.sessionId,
          },
        },
      });
      return updated;
    });

    if (!result) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "ユーザーが見つかりません。" } },
        { status: 404 },
      );
    }
    return NextResponse.json({ user: serializeUser(result) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json(
        { error: { code: "USER_ALREADY_EXISTS", message: "同じメールまたは外部認証IDのユーザーが既に存在します。" } },
        { status: 409 },
      );
    }
    console.error(error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "ユーザー更新に失敗しました。" } },
      { status: 500 },
    );
  }
}
