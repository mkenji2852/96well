import { NextResponse } from "next/server";

export type AuthErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND";

const statusByCode: Record<AuthErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
};

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function authErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof AuthError)) return null;
  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    { status: statusByCode[error.code] },
  );
}

