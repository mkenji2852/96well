import { expect, test } from "@playwright/test";

const previous = {
  id: "bps-old",
  standard: "CLSI",
  version: "2026.1",
  organism: "E. coli",
  unit: "mg/L",
  method: "BROTH_MICRODILUTION",
  status: "APPROVED",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: "2027-01-01T00:00:00.000Z",
  approvedAt: "2026-01-02T00:00:00.000Z",
  approvedByUserId: "admin-0",
  retiredAt: null,
  retireReason: null,
  supersedesBreakpointSetId: null,
  contentHash: "a".repeat(64),
  revision: 3,
  ruleCount: 1,
  rules: [{
    id: "rule-old",
    drugName: "Drug X",
    organism: "E. coli",
    standard: "CLSI",
    version: "2026.1",
    susceptibleMax: 1,
    resistantMin: 4,
    intermediateMin: null,
    intermediateMax: null,
    unit: "mg/L",
    method: "BROTH_MICRODILUTION",
    exceptionJson: null,
  }],
};

const draft = {
  ...previous,
  id: "bps-new",
  version: "2027.1",
  status: "DRAFT",
  approvedAt: null,
  approvedByUserId: null,
  contentHash: null,
  revision: 2,
  supersedesBreakpointSetId: "bps-old",
  rules: [{ ...previous.rules[0], id: "rule-new", version: "2027.1", susceptibleMax: 0.5 }],
  supersedes: previous,
  createdBy: { id: "admin-1", name: "Admin One" },
  approvedBy: null,
};

test("ADMIN can inspect version diff and approval confirmation is keyboard safe", async ({ page }) => {
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { userId: "admin-1", organizationId: "org-a", role: "ADMIN", sessionId: "session-1" } }),
  }));
  await page.route("**/api/breakpoint-sets/bps-new", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ breakpointSet: draft }),
  }));
  await page.route(/\/api\/breakpoint-sets(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ breakpointSets: [draft, previous] }),
  }));

  await page.goto("/breakpoints");
  await expect(page.getByRole("heading", { name: "BreakpointSet管理" })).toBeVisible();
  await expect(page.getByText("版間diff: 2026.1 → 2027.1")).toBeVisible();
  await expect(page.getByText(/S境界 1 → 0.5/)).toBeVisible();
  await expect(page.getByText("DRAFT").first()).toBeVisible();

  const approve = page.getByRole("button", { name: "承認", exact: true });
  await approve.click();
  await expect(page.getByRole("dialog", { name: "BreakpointSetを承認" })).toBeVisible();
  await expect(page.getByRole("button", { name: "キャンセル" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(approve).toBeFocused();
});
