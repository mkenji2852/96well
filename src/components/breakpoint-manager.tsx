"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { COMMON_ORGANISMS } from "@/lib/organisms";
import type { BreakpointRuleView, BreakpointSetView, UserRole } from "@/types/domain";

type Detail = BreakpointSetView & {
  rules: BreakpointRuleView[];
  createdBy?: { id: string; name: string } | null;
  approvedBy?: { id: string; name: string } | null;
  retiredBy?: { id: string; name: string } | null;
  supersedes?: (BreakpointSetView & { rules: BreakpointRuleView[] }) | null;
};

type ModalState =
  | { kind: "approve" }
  | { kind: "retire" }
  | { kind: "clone" }
  | null;

function apiMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string") return error.message;
  }
  return fallback;
}

function dateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function toIso(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text ? new Date(`${text}T00:00:00.000Z`).toISOString() : null;
}

function optionalNumber(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function interpretationLabel(rule: Pick<BreakpointRuleView, "susceptibleMax" | "intermediateMin" | "intermediateMax" | "resistantMin">): string {
  const iMin = rule.intermediateMin;
  const iMax = rule.intermediateMax;
  const intermediate = iMin == null && iMax == null
    ? `${rule.susceptibleMax} < I < ${rule.resistantMin}`
    : iMin === iMax
      ? `I = ${iMin}`
      : `I ${iMin ?? `>${rule.susceptibleMax}`}–${iMax ?? `<${rule.resistantMin}`}`;
  return `S ≤ ${rule.susceptibleMax} / ${intermediate} / R ≥ ${rule.resistantMin}`;
}

function exampleInterpretation(rule: Pick<BreakpointRuleView, "susceptibleMax" | "intermediateMin" | "intermediateMax" | "resistantMin">): string {
  const value = rule.intermediateMin ?? rule.intermediateMax ?? (rule.susceptibleMax + rule.resistantMin) / 2;
  if (value <= rule.susceptibleMax) return `MIC=${value} → S`;
  if (value >= rule.resistantMin) return `MIC=${value} → R`;
  return `MIC=${value} → I`;
}

function ruleKey(rule: BreakpointRuleView): string {
  return [rule.drugName, rule.organism ?? "", rule.unit, rule.method].join("|");
}

function diffRules(current: Detail): Array<{ kind: string; message: string }> {
  if (!current.supersedes) return [];
  const previousByKey = new Map(current.supersedes.rules.map((rule) => [ruleKey(rule), rule]));
  const currentByKey = new Map(current.rules.map((rule) => [ruleKey(rule), rule]));
  const changes: Array<{ kind: string; message: string }> = [];
  for (const [key, rule] of currentByKey) {
    const previous = previousByKey.get(key);
    if (!previous) {
      changes.push({ kind: "追加", message: `${rule.drugName} (${rule.organism ?? "全菌種"})` });
      continue;
    }
    const fields: string[] = [];
    if (previous.susceptibleMax !== rule.susceptibleMax) fields.push(`S境界 ${previous.susceptibleMax} → ${rule.susceptibleMax}`);
    if (previous.resistantMin !== rule.resistantMin) fields.push(`R境界 ${previous.resistantMin} → ${rule.resistantMin}`);
    if (previous.unit !== rule.unit) fields.push(`単位 ${previous.unit} → ${rule.unit}`);
    if (previous.organism !== rule.organism) fields.push(`菌種 ${previous.organism ?? "全菌種"} → ${rule.organism ?? "全菌種"}`);
    if (fields.length > 0) changes.push({ kind: "変更", message: `${rule.drugName}: ${fields.join("、")}` });
  }
  for (const [key, rule] of previousByKey) {
    if (!currentByKey.has(key)) changes.push({ kind: "削除", message: `${rule.drugName} (${rule.organism ?? "全菌種"})` });
  }
  if (
    current.effectiveFrom !== current.supersedes.effectiveFrom ||
    current.effectiveTo !== current.supersedes.effectiveTo
  ) {
    changes.push({
      kind: "変更",
      message: `有効期間 ${dateInput(current.supersedes.effectiveFrom)}〜${dateInput(current.supersedes.effectiveTo)} → ${dateInput(current.effectiveFrom)}〜${dateInput(current.effectiveTo)}`,
    });
  }
  return changes;
}

function ConfirmationModal({
  title,
  children,
  busy,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button,input,textarea,select,[tabindex]:not([tabindex='-1'])")]
        .filter((item) => !item.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [busy, onClose]);
  return (
    <div className="modal-backdrop breakpoint-modal-backdrop">
      <div ref={dialogRef} className="well-modal breakpoint-modal" role="dialog" aria-modal="true" aria-labelledby="breakpoint-modal-title">
        <header><h2 id="breakpoint-modal-title">{title}</h2></header>
        <div className="breakpoint-modal-body">{children}</div>
        <div className="modal-actions breakpoint-modal-actions">
          <button ref={firstRef} type="button" className="secondary-button" disabled={busy} onClick={onClose}>キャンセル</button>
          <button type="button" className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? "処理中…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function BreakpointManager() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [sets, setSets] = useState<BreakpointSetView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [retireReason, setRetireReason] = useState("");
  const [cloneVersion, setCloneVersion] = useState("");
  const [editingRule, setEditingRule] = useState<BreakpointRuleView | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const isAdmin = role === "ADMIN";
  const diff = useMemo(() => detail ? diffRules(detail) : [], [detail]);
  const breakpointOrganismDatalistId = "breakpoint-common-organisms";

  const loadList = async () => {
    const params = statusFilter ? `?status=${statusFilter}` : "";
    const response = await fetch(`/api/breakpoint-sets${params}`);
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiMessage(data, "一覧の取得に失敗しました。"));
    const next = (data?.breakpointSets ?? []) as BreakpointSetView[];
    setSets(next);
    if (!selectedId && next[0]) setSelectedId(next[0].id);
  };

  const loadDetail = async (id: string) => {
    if (!id) return;
    const response = await fetch(`/api/breakpoint-sets/${id}`);
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiMessage(data, "詳細の取得に失敗しました。"));
    setDetail(data.breakpointSet as Detail);
  };

  useEffect(() => {
    Promise.all([
      fetch("/api/me").then(async (response) => response.ok ? response.json() : Promise.reject(new Error("ログインが必要です。"))),
      fetch("/api/breakpoint-sets").then(async (response) => response.ok ? response.json() : Promise.reject(new Error("一覧の取得に失敗しました。"))),
    ]).then(([me, list]) => {
      setRole(me.user.role);
      const next = (list.breakpointSets ?? []) as BreakpointSetView[];
      setSets(next);
      if (next[0]) setSelectedId(next[0].id);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "初期化に失敗しました。"));
  }, []);

  useEffect(() => {
    loadDetail(selectedId).catch((caught) => setError(caught instanceof Error ? caught.message : "詳細の取得に失敗しました。"));
  }, [selectedId]);

  useEffect(() => {
    loadList().catch((caught) => setError(caught instanceof Error ? caught.message : "一覧の取得に失敗しました。"));
  }, [statusFilter]);

  const request = async (url: string, method: string, body: unknown, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(data, "操作に失敗しました。"));
      const next = data.breakpointSet as BreakpointSetView | undefined;
      if (next?.id) setSelectedId(next.id);
      await loadList();
      await loadDetail(next?.id ?? selectedId);
      setNotice(success);
      setModal(null);
      window.setTimeout(() => triggerRef.current?.focus(), 0);
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作に失敗しました。");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const createSet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = await request("/api/breakpoint-sets", "POST", {
      standard: form.get("standard"),
      version: form.get("version"),
      organism: String(form.get("organism") ?? "").trim() || null,
      unit: form.get("unit"),
      method: form.get("method"),
      effectiveFrom: toIso(form.get("effectiveFrom")),
      effectiveTo: toIso(form.get("effectiveTo")),
    }, "DRAFTを作成しました。");
    if (data) event.currentTarget.reset();
  };

  const updateSet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    await request(`/api/breakpoint-sets/${detail.id}`, "PATCH", {
      expectedRevision: detail.revision,
      standard: form.get("standard"),
      version: form.get("version"),
      organism: String(form.get("organism") ?? "").trim() || null,
      unit: form.get("unit"),
      method: form.get("method"),
      effectiveFrom: toIso(form.get("effectiveFrom")),
      effectiveTo: toIso(form.get("effectiveTo")),
    }, "DRAFTを更新しました。");
  };

  const addRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    const data = await request(`/api/breakpoint-sets/${detail.id}/rules`, "POST", {
      expectedRevision: detail.revision,
      drugName: form.get("drugName"),
      organism: detail.organism,
      susceptibleMax: Number(form.get("susceptibleMax")),
      resistantMin: Number(form.get("resistantMin")),
      intermediateMin: optionalNumber(form.get("intermediateMin")),
      intermediateMax: optionalNumber(form.get("intermediateMax")),
      unit: detail.unit,
      method: detail.method,
      exceptionJson: null,
    }, "ruleを追加しました。");
    if (data) event.currentTarget.reset();
  };

  const updateRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail || !editingRule) return;
    const form = new FormData(event.currentTarget);
    const data = await request(`/api/breakpoint-sets/${detail.id}/rules/${editingRule.id}`, "PATCH", {
      expectedRevision: detail.revision,
      drugName: form.get("drugName"),
      organism: detail.organism,
      susceptibleMax: Number(form.get("susceptibleMax")),
      resistantMin: Number(form.get("resistantMin")),
      intermediateMin: optionalNumber(form.get("intermediateMin")),
      intermediateMax: optionalNumber(form.get("intermediateMax")),
      unit: detail.unit,
      method: detail.method,
      exceptionJson: editingRule.exceptionJson,
    }, "ruleを更新しました。");
    if (data) setEditingRule(null);
  };

  const openModal = (kind: NonNullable<ModalState>["kind"], trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setModal({ kind } as ModalState);
  };

  return (
    <main className="breakpoint-page">
      <header className="app-header">
        <a className="brand-copy brand-link" href="/"><strong>MIC Plate</strong><small>RECORDER</small></a>
        <span className="review-role-badge">{role ?? "確認中"}</span>
      </header>
      <section className="breakpoint-hero">
        <div><p className="eyebrow">Versioned clinical rules</p><h1>BreakpointSet管理</h1><p>承認済みルールは変更せず、変更は必ず新しいDRAFT版として作成します。</p></div>
      </section>
      {error && <p className="plate-validation" role="alert">{error}</p>}
      {notice && <p className="breakpoint-notice" role="status">{notice}</p>}

      <section className="breakpoint-layout">
        <aside className="breakpoint-list-panel">
          <div className="panel-title-row"><h2>一覧</h2><span>{sets.length}</span></div>
          <label>状態
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">すべて</option><option value="DRAFT">DRAFT</option><option value="APPROVED">APPROVED</option><option value="RETIRED">RETIRED</option>
            </select>
          </label>
          <div className="breakpoint-set-list">
            {sets.map((set) => (
              <button key={set.id} type="button" className={selectedId === set.id ? "breakpoint-set-card active" : "breakpoint-set-card"} onClick={() => setSelectedId(set.id)}>
                <span className={`status-chip status-${set.status.toLowerCase()}`}>{set.status}</span>
                <strong>{set.standard} {set.version}</strong>
                <small>{set.organism ?? "全菌種"} / {set.ruleCount} rules</small>
                <small>{dateInput(set.effectiveFrom) || "開始未設定"} 〜 {dateInput(set.effectiveTo) || "終了未設定"}</small>
                <code>{set.contentHash ? set.contentHash.slice(0, 12) : "hash未確定"}</code>
              </button>
            ))}
          </div>
        </aside>

        <div className="breakpoint-main-panel">
          <datalist id={breakpointOrganismDatalistId}>
            {COMMON_ORGANISMS.map((name) => <option value={name} key={name} />)}
          </datalist>
          {isAdmin && (
            <details className="breakpoint-create-panel">
              <summary>新しいDRAFTを作成</summary>
              <form className="breakpoint-form" onSubmit={createSet}>
                <label>Standard<select name="standard" defaultValue="CLSI"><option>CLSI</option><option>EUCAST</option><option>JANIS_COMPAT</option></select></label>
                <label>Version<input name="version" required /></label>
                <label>Organism<input name="organism" list={breakpointOrganismDatalistId} placeholder="Escherichia coli" /></label>
                <label>Unit<input name="unit" defaultValue="µg/mL" required /></label>
                <label>Method<input name="method" defaultValue="BROTH_MICRODILUTION" required /></label>
                <label>Effective from<input name="effectiveFrom" type="date" /></label>
                <label>Effective to<input name="effectiveTo" type="date" /></label>
                <button className="primary-button" disabled={busy}>DRAFT作成</button>
              </form>
            </details>
          )}

          {!detail ? <p>BreakpointSetを選択してください。</p> : (
            <>
              <div className="breakpoint-detail-head">
                <div><span className={`status-chip status-${detail.status.toLowerCase()}`}>{detail.status}</span><h2>{detail.standard} {detail.version}</h2></div>
                <div className="breakpoint-actions">
                  {isAdmin && detail.status === "DRAFT" && <button type="button" className="primary-button" onClick={(event) => openModal("approve", event.currentTarget)}>承認</button>}
                  {isAdmin && detail.status === "APPROVED" && <button type="button" className="secondary-button danger-action" onClick={(event) => openModal("retire", event.currentTarget)}>失効</button>}
                  {isAdmin && <button type="button" className="secondary-button" onClick={(event) => openModal("clone", event.currentTarget)}>clone</button>}
                </div>
              </div>
              <dl className="breakpoint-metadata">
                <div><dt>Organism</dt><dd>{detail.organism ?? "全菌種"}</dd></div>
                <div><dt>Method / Unit</dt><dd>{detail.method} / {detail.unit}</dd></div>
                <div><dt>承認者</dt><dd>{detail.approvedBy?.name ?? detail.approvedByUserId ?? "—"}</dd></div>
                <div><dt>承認日時</dt><dd>{detail.approvedAt ? new Date(detail.approvedAt).toLocaleString("ja-JP") : "—"}</dd></div>
                <div><dt>Content hash</dt><dd><code>{detail.contentHash ?? "DRAFTのため未確定"}</code></dd></div>
                <div><dt>Revision</dt><dd>{detail.revision}</dd></div>
              </dl>

              {isAdmin && detail.status === "DRAFT" && (
                <form className="breakpoint-form breakpoint-edit-form" onSubmit={updateSet}>
                  <label>Standard<select name="standard" defaultValue={detail.standard} key={`standard-${detail.id}-${detail.revision}`}><option>CLSI</option><option>EUCAST</option><option>JANIS_COMPAT</option></select></label>
                  <label>Version<input name="version" defaultValue={detail.version} key={`version-${detail.id}-${detail.revision}`} required /></label>
                  <label>Organism<input name="organism" list={breakpointOrganismDatalistId} defaultValue={detail.organism ?? ""} key={`organism-${detail.id}-${detail.revision}`} placeholder="Escherichia coli" /></label>
                  <label>Unit<input name="unit" defaultValue={detail.unit} key={`unit-${detail.id}-${detail.revision}`} required /></label>
                  <label>Method<input name="method" defaultValue={detail.method} key={`method-${detail.id}-${detail.revision}`} required /></label>
                  <label>Effective from<input name="effectiveFrom" type="date" defaultValue={dateInput(detail.effectiveFrom)} key={`from-${detail.id}-${detail.revision}`} /></label>
                  <label>Effective to<input name="effectiveTo" type="date" defaultValue={dateInput(detail.effectiveTo)} key={`to-${detail.id}-${detail.revision}`} /></label>
                  <button className="secondary-button" disabled={busy}>本体を更新</button>
                </form>
              )}

              <section aria-labelledby="rules-title">
                <div className="panel-title-row"><h3 id="rules-title">Rules</h3><span>{detail.rules.length}</span></div>
                <div className="breakpoint-rule-table-wrap">
                  <table className="breakpoint-rule-table">
                    <thead><tr><th>Drug</th><th>Organism</th><th>S/I/R breakpoint</th><th>Example</th><th>Unit</th><th>操作</th></tr></thead>
                    <tbody>{detail.rules.map((rule) => (
                      <tr key={rule.id}>
                        <td>{rule.drugName}</td><td>{rule.organism ?? "全菌種"}</td><td>{interpretationLabel(rule)}</td><td>{exampleInterpretation(rule)}</td><td>{rule.unit}</td>
                        <td>{isAdmin && detail.status === "DRAFT"
                          ? <span className="rule-row-actions">
                            <button type="button" className="text-button" onClick={() => setEditingRule(rule)}>編集</button>
                            <button type="button" className="text-button" onClick={() => request(`/api/breakpoint-sets/${detail.id}/rules/${rule.id}`, "DELETE", { expectedRevision: detail.revision }, "ruleを削除しました。")}>削除</button>
                          </span>
                          : <span>変更不可</span>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                {isAdmin && detail.status === "DRAFT" && (
                  <>
                    {editingRule && (
                      <form className="breakpoint-form rule-add-form rule-edit-form" onSubmit={updateRule}>
                        <label>Drug<input name="drugName" defaultValue={editingRule.drugName} required /></label>
                        <label>S ≤<input name="susceptibleMax" type="number" step="any" min="0" defaultValue={editingRule.susceptibleMax} required /></label>
                        <label>I min<input name="intermediateMin" type="number" step="any" min="0" defaultValue={editingRule.intermediateMin ?? ""} placeholder="例: 8" /></label>
                        <label>I max<input name="intermediateMax" type="number" step="any" min="0" defaultValue={editingRule.intermediateMax ?? ""} placeholder="例: 8" /></label>
                        <label>R ≥<input name="resistantMin" type="number" step="any" min="0" defaultValue={editingRule.resistantMin} required /></label>
                        <div className="rule-edit-actions">
                          <button type="button" className="secondary-button" onClick={() => setEditingRule(null)}>取消</button>
                          <button className="primary-button" disabled={busy}>rule更新</button>
                        </div>
                      </form>
                    )}
                    <form className="breakpoint-form rule-add-form" onSubmit={addRule}>
                      <label>Drug<input name="drugName" required placeholder="Ampicillin" /></label>
                      <label>S ≤<input name="susceptibleMax" type="number" step="any" min="0" required placeholder="4" /></label>
                      <label>I min<input name="intermediateMin" type="number" step="any" min="0" placeholder="8" /></label>
                      <label>I max<input name="intermediateMax" type="number" step="any" min="0" placeholder="8" /></label>
                      <label>R ≥<input name="resistantMin" type="number" step="any" min="0" required placeholder="16" /></label>
                      <button className="primary-button" disabled={busy}>rule追加</button>
                    </form>
                    <p className="muted-text breakpoint-input-help">
                      例: Ampicillin が S≤4 / I=8 / R≥16 の場合は、S ≤ に 4、I min と I max に 8、R ≥ に 16 を入力します。MICが8なら “I” と判定されます。
                    </p>
                  </>
                )}
              </section>

              {detail.supersedes && (
                <section className="breakpoint-diff" aria-labelledby="diff-title">
                  <h3 id="diff-title">版間diff: {detail.supersedes.version} → {detail.version}</h3>
                  {diff.length === 0 ? <p>内容差分はありません。</p> : <ul>{diff.map((item, index) => <li key={`${item.kind}-${index}`}><strong>{item.kind}</strong>: {item.message}</li>)}</ul>}
                </section>
              )}
            </>
          )}
        </div>
      </section>

      {modal === null ? null : (
        <ConfirmationModal
          title={modal.kind === "approve" ? "BreakpointSetを承認" : modal.kind === "retire" ? "BreakpointSetを失効" : "新しいDRAFTへclone"}
          busy={busy}
          confirmLabel={modal.kind === "approve" ? "承認する" : modal.kind === "retire" ? "失効する" : "clone作成"}
          onClose={() => { setModal(null); window.setTimeout(() => triggerRef.current?.focus(), 0); }}
          onConfirm={() => {
            if (!detail) return;
            if (modal.kind === "approve") void request(`/api/breakpoint-sets/${detail.id}/approve`, "POST", { expectedRevision: detail.revision }, "承認しました。");
            if (modal.kind === "retire") {
              if (!retireReason.trim()) {
                setError("失効理由を入力してください。");
                document.getElementById("retire-reason")?.focus();
                return;
              }
              void request(`/api/breakpoint-sets/${detail.id}/retire`, "POST", { expectedRevision: detail.revision, reason: retireReason }, "失効しました。");
            }
            if (modal.kind === "clone") {
              if (!cloneVersion.trim()) {
                setError("新しいversionを入力してください。");
                document.getElementById("clone-version")?.focus();
                return;
              }
              void request(`/api/breakpoint-sets/${detail.id}/clone`, "POST", { version: cloneVersion }, "cloneを作成しました。");
            }
          }}
        >
          {modal.kind === "approve" && <p>承認後は本体とruleを変更できません。変更にはcloneと新しいversionが必要です。</p>}
          {modal.kind === "retire" && <label htmlFor="retire-reason">失効理由<textarea id="retire-reason" value={retireReason} onChange={(event) => setRetireReason(event.target.value)} required /></label>}
          {modal.kind === "clone" && <label htmlFor="clone-version">新しいversion<input id="clone-version" value={cloneVersion} onChange={(event) => setCloneVersion(event.target.value)} required /></label>}
        </ConfirmationModal>
      )}
    </main>
  );
}
