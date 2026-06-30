import { describe, expect, it } from "vitest";
import { AuthError } from "./api-auth-error";
import type { AuthenticatedActor } from "./auth";
import { requirePermission, requirePlateAccess, requireSampleAccess, type OrganizationAccessStore } from "./rbac";

const actor = (role: AuthenticatedActor["role"], organizationId = "org-a"): AuthenticatedActor => ({
  userId: "user-1",
  organizationId,
  role,
  sessionId: "session-1",
});

describe("role and organization permissions", () => {
  it("allows technicians to enter data but not maintain breakpoints", () => {
    expect(() => requirePermission(actor("TECHNICIAN"), "plate:write")).not.toThrow();
    expect(() => requirePermission(actor("TECHNICIAN"), "breakpoint:write")).toThrowError(AuthError);
  });

  it("allows administrators to maintain breakpoints", () => {
    expect(() => requirePermission(actor("ADMIN"), "breakpoint:write")).not.toThrow();
  });

  it("separates Excel export permissions by profile", () => {
    expect(() => requirePermission(actor("TECHNICIAN"), "export:anonymized")).not.toThrow();
    expect(() => requirePermission(actor("TECHNICIAN"), "export:audit")).toThrowError(AuthError);
    expect(() => requirePermission(actor("REVIEWER"), "export:clinical")).not.toThrow();
    expect(() => requirePermission(actor("REVIEWER"), "export:notes")).toThrowError(AuthError);
    expect(() => requirePermission(actor("AUDITOR"), "export:audit")).not.toThrow();
  });

  it("allows access only when the object belongs to the actor organization", async () => {
    const store: OrganizationAccessStore = {
      sample: { findFirst: async ({ where }) => where.organizationId === "org-a" ? { id: where.id } : null },
      plate: { findFirst: async ({ where }) => where.organizationId === "org-a" ? { id: where.id } : null },
    };
    await expect(requireSampleAccess(actor("TECHNICIAN", "org-a"), "sample-1", store)).resolves.toBeUndefined();
    await expect(requireSampleAccess(actor("TECHNICIAN", "org-b"), "sample-1", store)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(requirePlateAccess(actor("TECHNICIAN", "org-b"), "plate-1", store)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
