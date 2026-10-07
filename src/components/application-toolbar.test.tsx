// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationToolbar, useApplicationToolbar } from "./application-toolbar";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Screen({ onHome, busy = false }: { onHome: () => void; busy?: boolean }) {
  const refresh = useApplicationToolbar(onHome, busy);
  return <button onClick={() => void refresh?.()}>ユーザー再確認</button>;
}

describe("common application toolbar", () => {
  it("shows the authenticated profile and clears it after logout", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: {
        userId: "user-a", name: "Researcher", email: "research@example.test",
        role: "TECHNICIAN", organizationId: "org-a", organizationName: "Research Org",
      } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 })));
    render(<ApplicationToolbar><Screen onHome={vi.fn()} /></ApplicationToolbar>);
    expect(await screen.findByText("ログイン中: Researcher")).toBeVisible();
    expect(screen.getByText("research@example.test")).toBeVisible();
    expect(screen.getByText("TECHNICIAN · Research Org")).toBeVisible();
    fireEvent.click(screen.getByText("ユーザー再確認"));
    expect(await screen.findByText("未ログイン")).toBeVisible();
    expect(screen.queryByText("ログイン中: Researcher")).not.toBeInTheDocument();
  });
  it("uses the screen home action and prevents leaving during a write", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    const onHome = vi.fn();
    const { rerender } = render(<ApplicationToolbar><Screen onHome={onHome} /></ApplicationToolbar>);
    fireEvent.click(screen.getByRole("button", { name: "初期画面へ戻る" }));
    expect(onHome).toHaveBeenCalledTimes(1);
    rerender(<ApplicationToolbar><Screen onHome={onHome} busy /></ApplicationToolbar>);
    await waitFor(() => expect(screen.getByRole("button", { name: "初期画面へ戻る" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "初期画面へ戻る" }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });
  it("shows an explicit error if the identity cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<ApplicationToolbar><p>Page</p></ApplicationToolbar>);
    expect(await screen.findByText("ログイン情報を取得できません")).toBeVisible();
    expect(screen.getByRole("link", { name: "初期画面へ戻る" })).toHaveAttribute("href", "/");
  });
});
