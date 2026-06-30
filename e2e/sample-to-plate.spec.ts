import { expect, test } from "@playwright/test";

test("mobile plate entry supports state, bulk apply, details, validation, and save", async ({ page }) => {
  const plate = {
    id: "plate-1",
    name: "S-001 Plate 1",
    status: "DRAFT",
    wellRevision: 0,
    updatedAt: "2026-06-23T00:00:00.000Z",
    lastBreakpointSetId: "bps-1",
    sample: { id: "sample-1", sampleCode: "S-001", organism: "E. coli" },
    drugs: [{
      id: "drug-1",
      rowIndex: 0,
      drugName: "Drug X",
      unit: "µg/mL",
      concentrations: [64, 32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125],
    }],
    wells: [],
    results: [],
  };

  await page.route("**/api/samples", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ sample: plate.sample, plate: { id: plate.id } }),
  }));
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { userId: "tech-1", organizationId: "org-a", role: "TECHNICIAN", sessionId: "session-1" } }),
  }));
  await page.route("**/api/breakpoint-sets?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ breakpointSets: [{ id: "bps-1", standard: "CLSI", version: "2026.1", organism: "E. coli", status: "APPROVED", approvedAt: "2026-01-01T00:00:00.000Z", effectiveFrom: null, effectiveTo: null }] }),
  }));
  await page.route("**/api/plates/plate-1", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(route.request().headers()["if-match"]).toBe("0");
      expect(body.expectedRevision).toBe(0);
      expect(body.idempotencyKey).toEqual(expect.stringContaining("plate-save:org-a:tech-1:plate-1:"));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plateId: plate.id, status: "DRAFT", wellRevision: 1, results: [] }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plate) });
    }
  });

  await page.goto("/");
  await page.getByLabel("サンプルID").fill("S-001");
  await page.getByLabel("菌種（任意）").fill("E. coli");
  await page.getByLabel("薬剤", { exact: true }).fill("Drug X");
  await page.getByRole("button", { name: "プレート入力へ" }).click();

  await expect(page.locator(".ui-well")).toHaveCount(96);
  await expect(page.locator(".plate-action-bar")).toHaveCSS("position", "fixed");
  await expect(page.locator(".plate-app-header")).toHaveCSS("position", "sticky");

  await page.getByRole("button", { name: "A1: 未入力" }).click();
  await expect(page.getByRole("button", { name: "A1: 発育あり" })).toBeVisible();

  await page.getByRole("button", { name: "行Aを発育なしに一括入力" }).click();
  await expect(page.getByRole("button", { name: "A12: 発育なし" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "A1: 発育あり" })).toBeVisible();

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("未入力ウェルが95個あります。すべて入力してください。")).toBeVisible();

  for (const row of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
    await page.getByRole("button", { name: `行${row}を発育なしに一括入力` }).click();
  }
  await expect(page.locator(".header-empty-count b")).toHaveText("0");

  await page.getByRole("button", { name: "詳細", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "ウェル詳細" })).toBeVisible();
  await page.getByLabel("note").fill("目視確認済み");
  await page.getByRole("button", { name: "更新" }).click();

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("プレートを保存しました。")).toBeVisible();
});
