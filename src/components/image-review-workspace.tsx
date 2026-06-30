"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { apiWellStateToReviewState, REVIEW_WELL_STATES, reviewStateLabels, reviewStateToApiWellState, wellKey, wellName } from "@/lib/image-review-ui";
import { ROW_LABELS, type BreakpointSetView, type UserRole } from "@/types/domain";
import type { ImageReviewAssessmentSummary, ImageReviewListResponse, ReviewWellState } from "@/types/image-review";

const PLATE_ROWS = 8;
const PLATE_COLUMNS = 12;

interface AuthenticatedViewer {
  userId: string;
  organizationId: string;
  role: UserRole;
  sessionId: string;
}

interface ReviewDraftWell {
  state: ReviewWellState;
  confirmed: boolean;
  reason: string;
  overrideSaved: boolean;
}

type ReviewDraftMap = Record<string, ReviewDraftWell>;

class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function canReview(role: UserRole | undefined): boolean {
  return role === "REVIEWER" || role === "ADMIN";
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      data?.error?.code ?? String(response.status),
      data?.error?.message ?? errorMessageForStatus(response.status),
    );
  }
  return data as T;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  return readJson<T>(response);
}

function errorMessageForStatus(status: number): string {
  if (status === 401) return "ログイン状態を確認してください。";
  if (status === 403) return "この操作を行う権限がありません。";
  if (status === 404) return "対象が存在しない、または他施設のデータです。";
  if (status === 409) return "他のユーザーが先にレビューしました。最新データを再読込してください。";
  if (status === 400 || status === 422) return "入力内容を確認してください。";
  return "操作に失敗しました。時間をおいて再試行してください。";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "未記録";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}時間${rest}分` : `${hours}時間`;
}

function cloneDraft(draft: ReviewDraftMap): ReviewDraftMap {
  return Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, { ...value }]));
}

function predictionMap(assessment: ImageReviewAssessmentSummary | null) {
  return new Map((assessment?.prediction?.wells ?? []).map((well) => [wellKey(well.rowIndex, well.columnIndex), well]));
}

function latestOverrideMap(assessment: ImageReviewAssessmentSummary | null) {
  const map = new Map<string, ImageReviewAssessmentSummary["overrides"][number]>();
  for (const override of assessment?.overrides ?? []) map.set(wellKey(override.rowIndex, override.columnIndex), override);
  return map;
}

function createDraft(assessment: ImageReviewAssessmentSummary | null): ReviewDraftMap {
  const predictions = predictionMap(assessment);
  const overrides = latestOverrideMap(assessment);
  const draft: ReviewDraftMap = {};
  for (let rowIndex = 0; rowIndex < PLATE_ROWS; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < PLATE_COLUMNS; columnIndex += 1) {
      const key = wellKey(rowIndex, columnIndex);
      const prediction = predictions.get(key);
      const override = overrides.get(key);
      draft[key] = {
        state: override
          ? apiWellStateToReviewState(override.afterState)
          : prediction ? apiWellStateToReviewState(prediction.state) : "UNCERTAIN",
        confirmed: Boolean(override),
        reason: override?.reason ?? "",
        overrideSaved: Boolean(override),
      };
    }
  }
  return draft;
}

function isRenderableImageReference(reference: string | null | undefined): reference is string {
  return Boolean(reference && (/^(https?:|data:|\/)/.test(reference)));
}

function summarizeLocalChanges(draft: ReviewDraftMap, assessment: ImageReviewAssessmentSummary | null): string {
  const predictions = predictionMap(assessment);
  const changed = Object.entries(draft)
    .filter(([key, value]) => {
      const predicted = predictions.get(key);
      const predictedState = predicted ? apiWellStateToReviewState(predicted.state) : "UNCERTAIN";
      return value.confirmed && value.state !== predictedState;
    })
    .map(([key, value]) => {
      const [rowIndex, columnIndex] = key.split(":").map(Number);
      return `${wellName(rowIndex, columnIndex)}:${reviewStateLabels[value.state].short}`;
    });
  return changed.length > 0 ? changed.join(" / ") : "overrideなし";
}

interface ModalDraft {
  state: ReviewWellState;
  reason: string;
}

export function ImageReviewWorkspace({ enabled = true }: { enabled?: boolean }) {
  const [user, setUser] = useState<AuthenticatedViewer | null>(null);
  const [assessments, setAssessments] = useState<ImageReviewAssessmentSummary[]>([]);
  const [activeAssessment, setActiveAssessment] = useState<ImageReviewAssessmentSummary | null>(null);
  const [draft, setDraft] = useState<ReviewDraftMap>(() => createDraft(null));
  const [history, setHistory] = useState<ReviewDraftMap[]>([]);
  const [activeKey, setActiveKey] = useState(wellKey(0, 0));
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [modalDraft, setModalDraft] = useState<ModalDraft>({ state: "UNCERTAIN", reason: "" });
  const [modalError, setModalError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [conflictMessage, setConflictMessage] = useState("");
  const [serverLatest, setServerLatest] = useState<ImageReviewAssessmentSummary | null>(null);
  const [conflictSnapshot, setConflictSnapshot] = useState("");
  const [submittingAction, setSubmittingAction] = useState<"approve" | "reject" | "override" | null>(null);
  const submittingRef = useRef(false);
  const [filters, setFilters] = useState({ organism: "", uploaderUserId: "", from: "", to: "" });
  const [breakpointSetId, setBreakpointSetId] = useState("");
  const [breakpointSets, setBreakpointSets] = useState<BreakpointSetView[]>([]);
  const [breakpointChangeReason, setBreakpointChangeReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const stateSelectRef = useRef<HTMLSelectElement | null>(null);
  const wellRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const predictions = useMemo(() => predictionMap(activeAssessment), [activeAssessment]);
  const lockedByConflict = Boolean(serverLatest && serverLatest.status !== "REVIEW_REQUIRED");
  const isEditable = Boolean(
    activeAssessment &&
    activeAssessment.status === "REVIEW_REQUIRED" &&
    !lockedByConflict &&
    canReview(user?.role),
  );
  const confirmedCount = Object.values(draft).filter((well) => well.confirmed).length;
  const allRequiredReviewed = confirmedCount === PLATE_ROWS * PLATE_COLUMNS;
  const overrideProblems = Object.entries(draft).filter(([key, well]) => {
    const prediction = predictions.get(key);
    const predictedState = prediction ? apiWellStateToReviewState(prediction.state) : "UNCERTAIN";
    return well.confirmed && well.state !== predictedState && well.reason.trim().length === 0;
  });
  const breakpointChanged = Boolean(
    activeAssessment?.plate.lastBreakpointSetId &&
    activeAssessment.plate.lastBreakpointSetId !== breakpointSetId.trim(),
  );
  const canApprove = isEditable &&
    allRequiredReviewed &&
    overrideProblems.length === 0 &&
    breakpointSetId.trim().length > 0 &&
    (!breakpointChanged || breakpointChangeReason.trim().length > 0);

  const loadAssessments = useCallback(async () => {
    setLoading(true);
    setActionError("");
    try {
      const params = new URLSearchParams({ status: "REVIEW_REQUIRED", limit: "25" });
      if (filters.organism.trim()) params.set("organism", filters.organism.trim());
      if (filters.uploaderUserId.trim()) params.set("uploaderUserId", filters.uploaderUserId.trim());
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const data = await fetchJson<ImageReviewListResponse>(`/api/image-assessments?${params.toString()}`);
      setAssessments(data.assessments);
      setActiveAssessment((current) => current ?? data.assessments[0] ?? null);
    } catch (error) {
      setActionError(error instanceof ApiClientError ? error.message : "画像レビュー一覧を取得できませんでした。");
      setAssessments([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const refreshActiveAssessment = useCallback(async () => {
    if (!activeAssessment) return null;
    const data = await fetchJson<{ assessment: ImageReviewAssessmentSummary }>(`/api/image-assessments/${activeAssessment.id}`);
    setAssessments((current) => current.map((item) => item.id === data.assessment.id ? data.assessment : item));
    return data.assessment;
  }, [activeAssessment]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchJson<{ user: AuthenticatedViewer }>("/api/me")
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch((error) => {
        if (!cancelled) setActionError(error instanceof ApiClientError ? error.message : "ログイン状態を確認してください。");
      });
    return () => { cancelled = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !user) return;
    if (!canReview(user.role)) {
      setActionError("この画面はREVIEWERまたはADMINのみ利用できます。");
      return;
    }
    void loadAssessments();
  }, [enabled, loadAssessments, user]);

  useEffect(() => {
    setDraft(createDraft(activeAssessment));
    setHistory([]);
    setDirty(false);
    setConflictMessage("");
    setServerLatest(null);
    setConflictSnapshot("");
    setBreakpointSetId(activeAssessment?.plate.lastBreakpointSetId ?? "");
    setBreakpointChangeReason("");
    setRejectReason("");
    setActiveKey(wellKey(0, 0));
  }, [activeAssessment?.id]);

  useEffect(() => {
    if (!enabled || !activeAssessment) return;
    let cancelled = false;
    const params = new URLSearchParams({ selectable: "true" });
    if (activeAssessment.plate.sample.organism) params.set("organism", activeAssessment.plate.sample.organism);
    fetchJson<{ breakpointSets: BreakpointSetView[] }>(`/api/breakpoint-sets?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        setBreakpointSets(data.breakpointSets);
        const currentId = activeAssessment.plate.lastBreakpointSetId;
        if (currentId && !data.breakpointSets.some((set) => set.id === currentId)) setBreakpointSetId("");
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeAssessment, enabled]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    if (!editingKey) return;
    contentRef.current?.setAttribute("inert", "");
    contentRef.current?.setAttribute("aria-hidden", "true");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => stateSelectRef.current?.focus(), 0);
    return () => {
      contentRef.current?.removeAttribute("inert");
      contentRef.current?.removeAttribute("aria-hidden");
      document.body.style.overflow = previousOverflow;
      wellRefs.current[editingKey]?.focus();
    };
  }, [editingKey]);

  if (!enabled) {
    return (
      <main className="image-review-page">
        <section className="review-disabled" role="status">
          <p className="eyebrow">Feature flag</p>
          <h1>画像レビューは無効です</h1>
          <p>NEXT_PUBLIC_IMAGE_REVIEW_ENABLED=false のため、画面表示とAPI呼び出しを停止しています。</p>
        </section>
      </main>
    );
  }

  const pushHistory = () => {
    setHistory((current) => [...current.slice(-9), cloneDraft(draft)]);
  };

  const selectAssessment = (assessment: ImageReviewAssessmentSummary) => {
    if (dirty && !window.confirm("未保存のレビュー変更があります。レビュー対象を切り替えますか？")) return;
    setActiveAssessment(assessment);
  };

  const focusWell = (rowIndex: number, columnIndex: number) => {
    const nextKey = wellKey(Math.max(0, Math.min(PLATE_ROWS - 1, rowIndex)), Math.max(0, Math.min(PLATE_COLUMNS - 1, columnIndex)));
    setActiveKey(nextKey);
    window.setTimeout(() => wellRefs.current[nextKey]?.focus(), 0);
  };

  const openWellModal = (key: string) => {
    if (!isEditable) return;
    setActiveKey(key);
    setModalDraft({ state: draft[key]?.state ?? "UNCERTAIN", reason: draft[key]?.reason ?? "" });
    setModalError("");
    setEditingKey(key);
  };

  const handleGridKeyDown = (event: KeyboardEvent<HTMLButtonElement>, rowIndex: number, columnIndex: number) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWellModal(wellKey(rowIndex, columnIndex));
      return;
    }
    if (event.key === "Home" && event.ctrlKey) {
      event.preventDefault();
      focusWell(0, 0);
      return;
    }
    if (event.key === "End" && event.ctrlKey) {
      event.preventDefault();
      focusWell(PLATE_ROWS - 1, PLATE_COLUMNS - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusWell(rowIndex, 0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusWell(rowIndex, PLATE_COLUMNS - 1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusWell(rowIndex, columnIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusWell(rowIndex, columnIndex - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusWell(rowIndex + 1, columnIndex);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusWell(rowIndex - 1, columnIndex);
    }
  };

  const handleConflict = async (error: ApiClientError) => {
    setConflictMessage(error.message || errorMessageForStatus(409));
    setConflictSnapshot(summarizeLocalChanges(draft, activeAssessment));
    try {
      setServerLatest(await refreshActiveAssessment());
    } catch {
      setServerLatest(null);
    }
  };

  const saveModal = async () => {
    if (!editingKey || !activeAssessment) return;
    const [rowIndex, columnIndex] = editingKey.split(":").map(Number);
    const prediction = predictions.get(editingKey);
    const predictedState = prediction ? apiWellStateToReviewState(prediction.state) : "UNCERTAIN";
    const changed = modalDraft.state !== predictedState;
    const reason = modalDraft.reason.trim();
    if (changed && !reason) {
      setModalError("override理由を入力してください。");
      window.setTimeout(() => reasonRef.current?.focus(), 0);
      return;
    }

    try {
      setModalError("");
      if (changed) {
        setSubmittingAction("override");
        await fetchJson<{ kind: "overridden" }>(
          `/api/plates/${activeAssessment.plateId}/image-assessments/${activeAssessment.id}/override`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              rowIndex,
              columnIndex,
              state: reviewStateToApiWellState(modalDraft.state),
              reason,
            }),
          },
        );
      }
      pushHistory();
      setDraft((current) => ({
        ...current,
        [editingKey]: {
          state: modalDraft.state,
          confirmed: true,
          reason: changed ? reason : "",
          overrideSaved: changed,
        },
      }));
      setDirty(true);
      setEditingKey(null);
      setStatusMessage(`${wellName(rowIndex, columnIndex)}を確認しました。`);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        await handleConflict(error);
        setModalError(error.message);
      } else {
        setModalError(error instanceof ApiClientError ? error.message : "overrideの保存に失敗しました。");
      }
    } finally {
      setSubmittingAction(null);
    }
  };

  const confirmUnreviewedAsPredicted = () => {
    if (!activeAssessment || !isEditable) return;
    pushHistory();
    setDraft((current) => {
      const next = cloneDraft(current);
      for (let rowIndex = 0; rowIndex < PLATE_ROWS; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < PLATE_COLUMNS; columnIndex += 1) {
          const key = wellKey(rowIndex, columnIndex);
          if (next[key].confirmed) continue;
          const prediction = predictions.get(key);
          next[key] = {
            state: prediction ? apiWellStateToReviewState(prediction.state) : "UNCERTAIN",
            confirmed: true,
            reason: "",
            overrideSaved: false,
          };
        }
      }
      return next;
    });
    setDirty(true);
    setStatusMessage("未確認ウェルを予測通り確認済みにしました。");
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setDraft(previous);
    setHistory((current) => current.slice(0, -1));
    setDirty(true);
    setStatusMessage("直前の変更を取り消しました。");
  };

  const approve = async () => {
    if (!activeAssessment || !canApprove || submittingRef.current) return;
    if (!window.confirm("この画像レビューを承認します。未承認予測ではなく、確認済みウェルだけが正式結果へ反映されます。続行しますか？")) return;
    submittingRef.current = true;
    setSubmittingAction("approve");
    setActionError("");
    setConflictMessage("");
    const overrideReason = Object.entries(draft)
      .flatMap(([key, value]) => {
        const prediction = predictions.get(key);
        const predictedState = prediction ? apiWellStateToReviewState(prediction.state) : "UNCERTAIN";
        if (value.state === predictedState) return [];
        const [rowIndex, columnIndex] = key.split(":").map(Number);
        return [`${wellName(rowIndex, columnIndex)}: ${value.reason.trim()}`];
      })
      .join("; ")
      .slice(0, 1000);
    try {
      await fetchJson(
        `/api/plates/${activeAssessment.plateId}/image-assessments/${activeAssessment.id}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            breakpointSetId: breakpointSetId.trim(),
            breakpointChangeReason: activeAssessment.plate.lastBreakpointSetId &&
              activeAssessment.plate.lastBreakpointSetId !== breakpointSetId.trim()
              ? breakpointChangeReason.trim() || undefined
              : undefined,
            confirmedWells: Array.from({ length: PLATE_ROWS }, (_, rowIndex) =>
              Array.from({ length: PLATE_COLUMNS }, (_, columnIndex) => {
                const value = draft[wellKey(rowIndex, columnIndex)];
                return { rowIndex, columnIndex, state: reviewStateToApiWellState(value.state) };
              }),
            ).flat(),
            overrideReason: overrideReason || undefined,
          }),
        },
      );
      const approved = { ...activeAssessment, status: "APPROVED" as const, manualReviewRequired: false };
      setActiveAssessment(approved);
      setAssessments((current) => current.map((item) => item.id === approved.id ? approved : item));
      setDirty(false);
      setStatusMessage("画像レビューを承認しました。");
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        await handleConflict(error);
      } else {
        setActionError(error instanceof ApiClientError ? error.message : "承認に失敗しました。");
      }
    } finally {
      submittingRef.current = false;
      setSubmittingAction(null);
    }
  };

  const reject = async () => {
    if (!activeAssessment || !isEditable || submittingRef.current) return;
    if (!rejectReason.trim()) {
      setActionError("差戻し理由または再撮影依頼理由を入力してください。");
      return;
    }
    if (!window.confirm("この画像判定を差戻します。確定ウェル値は作成されません。続行しますか？")) return;
    submittingRef.current = true;
    setSubmittingAction("reject");
    setActionError("");
    setConflictMessage("");
    try {
      await fetchJson(
        `/api/plates/${activeAssessment.plateId}/image-assessments/${activeAssessment.id}/reject`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rejectionReason: rejectReason.trim() }),
        },
      );
      const rejected = { ...activeAssessment, status: "REJECTED" as const, manualReviewRequired: true };
      setActiveAssessment(rejected);
      setAssessments((current) => current.map((item) => item.id === rejected.id ? rejected : item));
      setDirty(false);
      setStatusMessage("画像レビューを差戻しました。");
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        await handleConflict(error);
      } else {
        setActionError(error instanceof ApiClientError ? error.message : "差戻しに失敗しました。");
      }
    } finally {
      submittingRef.current = false;
      setSubmittingAction(null);
    }
  };

  const applyServerLatest = () => {
    if (!serverLatest) return;
    setActiveAssessment(serverLatest);
    setServerLatest(null);
    setConflictMessage("");
    setConflictSnapshot("");
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditingKey(null);
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      "button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
    ));
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

  const renderWell = (rowIndex: number, columnIndex: number) => {
    const key = wellKey(rowIndex, columnIndex);
    const predicted = predictions.get(key);
    const predictedState = predicted ? apiWellStateToReviewState(predicted.state) : "UNCERTAIN";
    const review = draft[key] ?? { state: predictedState, confirmed: false, reason: "", overrideSaved: false };
    const changed = review.state !== predictedState;
    const name = wellName(rowIndex, columnIndex);
    const stateLabel = reviewStateLabels[review.state];
    const predictedLabel = reviewStateLabels[predictedState];
    const label = `${name} 行${ROW_LABELS[rowIndex]} 列${columnIndex + 1}。予測 ${predictedLabel.ja}。確定 ${stateLabel.ja}。${review.confirmed ? "確認済み" : "未確認"}。confidence ${predicted ? Math.round(predicted.confidence * 100) : 0}%。`;
    return (
      <td key={key} role="gridcell">
        <button
          ref={(node) => { wellRefs.current[key] = node; }}
          type="button"
          className={`review-well review-state-${review.state.toLowerCase()} ${changed ? "review-well-overridden" : ""} ${review.confirmed ? "review-well-confirmed" : ""} ${activeKey === key ? "review-well-active" : ""}`}
          data-testid={`well-${name}`}
          aria-label={label}
          aria-pressed={review.confirmed}
          tabIndex={activeKey === key ? 0 : -1}
          disabled={!isEditable}
          onClick={() => openWellModal(key)}
          onFocus={() => setActiveKey(key)}
          onKeyDown={(event) => handleGridKeyDown(event, rowIndex, columnIndex)}
        >
          <span aria-hidden="true">{stateLabel.symbol}</span>
          <small>{name}</small>
          <em>{stateLabel.short}</em>
          {changed && <b>override</b>}
        </button>
      </td>
    );
  };

  const editingName = editingKey
    ? wellName(Number(editingKey.split(":")[0]), Number(editingKey.split(":")[1]))
    : "";
  const editingPrediction = editingKey ? predictions.get(editingKey) : undefined;
  const editingPredictedState = editingPrediction ? apiWellStateToReviewState(editingPrediction.state) : "UNCERTAIN";
  const editingChanged = modalDraft.state !== editingPredictedState;

  return (
    <main className="image-review-page">
      <div ref={contentRef} className="image-review-shell">
        <header className="app-header review-header">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
          <div className="brand-copy"><strong>MIC Plate</strong><small>IMAGE REVIEW</small></div>
          <div className="review-role-badge" aria-live="polite">{user ? `${user.role} / ${user.organizationId}` : "認証確認中"}</div>
        </header>

        <section className="review-hero">
          <div>
            <p className="eyebrow">Image assisted result review</p>
            <h1>画像判定レビュー</h1>
            <p>画像予測は補助情報です。REVIEWER/ADMINが全ウェルを確認し、既存APIの承認後だけ正式結果へ進みます。</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => void loadAssessments()} disabled={loading || !canReview(user?.role)}>
            最新一覧を再読込
          </button>
        </section>

        <section className="review-layout">
          <aside className="review-list-panel" aria-labelledby="review-list-title">
            <div className="panel-title-row">
              <h2 id="review-list-title">レビュー待ち一覧</h2>
              <span>{assessments.length}件</span>
            </div>
            <div className="review-filters" aria-label="絞り込み">
              <label>状態<input value="REVIEW_REQUIRED" disabled readOnly /></label>
              <label>菌種<input value={filters.organism} onChange={(event) => setFilters((current) => ({ ...current, organism: event.target.value }))} placeholder="E. coli" /></label>
              <label>担当者ID<input value={filters.uploaderUserId} onChange={(event) => setFilters((current) => ({ ...current, uploaderUserId: event.target.value }))} placeholder="user id" /></label>
              <label>開始日<input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
              <label>終了日<input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
            </div>
            {loading && <p className="status-message inline-status">読み込み中です。</p>}
            {actionError && <p className="error-message" role="alert">{actionError}</p>}
            {!loading && assessments.length === 0 && canReview(user?.role) && <p className="empty-list">REVIEW_REQUIREDの画像判定はありません。</p>}
            <div className="assessment-list">
              {assessments.map((assessment) => (
                <button
                  type="button"
                  key={assessment.id}
                  className={`assessment-card ${activeAssessment?.id === assessment.id ? "assessment-card-active" : ""}`}
                  onClick={() => selectAssessment(assessment)}
                >
                  <strong>{assessment.plate.sample.sampleCode}</strong>
                  <span>{assessment.plate.sample.organism ?? "organism未設定"}</span>
                  <small>Plate {assessment.plateId}</small>
                  <small>撮影 {formatDate(assessment.createdAt)}</small>
                  <small>uploader {assessment.uploader?.name ?? assessment.uploadedByUserId ?? "不明"}</small>
                  <small>model {assessment.prediction?.modelVersion ?? "未解析"}</small>
                  <small>QC警告 {assessment.qcWarningCount} / 待ち {formatWait(assessment.reviewWaitingMinutes)}</small>
                  <small>organization {assessment.plate.organization.name}</small>
                </button>
              ))}
            </div>
          </aside>

          <section className="review-detail-panel" aria-labelledby="review-detail-title">
            {!activeAssessment ? (
              <div className="review-placeholder">
                <h2 id="review-detail-title">レビュー対象を選択してください</h2>
                <p>左の一覧からREVIEW_REQUIREDのImageAssessmentを選択します。</p>
              </div>
            ) : (
              <>
                <div className="review-detail-head">
                  <div>
                    <p className="eyebrow">{activeAssessment.status}</p>
                    <h2 id="review-detail-title">{activeAssessment.plate.sample.sampleCode} / {activeAssessment.plate.name}</h2>
                    <p>{activeAssessment.plate.sample.organism ?? "organism未設定"} ・ organization {activeAssessment.plate.organization.name}</p>
                  </div>
                  <div className="review-progress" aria-live="polite">
                    <b>{confirmedCount}/96</b>
                    <span>確認済み</span>
                  </div>
                </div>

                {conflictMessage && (
                  <div className="conflict-panel" role="alert">
                    <strong>競合を検出しました</strong>
                    <p>{conflictMessage}</p>
                    <p>ローカル変更: {conflictSnapshot}</p>
                    {serverLatest && <p>サーバー最新状態: {serverLatest.status}</p>}
                    {serverLatest && <button type="button" className="secondary-button" onClick={applyServerLatest}>最新状態を表示</button>}
                  </div>
                )}
                {statusMessage && <p className="status-message inline-status" role="status">{statusMessage}</p>}

                <div className="review-summary-grid">
                  <article><span>Plate</span><b>{activeAssessment.plateId}</b></article>
                  <article><span>BreakpointSet</span><b>{activeAssessment.plate.lastBreakpointSetId ?? "未設定"}</b></article>
                  <article><span>modelVersion</span><b>{activeAssessment.prediction?.modelVersion ?? "未解析"}</b></article>
                  <article><span>prediction作成</span><b>{formatDate(activeAssessment.prediction?.createdAt)}</b></article>
                  <article><span>detected wells</span><b>{activeAssessment.prediction?.detectedWells ?? 0}</b></article>
                  <article><span>qc_score</span><b>{activeAssessment.prediction?.qcScore ?? "N/A"}</b></article>
                </div>

                <div className="image-grid-layout">
                  <section className="review-image-panel" aria-label="撮影画像">
                    <div className="image-toolbar">
                      <button type="button" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(1))))}>縮小</button>
                      <span>{Math.round(zoom * 100)}%</span>
                      <button type="button" onClick={() => setZoom((value) => Math.min(3, Number((value + 0.1).toFixed(1))))}>拡大</button>
                      <button type="button" onClick={() => setPan((value) => ({ ...value, x: value.x - 20 }))}>←</button>
                      <button type="button" onClick={() => setPan((value) => ({ ...value, x: value.x + 20 }))}>→</button>
                      <button type="button" onClick={() => setPan((value) => ({ ...value, y: value.y - 20 }))}>↑</button>
                      <button type="button" onClick={() => setPan((value) => ({ ...value, y: value.y + 20 }))}>↓</button>
                    </div>
                    <div className="image-stage">
                      <div className="image-transform" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
                        {isRenderableImageReference(activeAssessment.prediction?.imageReference ?? activeAssessment.imageReference) ? (
                          <img src={activeAssessment.prediction?.imageReference ?? activeAssessment.imageReference ?? ""} alt={`${activeAssessment.plate.sample.sampleCode} のプレート画像`} />
                        ) : (
                          <div className="image-placeholder">
                            <span>画像プレビューなし</span>
                            <small>{activeAssessment.prediction?.imageReference ?? activeAssessment.imageReference ?? "imageReference未記録"}</small>
                          </div>
                        )}
                        <div className="well-position-overlay" aria-hidden="true">
                          {Array.from({ length: PLATE_ROWS }, (_, rowIndex) =>
                            Array.from({ length: PLATE_COLUMNS }, (_, columnIndex) => (
                              <span key={wellKey(rowIndex, columnIndex)} style={{ left: `${8 + columnIndex * 7.65}%`, top: `${12 + rowIndex * 10.5}%` }}>
                                {wellName(rowIndex, columnIndex)}
                              </span>
                            )),
                          )}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="review-grid-panel" aria-label="96ウェル確認グリッド">
                    <div className="grid-toolbar">
                      <button type="button" className="secondary-button" onClick={confirmUnreviewedAsPredicted} disabled={!isEditable}>未確認を予測通り確認</button>
                      <button type="button" className="secondary-button" onClick={undo} disabled={history.length === 0}>Undo</button>
                    </div>
                    <div className="review-grid-scroll">
                      <table className="review-grid-table" role="grid" aria-label="画像予測とreviewer確定状態の96ウェルグリッド">
                        <thead>
                          <tr>
                            <th className="review-corner">行/列</th>
                            {Array.from({ length: PLATE_COLUMNS }, (_, columnIndex) => <th key={columnIndex}>{columnIndex + 1}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: PLATE_ROWS }, (_, rowIndex) => (
                            <tr key={ROW_LABELS[rowIndex]} role="row">
                              <th scope="row">{ROW_LABELS[rowIndex]}</th>
                              {Array.from({ length: PLATE_COLUMNS }, (_, columnIndex) => renderWell(rowIndex, columnIndex))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="review-legend" aria-label="凡例">
                      {REVIEW_WELL_STATES.map((state) => (
                        <span key={state} className={`legend-review-${state.toLowerCase()}`}>
                          <b>{reviewStateLabels[state].symbol}</b>{reviewStateLabels[state].ja}
                        </span>
                      ))}
                      <span><b>override</b>予測から変更</span>
                    </div>
                  </section>
                </div>

                <section className="audit-display" aria-label="監査情報">
                  <h3>監査表示</h3>
                  <dl>
                    <div><dt>reviewer</dt><dd>{activeAssessment.reviews[0]?.reviewerUserId ?? user?.userId ?? "未レビュー"}</dd></div>
                    <div><dt>review日時</dt><dd>{formatDate(activeAssessment.reviews[0]?.reviewedAt)}</dd></div>
                    <div><dt>override理由</dt><dd>{activeAssessment.overrides.length ? activeAssessment.overrides.map((item) => `${wellName(item.rowIndex, item.columnIndex)}:${item.reason}`).join(" / ") : "なし"}</dd></div>
                    <div><dt>reject理由</dt><dd>{activeAssessment.reviews.find((review) => review.decision === "REJECTED")?.rejectionReason ?? "なし"}</dd></div>
                    <div><dt>assessment status</dt><dd>{activeAssessment.status}</dd></div>
                  </dl>
                </section>

                {canReview(user?.role) ? (
                  <section className="review-action-panel" aria-label="承認と差戻し">
                    <label>承認時BreakpointSet
                      <select value={breakpointSetId} onChange={(event) => setBreakpointSetId(event.target.value)} disabled={!isEditable}>
                        <option value="">承認済み版を選択</option>
                        {breakpointSets.map((set) => (
                          <option key={set.id} value={set.id}>{set.standard} {set.version} / {set.organism ?? "全菌種"}</option>
                        ))}
                      </select>
                    </label>
                    {breakpointChanged && (
                      <label>BreakpointSet変更理由
                        <textarea rows={2} value={breakpointChangeReason} onChange={(event) => setBreakpointChangeReason(event.target.value)} disabled={!isEditable} required />
                      </label>
                    )}
                    <label>差戻し・再撮影依頼理由
                      <textarea rows={3} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} disabled={!isEditable} placeholder="例: glareが強く再撮影が必要" />
                    </label>
                    <div className="review-action-row">
                      <button type="button" className="secondary-button danger-action" onClick={() => void reject()} disabled={!isEditable || submittingAction !== null}>
                        {submittingAction === "reject" ? "差戻し中" : "差戻し"}
                      </button>
                      <button type="button" className="primary-button" onClick={() => void approve()} disabled={!canApprove || submittingAction !== null}>
                        {submittingAction === "approve" ? "承認中" : "承認"}
                      </button>
                    </div>
                    {!allRequiredReviewed && <p className="validation-hint">承認には全96ウェルの確認が必要です。</p>}
                    {overrideProblems.length > 0 && <p className="validation-hint">overrideされたウェルには理由が必要です。</p>}
                    {!breakpointSetId.trim() && <p className="validation-hint">BreakpointSet IDを入力してください。</p>}
                    {breakpointChanged && !breakpointChangeReason.trim() && <p className="validation-hint">BreakpointSet変更理由が必要です。</p>}
                    {activeAssessment.status !== "REVIEW_REQUIRED" && <p className="validation-hint">このassessmentは{activeAssessment.status}のため編集できません。</p>}
                  </section>
                ) : (
                  <p className="safety-note"><span aria-hidden="true">!</span>TECHNICIANには承認・差戻し操作を表示していません。</p>
                )}
              </>
            )}
          </section>
        </section>
      </div>

      {editingKey && (
        <div className="modal-backdrop review-modal-backdrop">
          <div
            ref={dialogRef}
            className="well-modal review-well-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-modal-title"
            onKeyDown={handleDialogKeyDown}
          >
            <header>
              <div>
                <p>{editingName}</p>
                <h2 id="review-modal-title">ウェル確認</h2>
              </div>
              <button type="button" className="modal-close" aria-label="閉じる" onClick={() => setEditingKey(null)}>×</button>
            </header>
            <div className="review-modal-body">
              <p>予測: <strong>{reviewStateLabels[editingPredictedState].ja}</strong> / confidence {editingPrediction ? Math.round(editingPrediction.confidence * 100) : 0}%</p>
              <p>QC警告: {editingPrediction?.qcFlags.length ? editingPrediction.qcFlags.join(", ") : "なし"}</p>
              <label>確定状態
                <select ref={stateSelectRef} value={modalDraft.state} onChange={(event) => setModalDraft((current) => ({ ...current, state: event.target.value as ReviewWellState }))}>
                  {REVIEW_WELL_STATES.map((state) => <option key={state} value={state}>{reviewStateLabels[state].ja}</option>)}
                </select>
              </label>
              <label>override理由{editingChanged ? "（必須）" : ""}
                <textarea
                  ref={reasonRef}
                  rows={4}
                  value={modalDraft.reason}
                  aria-invalid={Boolean(modalError)}
                  aria-describedby={modalError ? "review-modal-error" : undefined}
                  onChange={(event) => setModalDraft((current) => ({ ...current, reason: event.target.value }))}
                  placeholder="予測と異なる場合は理由を入力"
                />
              </label>
              {modalError && <p id="review-modal-error" className="error-message" role="alert">{modalError}</p>}
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setEditingKey(null)}>キャンセル</button>
                <button type="button" className="primary-button" onClick={() => void saveModal()} disabled={submittingAction === "override"}>
                  {submittingAction === "override" ? "保存中" : "確認を保存"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
