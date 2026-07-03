import { expect, test } from "@playwright/test";

function makePlate() {
  return {
    id: "plate-conflict",
    name: "S-409 Plate 1",
    status: "DRAFT",
    wellRevision: 1,
    updatedAt: "2026-06-23T00:00:00.000Z",
    lastBreakpointSetId: "bps-1",
    sample: { id: "sample-409", sampleCode: "S-409", organism: "E. coli" },
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
}

function serverWells() {
  return Array.from({ length: 8 }, (_, rowIndex) =>
    Array.from({ length: 12 }, (_, columnIndex) => ({
      rowIndex,
      columnIndex,
      state: rowIndex === 0 && columnIndex === 0 ? "GROWTH" : "UNREAD",
    })),
  ).flat();
}

test("mobile plate save shows revision conflict and safe merge controls", async ({ page }) => {
  const plate = makePlate();
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
  await page.route("**/api/samples", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ samples: [] }) });
      return;
    }
    const body = route.request().postDataJSON();
    expect(body.drugs[0].rowIndex).toBe(0);
    expect(body.drugs[0].drugName).toBe("Drug X");
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ sample: plate.sample, plate: { id: plate.id } }),
    });
  });
  await page.route("**/api/plates/plate-conflict", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plate) });
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "REVISION_CONFLICT", message: "サーバー上の最新版と競合しています。" },
        conflict: {
          plateId: plate.id,
          clientBaseRevision: 1,
          serverRevision: 2,
          serverWellRevision: 2,
          serverUpdatedAt: "2026-06-23T00:10:00.000Z",
          serverUpdatedBy: "reviewer-1",
          serverWells: serverWells(),
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("Sample-ID").fill("S-409");
  await page.getByPlaceholder("Escherichia coli").fill("E. coli");
  await page.getByRole("button", { name: "薬剤配置へ" }).click();
  await page.getByLabel("薬剤名").first().fill("Drug X");
  await page.getByRole("button", { name: "プレート入力へ" }).click();

  for (const row of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
    await page.getByRole("button", { name: `行${row}を発育なしに一括入力` }).click();
  }

  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect(page.getByRole("alert", { name: "同期競合の確認" })).toBeVisible();
  await expect(page.getByText("強制上書きはできません。")).toBeVisible();
  await expect(page.getByText(/A1:.*local INHIBITED.*server GROWTH/)).toBeVisible();
  await expect(page.getByRole("button", { name: "非競合を再適用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "サーバー版を採用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ローカル破棄" })).toBeVisible();
  await expect(page.getByRole("button", { name: /force/i })).toHaveCount(0);
});
