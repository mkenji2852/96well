// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageReviewWorkspace } from "@/components/image-review-workspace";
import type { UserRole } from "@/types/domain";
import type { ImageReviewAssessmentSummary } from "@/types/image-review";

function makeWells(confidence = 1) {
  return Array.from({ length: 8 }, (_, rowIndex) =>
    Array.from({ length: 12 }, (_, columnIndex) => ({
      wellId: `${String.fromCharCode(65 + rowIndex)}${columnIndex + 1}`,
      rowIndex,
      columnIndex,
      state: "INHIBITED" as const,
      confidence,
      reviewNeeded: true,
      qcFlags: [],
    })),
  ).flat();
}

function makeAssessment(patch: Partial<ImageReviewAssessmentSummary> = {}): ImageReviewAssessmentSummary {
  return {
    id: "assessment-1",
    plateId: "plate-1",
    status: "REVIEW_REQUIRED",
    manualReviewRequired: true,
    createdAt: "2026-06-23T00:00:00.000Z",
    imageReference: "/plate.png",
    uploadedByUserId: "tech-1",
    uploader: { id: "tech-1", name: "Tech One", email: "tech@example.test" },
    reviewWaitingMinutes: 30,
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
      imageReference: "/plate.png",
      modelVersion: "opencv-mvp",
      qcScore: 0.92,
      qcFlags: {},
      detectedWells: 96,
      plateConfidence: 1,
      createdAt: "2026-06-23T00:01:00.000Z",
      wells: makeWells(1),
    },
    overrides: [],
    reviews: [],
    ...patch,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock({
  role = "REVIEWER",
  assessment = makeAssessment(),
  approveStatus = 200,
  rejectStatus = 200,
  approveDelayMs = 0,
}: {
  role?: UserRole;
  assessment?: ImageReviewAssessmentSummary;
  approveStatus?: number;
  rejectStatus?: number;
  approveDelayMs?: number;
} = {}) {
  const approveCalls: RequestInit[] = [];
  const rejectCalls: RequestInit[] = [];
  const overrideCalls: RequestInit[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/me") {
      return jsonResponse({ user: { userId: "reviewer-1", organizationId: "org-a", role, sessionId: "session-1" } });
    }
    if (url.startsWith("/api/breakpoint-sets?")) {
      return jsonResponse({
        breakpointSets: [{
          id: "bps-1",
          standard: "CLSI",
          version: "2026.1",
          organism: "E. coli",
          unit: "mg/L",
          method: "BROTH_MICRODILUTION",
          status: "APPROVED",
          effectiveFrom: null,
          effectiveTo: null,
          approvedAt: "2026-01-01T00:00:00.000Z",
          approvedByUserId: "admin-1",
          retiredAt: null,
          retireReason: null,
          supersedesBreakpointSetId: null,
          contentHash: "a".repeat(64),
          revision: 1,
          ruleCount: 1,
        }],
      });
    }
    if (url.startsWith("/api/image-assessments?")) {
      if (role === "TECHNICIAN") return jsonResponse({ error: { code: "FORBIDDEN", message: "権限不足です。" } }, 403);
      return jsonResponse({ assessments: [assessment], page: { limit: 25, offset: 0, total: 1 } });
    }
    if (url === "/api/image-assessments/assessment-1") {
      return jsonResponse({ assessment: { ...assessment, status: "APPROVED", manualReviewRequired: false } });
    }
    if (url.endsWith("/override")) {
      overrideCalls.push(init ?? {});
      return jsonResponse({ kind: "overridden" });
    }
    if (url.endsWith("/approve")) {
      approveCalls.push(init ?? {});
      if (approveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, approveDelayMs));
      if (approveStatus === 409) {
        return jsonResponse({ error: { code: "CONFLICT", message: "他のユーザーが先にレビューしました。" } }, 409);
      }
      if (approveStatus !== 200) {
        return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "承認に失敗しました。" } }, approveStatus);
      }
      return jsonResponse({ kind: "approved", status: "APPROVED" });
    }
    if (url.endsWith("/reject")) {
      rejectCalls.push(init ?? {});
      if (rejectStatus !== 200) return jsonResponse({ error: { code: "INTERNAL_ERROR", message: "差戻しに失敗しました。" } }, rejectStatus);
      return jsonResponse({ kind: "rejected", status: "REJECTED" });
    }
    return jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, approveCalls, rejectCalls, overrideCalls };
}

