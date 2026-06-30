import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/api-auth-error";
import { requireAuthenticatedUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const actor = await requireAuthenticatedUser(request);
    return NextResponse.json({ user: actor });
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
