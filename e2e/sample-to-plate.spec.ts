import { expect, test } from "@playwright/test";

test("flexible template coordinates remain unchanged in the input screen", async ({ page }) => {
  const assignments = [{ rowIndex: 0, columnIndex: 10, concentration: 4 }, { rowIndex: 1, columnIndex: 11, concentration: 8 }, { rowIndex: 7, columnIndex: 2, concentration: 16 }];
  const sample = { id: "sample-layout", sampleCode: "S-layout", organism: "E. coli" };
  const plate = { id: "plate-layout", name: "Flexible", status: "DRAFT", wellRevision: 0, updatedAt: "2026-10-08T00:00:00Z", sample, wells: [], results: [],
    drugs: [{ id: "drug-layout", rowIndex: 0, drugName: "Ampicillin", unit: "mg/L", concentrations: { mode: "wells", wells: assignments } }],
  };
  await page.addInitScript(wells => localStorage.setItem("mic-plate-templates-v1", JSON.stringify([
    { id: "template-layout", name: "Flexible", drugs: [{ id: "drug-layout", drugName: "Ampicillin", unit: "mg/L", wells }], createdAt: "2026-10-08T00:00:00Z" },
  ])), assignments);
  await page.route("**/api/me", route => route.fulfill({ json: { user: { userId: "tech-layout", organizationId: "org-layout", role: "TECHNICIAN", sessionId: "session-layout" } } }));
  await page.route("**/api/breakpoint-sets?**", route => route.fulfill({ json: { breakpointSets: [] } }));
  await page.route("**/api/samples", async route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON().drugs[0].wells).toEqual(assignments);
      await route.fulfill({ status: 201, json: { sample, plate } });
    } else await route.fulfill({ json: { samples: [{ ...sample, plates: [plate] }] } });
  });
  await page.route("**/api/plates/plate-layout", route => route.fulfill({ json: plate }));
  await page.goto("/");
  await page.getByLabel("Sample-ID", { exact: true }).fill("S-layout");
  await page.getByRole("button", { name: "プレート入力へ", exact: true }).click();
  const assertLayout = async () => {
    for (const [name, dose] of [["A11", "4"], ["B12", "8"], ["H3", "16"]]) {
      const well = page.getByRole("button", { name: `${name}: 未入力`, exact: true });
      await expect(well).toContainText("Ampicillin");
      await expect(well).toContainText(`${dose} mg/L`);
    }
    await expect(page.getByRole("button", { name: "A1: 未入力", exact: true })).not.toContainText("Ampicillin");
  };
  await assertLayout();
  await page.getByRole("button", { name: "初期画面へ戻る" }).click();
  await page.getByRole("button", { name: "選択したプレートを開く" }).click();
  await assertLayout();
});

test("plate template deletion requires confirmation and persists without deleting samples", async ({ page }) => {
  let sampleDeleteRequests = 0;
  await page.route("**/api/me", route => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.route("**/api/samples", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ samples: [] }) }));
  await page.route("**/api/samples/**", route => {
    sampleDeleteRequests++;
    return route.abort();
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("mic-plate-templates-v1", JSON.stringify([
    { id: "template-1", name: "Template One", drugs: [], createdAt: "2026-10-07T00:00:00Z" },
    { id: "template-2", name: "Template Two", drugs: [], createdAt: "2026-10-07T00:00:00Z" },
  ])));
  await page.reload();
  const selector = page.getByLabel("プレート").first();
  await expect(selector).toHaveValue("template-1");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "選択したテンプレートを削除" }).click();
  await expect(selector).toHaveValue("template-1");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "選択したテンプレートを削除" }).click();
  await expect(selector).toHaveValue("template-2");
  await page.reload();
  await expect(selector).toHaveValue("template-2");
  await expect(selector.locator("option")).toHaveCount(2);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "選択したテンプレートを削除" }).click();
  await expect(page.getByRole("button", { name: "プレート入力へ" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "選択したテンプレートを削除" })).toBeDisabled();
  expect(sampleDeleteRequests).toBe(0);
});

async function dragAssignA1ToA12(page: import("@playwright/test").Page) {
  await page.locator(".layout-grid-head.row-label").first().click();
  await page.locator(".assignment-actions .primary-button").click();
  await expect(page.getByText("Drug X: A1, A2, A3, A4, A5, A6, A7, A8 +4")).toBeVisible();
}

