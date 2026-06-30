import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const imageReference =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function makeWells() {
  return Array.from({ length: 8 }, (_, rowIndex) =>
    Array.from({ length: 12 }, (_, columnIndex) => ({
      wellId: `${String.fromCharCode(65 + rowIndex)}${columnIndex + 1}`,
      rowIndex,
      columnIndex,
      state: "INHIBITED",
      confidence: 1,
      reviewNeeded: true,
      qcFlags: [],
    })),
  ).flat();
}

function makeAssessment(status = "REVIEW_REQUIRED") {
  return {
    id: "assessment-1",
    plateId: "plate-1",
    status,
    manualReviewRequired: status !== "APPROVED",
    createdAt: "2026-06-23T00:00:00.000Z",
    imageReference,
    uploadedByUserId: "tech-1",
    uploader: { id: "tech-1", name: "Tech One", email: "tech@example.test" },
    reviewWaitingMinutes: 42,
    qcWarningCount: 0,
    plate: {
      id: "plate-1",
      name: "Plate 1",
      status: "REVIEW_REQUIRED",
      lastBreakpointSetId: "bps-1",
      sample: { id: "sample-1", sampleCode: "S-001", organism: "E. coli" },
      organization: { id: "org-a", name: "Org A" },
    },
    prediction: {
      id: "prediction-1",
      imageReference,
      modelVersion: "opencv-mvp",
      qcScore: 0.98,
      qcFlags: {},
      detectedWells: 96,
      plateConfidence: 1,
      createdAt: "2026-06-23T00:01:00.000Z",
      wells: makeWells(),
    },
    overrides: [],
    reviews: [],
  };
}

test("mobile landscape image review supports keyboard, screen reader names, axe, and safe approve", async ({ page }) => {
  let approveCalls = 0;
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewportSize({ width: 844, height: 390 });
  await page.route("**/api/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ user: { userId: "reviewer-1", organizationId: "org-a", role: "REVIEWER", sessionId: "session-1" } }),
  }));
  await page.route("**/api/breakpoint-sets?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      breakpointSets: [{
        id: "bps-1",
        standard: "CLSI",
        version: "2026.1",
        organism: "E. coli",
        status: "APPROVED",
        effectiveFrom: null,
        effectiveTo: null,
        approvedAt: "2026-01-01T00:00:00.000Z",
      }],
    }),
  }));
  await page.route("**/api/image-assessments?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ assessments: [makeAssessment()], page: { limit: 25, offset: 0, total: 1 } }),
  }));
  await page.route("**/api/image-assessments/assessment-1", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ assessment: makeAssessment("APPROVED") }),
  }));
  await page.route("**/api/plates/plate-1/image-assessments/assessment-1/approve", (route) => {
    approveCalls += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ kind: "approved", status: "APPROVED" }),
    });
  });
  await page.route("**/api/plates/plate-1/image-assessments/assessment-1/override", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ kind: "overridden" }),
  }));

  await page.goto("/review/image");
  await expect(page.getByText("S-001").first()).toBeVisible();
  await expect(page.locator(".review-well")).toHaveCount(96);
  await expect(page.getByTestId("well-A1")).toHaveAttribute("aria-label", /^A1 /);
  await expect(page.getByTestId("well-H12")).toHaveAttribute("aria-label", /^H12 /);

  const box = await page.getByTestId("well-A1").boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  await page.getByTestId("well-A1").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("well-A2")).toBeFocused();

  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious).toEqual([]);

  await page.getByRole("button", { name: "未確認を予測通り確認" }).click();
  await page.getByRole("button", { name: "承認" }).click();
  await expect(page.getByText("画像レビューを承認しました。")).toBeVisible();
  expect(approveCalls).toBe(1);
});
