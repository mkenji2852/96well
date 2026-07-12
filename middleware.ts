import { NextResponse, type NextRequest } from "next/server";
import { isResearchPublicProduction, requireResearchPublicAccess } from "@/lib/research-public-access";

export async function middleware(request: NextRequest) {
  if (!isResearchPublicProduction()) return NextResponse.next();

  try {
    await requireResearchPublicAccess(request);
    const response = NextResponse.next();
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Access is restricted to authorized research users." } },
      {
        status: 401,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js).*)"],
};
