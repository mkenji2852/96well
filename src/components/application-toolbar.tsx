"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { UserRole } from "@/types/domain";

interface ToolbarUser {
  userId: string;
  role: UserRole;
  name?: string;
  email?: string;
  organizationName?: string;
  organizationId: string;
}

type HomeAction = { onHome: () => void; busy?: boolean };
const ToolbarContext = createContext<{
  registerHome: (action: HomeAction) => () => void;
  refreshUser: () => Promise<void>;
} | null>(null);

export function useApplicationToolbar(onHome?: () => void, busy = false) {
  const context = useContext(ToolbarContext);
  const registerHome = context?.registerHome;
  useEffect(() => {
    if (onHome && registerHome) return registerHome({ onHome, busy });
  }, [onHome, busy, registerHome]);
  return context?.refreshUser;
}

export function ApplicationToolbar({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ToolbarUser | null>(null);
  const [status, setStatus] = useState("ログイン状態を確認中…");
  const [homeAction, setHomeAction] = useState<HomeAction | null>(null);
  const requestVersion = useRef(0);
  const refreshUser = useCallback(async () => {
    const version = ++requestVersion.current;
    setUser(null);
    setStatus("ログイン状態を確認中…");
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      const data = await response.json();
      if (version !== requestVersion.current) return;
      if (response.ok && data.user?.userId) {
        setUser(data.user);
        setStatus("");
      } else setStatus(response.status === 401 ? "未ログイン" : "ログイン情報を取得できません");
    } catch {
      if (version === requestVersion.current) setStatus("ログイン情報を取得できません");
    }
  }, []);
  useEffect(() => { void refreshUser(); }, [refreshUser]);
  const registerHome = useCallback((action: HomeAction) => {
    setHomeAction(action);
    return () => setHomeAction((current) => current === action ? null : current);
  }, []);
  const context = useMemo(() => ({ registerHome, refreshUser }), [registerHome, refreshUser]);

  return (
    <ToolbarContext.Provider value={context}>
      <nav className="application-toolbar" aria-label="共通ツールバー">
        {homeAction ? (
          <button type="button" className="toolbar-home" onClick={homeAction.onHome} disabled={homeAction.busy}>初期画面へ戻る</button>
        ) : <Link href="/" className="toolbar-home">初期画面へ戻る</Link>}
        <div className="toolbar-user" role="status">
          {user ? <>
            <strong>ログイン中: {user.name || user.email || user.userId}</strong>
            {user.email && <span>{user.email}</span>}
            <span>{user.role} · {user.organizationName || user.organizationId}</span>
          </> : <span>{status}</span>}
        </div>
      </nav>
      {children}
    </ToolbarContext.Provider>
  );
}
