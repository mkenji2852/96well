import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac";
import { createUserSchema } from "@/lib/validation";

function serializeUser(user: {
  id: string;
  name: string;
  email: string;
  externalSubject: string | null;
  role: string;
  active: boolean;
  createdAt: Date;
}) {
  return {
    ...user,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "user:manage");
    const users = await prisma.user.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        externalSubject: true,
        role: true,
        active: true,
        createdAt: true,
      },
      take: 250,
    });
    return NextResponse.json({ users: users.map(serializeUser) });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "ユーザー一覧の取得に失敗しました。" } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    requirePermission(actor, "user:manage");
    const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", message: "ユーザー入力を確認してください。" }, details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId: actor.organizationId,
          name: parsed.data.name,
          email: parsed.data.email,
          externalSubject: parsed.data.externalSubject?.trim() || null,
          role: parsed.data.role,
          active: parsed.data.active,
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
          action: "USER_CREATED",
          entityType: "User",
          entityId: created.id,
          afterJson: {
            actorUserId: actor.userId,
            organizationId: actor.organizationId,
            userId: created.id,
            role: created.role,
            active: created.active,
            hasExternalSubject: Boolean(created.externalSubject),
            sessionId: actor.sessionId,
          },
        },
      });
      return created;
    });
    return NextResponse.json({ user: serializeUser(user) }, { status: 201 });
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
      { error: { code: "INTERNAL_ERROR", message: "ユーザー作成に失敗しました。" } },
      { status: 500 },
    );
  }
}
