import { test, expect } from "@playwright/test";

test("Sample-ID range export shows a download only after success and prevents double submission", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { userId: "researcher", organizationId: "org", role: "TECHNICIAN" } }) }));
  await page.route("**/api/samples", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ samples: [] }) }));
  let calls = 0;
  await page.route("**/api/export/batch", async route => {
    calls++;
    expect(route.request().postDataJSON()).toEqual({ from: "SMP-001", to: "SMP-020" });
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ status: 200, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers: { "x-export-id": "synthetic-batch" }, body: "synthetic-xlsx" });
  });
  await page.goto("/");
  await page.getByLabel("開始Sample-ID").fill("SMP-001");
  await page.getByLabel("終了Sample-ID").fill("SMP-020");
  await expect(page.getByRole("link", { name: "生成済みExcelをダウンロード" })).toHaveCount(0);
  await page.getByRole("button", { name: "範囲指定でExcel出力" }).click();
  await expect(page.getByRole("button", { name: "Excel生成中…" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "生成済みExcelをダウンロード" })).toHaveAttribute("download", "ast-export-synthetic-batch.xlsx");
  expect(calls).toBe(1);
  await page.route("**/api/export/batch", route => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { message: "範囲を狭めてください。" } }) }));
  await page.getByRole("button", { name: "範囲指定でExcel出力" }).click();
  await expect(page.getByText("範囲を狭めてください。", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "生成済みExcelをダウンロード" })).toHaveCount(0);
});