test("mobile plate entry supports state, bulk apply, details, validation, and save", async ({ page }) => {
  let plateReadCount = 0;
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

  await page.route("**/api/samples", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ samples: [] }) });
      return;
    }
    const body = route.request().postDataJSON();
    expect(body.drugs[0].rowIndex).toBe(0);
    expect(body.drugs[0].drugName).toBe("Drug X");
    expect(body.drugs[0].wells).toHaveLength(12);
    expect(body.drugs[0].wells[0]).toMatchObject({ rowIndex: 0, columnIndex: 0, concentration: 64 });
    expect(body.drugs[0].wells[11]).toMatchObject({ rowIndex: 0, columnIndex: 11, concentration: 0.03125 });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ sample: plate.sample, plate }),
    });
  });
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { userId: "tech-1", name: "Researcher", email: "research@example.test", organizationId: "org-a", role: "TECHNICIAN", sessionId: "session-1" } }),
  }));
  await page.route("**/api/breakpoint-sets?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ breakpointSets: [{ id: "bps-1", standard: "CLSI", version: "2026.1", organism: "Staphylococcus aureus", status: "APPROVED", approvedAt: "2026-01-01T00:00:00.000Z", effectiveFrom: null, effectiveTo: null }] }),
  }));
  await page.route("**/api/plates/plate-1", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(route.request().headers()["if-match"]).toBe("0");
      expect(body.expectedRevision).toBe(0);
      expect(body.allowOrganismMismatch).toBe(true);
      expect(body.breakpointChangeReason).toBe("Research comparison");
      expect(body.idempotencyKey).toEqual(expect.stringContaining("plate-save:org-a:tech-1:plate-1:"));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ plateId: plate.id, status: "DRAFT", wellRevision: 1, results: [] }) });
    } else {
      plateReadCount++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plate) });
    }
  });
  await page.route("**/api/plates/plate-1/image-assessments", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        assessment: { id: "assessment-1", status: "REVIEW_REQUIRED", manualReviewRequired: true },
        analysis: { qc_score: 0.82, detected_wells: 96, confidence: 0.78, review_needed: true },
      }),
    });
  });

  await page.goto("/");
  await expect(page.getByText("ログイン中: Researcher")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "共通ツールバー" })).toHaveCSS("position", "fixed");
  await page.getByRole("button", { name: "プレート作成" }).first().click();
  await page.getByLabel("薬剤名").first().fill("Drug X");
  await dragAssignA1ToA12(page);
  await page.getByRole("button", { name: "プレート設定を保存" }).click();

  await page.getByLabel("Sample-ID", { exact: true }).fill("S-001");
  await page.getByPlaceholder("Escherichia coli").fill("E. coli");
  await page.getByRole("button", { name: "プレート入力へ" }).click();

  await expect(page.locator(".ui-well")).toHaveCount(96);
  expect(plateReadCount).toBe(0);
  await expect(page.getByRole("button", { name: "初期画面へ戻る" })).toBeVisible();
  await expect(page.locator(".plate-action-bar")).toHaveCSS("position", "fixed");
  await expect(page.locator(".plate-app-header")).toHaveCSS("position", "sticky");

  await page.getByTestId("plate-image-input").setInputFiles({
    name: "research-plate.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("fake image"),
  });
  await expect(page.getByTestId("image-upload-status")).toContainText("REVIEW_REQUIRED");
  await expect(page.getByTestId("image-upload-status")).toContainText("YES");
  await expect(page.getByRole("link", { name: "画像レビューへ" })).toHaveAttribute("href", "/review/image");

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
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("異なる菌種のBreakpointを研究用に適用する確認と理由が必要です。")).toBeVisible();
  await page.getByLabel("異なる菌種のBreakpointを研究用に任意適用する", { exact: false }).check();
  await page.getByLabel("任意適用理由").fill("Research comparison");

  await page.getByRole("button", { name: "詳細", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "ウェル詳細" })).toBeVisible();
  await page.getByLabel("note").fill("目視確認済み");
  await page.getByRole("button", { name: "更新" }).click();

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("プレートを保存しました。")).toBeVisible();
});
