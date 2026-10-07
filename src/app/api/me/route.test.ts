import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), findUser: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuthenticatedUser: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUser } } }));
import { AuthError } from "@/lib/api-auth-error";
import { GET } from "./route";

describe("current user profile", () => {
  beforeEach(() => vi.resetAllMocks());
  it("returns the authenticated user's display fields and prevents caching", async () => {
    mocks.auth.mockResolvedValue({ userId: "user-a", organizationId: "org-a", role: "TECHNICIAN", sessionId: "session-a" });
    mocks.findUser.mockResolvedValue({ name: "Researcher", email: "research@example.test", organization: { name: "Research Org" } });
    const response = await GET(new Request("http://localhost/api/me?userId=other"));
    expect((await response.json()).user).toMatchObject({ userId: "user-a", role: "TECHNICIAN", name: "Researcher", organizationName: "Research Org" });
    expect(mocks.findUser).toHaveBeenCalledWith({ where: { id: "user-a" }, select: {
      name: true, email: true, organization: { select: { name: true } },
    } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not read a profile for an unauthenticated request", async () => {
    mocks.auth.mockRejectedValue(new AuthError("UNAUTHENTICATED", "認証が必要です。"));
    expect((await GET(new Request("http://localhost/api/me"))).status).toBe(401);
    expect(mocks.findUser).not.toHaveBeenCalled();
  });
});