async function renderLoaded(options?: Parameters<typeof installFetchMock>[0]) {
  const mocks = installFetchMock(options);
  render(<ImageReviewWorkspace />);
  await screen.findByText("S-001");
  return mocks;
}

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageReviewWorkspace", () => {
  it("does not call APIs when the feature flag disables the screen", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ImageReviewWorkspace enabled={false} />);
    expect(screen.getByText("画像レビューは無効です")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not show approve controls for TECHNICIAN", async () => {
    installFetchMock({ role: "TECHNICIAN" });
    render(<ImageReviewWorkspace />);
    expect(await screen.findByText("この画面はREVIEWERまたはADMINのみ利用できます。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "承認" })).not.toBeInTheDocument();
  });

  it("shows an in-organization REVIEW_REQUIRED assessment for REVIEWER", async () => {
    await renderLoaded();
    expect(screen.getAllByText("E. coli")[0]).toBeInTheDocument();
    expect(screen.getAllByText(/organization Org A/)[0]).toBeInTheDocument();
  });

  it("requires manual review even when confidence is 1.0", async () => {
    await renderLoaded({ assessment: makeAssessment({ prediction: { ...makeAssessment().prediction!, plateConfidence: 1, wells: makeWells(1) } }) });
    expect(screen.getByRole("button", { name: "承認" })).toBeDisabled();
    expect(screen.getByText("0/96")).toBeInTheDocument();
  });

  it("blocks an override without a reason", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId("well-A1"));
    const dialog = await screen.findByRole("dialog", { name: "ウェル確認" });
    fireEvent.change(within(dialog).getByLabelText("確定状態"), { target: { value: "GROWTH" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "確認を保存" }));
    expect(await within(dialog).findByText("override理由を入力してください。")).toBeInTheDocument();
  });

  it("shows APPROVED only after the approve API succeeds", async () => {
    const { approveCalls } = await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "未確認を予測通り確認" }));
    fireEvent.click(screen.getByRole("button", { name: "承認" }));
    await screen.findByText("画像レビューを承認しました。");
    expect(approveCalls).toHaveLength(1);
    expect(screen.getAllByText("APPROVED")[0]).toBeInTheDocument();
  });

  it("does not show success when approve API fails", async () => {
    await renderLoaded({ approveStatus: 500 });
    fireEvent.click(screen.getByRole("button", { name: "未確認を予測通り確認" }));
    fireEvent.click(screen.getByRole("button", { name: "承認" }));
    expect(await screen.findByText("承認に失敗しました。")).toBeInTheDocument();
    expect(screen.queryByText("画像レビューを承認しました。")).not.toBeInTheDocument();
  });

  it("shows reload guidance and latest status on 409 conflict", async () => {
    await renderLoaded({ approveStatus: 409 });
    fireEvent.click(screen.getByRole("button", { name: "未確認を予測通り確認" }));
    fireEvent.click(screen.getByRole("button", { name: "承認" }));
    expect(await screen.findByText("競合を検出しました")).toBeInTheDocument();
    expect(screen.getByText("サーバー最新状態: APPROVED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最新状態を表示" })).toBeInTheDocument();
  });

  it("prevents double submit on approve", async () => {
    const { approveCalls } = await renderLoaded({ approveDelayMs: 50 });
    fireEvent.click(screen.getByRole("button", { name: "未確認を予測通り確認" }));
    const approveButton = screen.getByRole("button", { name: "承認" });
    fireEvent.click(approveButton);
    fireEvent.click(approveButton);
    await waitFor(() => expect(approveCalls).toHaveLength(1));
  });

  it("requires a reject reason", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "差戻し" }));
    expect(await screen.findByText("差戻し理由または再撮影依頼理由を入力してください。")).toBeInTheDocument();
  });

  it("moves focus with arrow keys and exposes well names", async () => {
    await renderLoaded();
    const a1 = screen.getByTestId("well-A1");
    a1.focus();
    fireEvent.keyDown(a1, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("well-A2")).toHaveFocus());
    expect(screen.getByTestId("well-H12")).toHaveAccessibleName(/H12/);
  });

  it("traps modal focus, closes on Escape, and restores focus", async () => {
    await renderLoaded();
    const a1 = screen.getByTestId("well-A1");
    fireEvent.click(a1);
    const dialog = await screen.findByRole("dialog", { name: "ウェル確認" });
    await waitFor(() => expect(within(dialog).getByLabelText("確定状態")).toHaveFocus());
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "ウェル確認" })).not.toBeInTheDocument());
    await waitFor(() => expect(a1).toHaveFocus());
  });

  it("warns before leaving with unsaved review changes", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "未確認を予測通り確認" }));
    const event = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(event)).toBe(false);
  });
});
