import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/samples authentication", () => {
  it("returns 401 without a session", async () => {
    const response = await GET(new Request("http://localhost/api/samples"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("ignores x-user-role ADMIN", async () => {
    const response = await GET(new Request("http://localhost/api/samples", {
      headers: { "x-user-role": "ADMIN" },
    }));
    expect(response.status).toBe(401);
  });
});

