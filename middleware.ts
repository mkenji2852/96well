import { NextResponse, type NextRequest } from "next/server";
import {
  isResearchPublicProduction,
  requireResearchPublicAccess,
  ResearchPublicAccessError,
} from "@/lib/research-public-access";

export async function middleware(request: NextRequest) {
  if (!isResearchPublicProduction()) return NextResponse.next();

  try {
    await requireResearchPublicAccess(request);
    const response = NextResponse.next();
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    const status = error instanceof ResearchPublicAccessError
      && (error.code === "ACCESS_CONFIG_MISSING" || error.code === "ACCESS_HOST_FORBIDDEN")
      ? 403
      : 401;
    const code = status === 403 ? "FORBIDDEN" : "UNAUTHENTICATED";
    return NextResponse.json(
      { error: { code, message: "Access is restricted to authorized research users." } },
      {
        status,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }
}

export const config = {
  matcher: [
    "/",
    "/breakpoints",
    "/review/image",
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js).*)",
  ],
};
