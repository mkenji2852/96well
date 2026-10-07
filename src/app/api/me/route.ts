import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    const profile = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true, email: true, organization: { select: { name: true } } },
    });
    return NextResponse.json({ user: {
      ...actor,
      name: profile?.name,
      email: profile?.email,
      organizationName: profile?.organization.name,
    } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    console.error(error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "ユーザー情報の取得に失敗しました。" } },
      { status: 500 },
    );
  }
}
