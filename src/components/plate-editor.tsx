"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { buildWellDrugDetailMap } from "@/lib/drug-layout";
import {
  deleteLocalDraft,
  flushSyncQueue,
  loadLocalDraft,
  mergePlateWellChanges,
  queuePlateSave,
  recoverStaleSyncing,
  resolveDraftConflict,
  saveLocalDraft,
  type OfflineActor,
  type OfflineSyncResult,
  type RevisionConflictPayload,
  type WellMergeResult,
} from "@/lib/offline-db";
import {
  PLATE_COLUMNS,
  PLATE_ROWS,
  UI_WELL_STATES,
  applyGrowthToLowerConcentrations,
  applyStateToColumn,
  applyStateToRow,
  countEmptyWells,
  createEmptyPlate,
  cycleWellState,
  toApiWellState,
  toUiWellState,
  validatePlate,
  wellKey,
  type PlateStateMap,
  type UiWellState,
  type WellDetails,
  type WellDetailsMap,
} from "@/lib/plate-ui";
import { ROW_LABELS, type ExportProfile, type PlateView, type SavePlateRequest, type UserRole, type WellInput } from "@/types/domain";

type Locale = "ja" | "en";

const stateMeta: Record<UiWellState, { symbol: string; ja: string; en: string; shortJa: string; shortEn: string }> = {
  EMPTY: { symbol: "○", ja: "未入力", en: "Empty", shortJa: "空", shortEn: "Empty" },
  GROWTH: { symbol: "+", ja: "発育あり", en: "Growth", shortJa: "発育", shortEn: "Growth" },
  NO_GROWTH: { symbol: "−", ja: "発育なし", en: "No growth", shortJa: "阻止", shortEn: "No growth" },
  REVIEW_NEEDED: { symbol: "!", ja: "要確認", en: "Review needed", shortJa: "要確認", shortEn: "Review" },
};

const copy = {
  ja: {
    title: "96穴プレート入力",
    organismUnset: "菌種未設定",
    autosave: "端末へ自動保存",
    remaining: "未入力",
    bulkTitle: "一括入力する状態",
    bulkHint: "行ラベルまたは列ラベルをタップすると、選択中の状態を一括入力します。",
    longPress: "ウェルをタップして状態変更。長押し、または下部の「詳細」で薬剤情報とメモを編集できます。",
    undo: "Undo",
    clear: "全解除",
    details: "詳細",
    save: "保存",
    saving: "保存中",
    sync: "同期",
    syncing: "同期中",
    saved: "プレートを保存しました。",
    synced: "オフライン入力を同期しました。",
    offline: "オフラインのため端末に保存しました。オンライン復帰時に同期します。",
    authRequired: "ログイン状態を確認できません。再ログイン後に同期してください。",
    queued: "端末内の同期キューへ保存しました。",
    syncFailed: "同期できませんでした。内容は端末に残っています。",
    conflict: "サーバー上の最新版と競合しています。下の比較を確認してください。",
    conflictTitle: "同期競合の確認",
    conflictSummary: "サーバー版・ローカル変更・自動マージ候補を比較してください。強制上書きはできません。",
    clientRevision: "ローカル基準revision",
    serverRevision: "サーバーrevision",
    serverUpdatedAt: "サーバー更新日時",
    serverUpdatedBy: "更新者",
    autoMerge: "非競合を再適用",
    useServer: "サーバー版を採用",
    discardLocal: "ローカル破棄",
    conflictsFound: "手動確認が必要なウェル",
    noConflictWells: "同一ウェルの競合はありません。",
    selected: "選択中",
    modalTitle: "ウェル詳細",
    cancel: "キャンセル",
    update: "更新",
    exportTitle: "Excel出力",
    exportProfile: "出力プロファイル",
    exportAnonymized: "匿名化: sample code、notes、actor、内部IDを含めません。",
    exportClinical: "施設内: sample codeと技術追跡列を含みます。notesは明示選択時のみです。",
    exportAudit: "監査: 履歴と監査情報を含みます。理由が必須です。",
    includeNotes: "notesを含める（機微情報の可能性があります）",
    exportReason: "出力理由",
    exportStart: "Excel生成",
    exporting: "生成中",
    exportReady: "Excelをダウンロードできます。",
    backToSamples: "Sample選択へ戻る",
    deleteSample: "Sample削除",
    imageTitle: "写真による簡易判定",
    imageDescription: "プレート写真をアップロードして、OpenCVによる補助的な発育予測を作成します。結果は必ずレビュー待ちになり、承認前に正式結果へは反映されません。",
    imageChoose: "写真を選択して解析",
    imageUploading: "画像解析中",
    imageSuccess: "画像解析結果をレビュー待ちに登録しました。",
    imageReviewLink: "画像レビューへ",
    imageServiceRequired: "画像解析サービスが起動している必要があります。",
    imageInvalid: "画像ファイルを選択してください。",
  },
  en: {
    title: "96-well plate entry",
    organismUnset: "Organism not set",
    autosave: "Autosaved on device",
    remaining: "Empty",
    bulkTitle: "Bulk input state",
    bulkHint: "Tap a row or column label to apply the selected state.",
    longPress: "Tap a well to change state. Long-press it, or use Details below, to edit metadata.",
    undo: "Undo",
    clear: "Clear all",
    details: "Details",
    save: "Save",
    saving: "Saving",
    sync: "Sync",
    syncing: "Syncing",
    saved: "Plate saved.",
    synced: "Offline input synced.",
    offline: "Saved on this device. It will sync when online.",
    authRequired: "Could not confirm your login. Sign in again before syncing.",
    queued: "Saved to the device sync queue.",
    syncFailed: "Sync failed. The draft remains on this device.",
    conflict: "The server version has changed. Review the comparison below.",
    conflictTitle: "Sync conflict",
    conflictSummary: "Compare the server version, local changes, and automatic merge candidate. Force overwrite is not available.",
    clientRevision: "Client base revision",
    serverRevision: "Server revision",
    serverUpdatedAt: "Server updated at",
    serverUpdatedBy: "Updated by",
    autoMerge: "Apply non-conflicting changes",
    useServer: "Use server version",
    discardLocal: "Discard local",
    conflictsFound: "Wells requiring manual review",
    noConflictWells: "No same-well conflicts.",
    selected: "Selected",
    modalTitle: "Well details",
    cancel: "Cancel",
    update: "Update",
    exportTitle: "Excel export",
    exportProfile: "Export profile",
    exportAnonymized: "Anonymized: excludes sample code, notes, actors, and internal IDs.",
    exportClinical: "Clinical internal: includes sample code and technical trace columns. Notes require explicit opt-in.",
    exportAudit: "Audit full: includes history and audit fields. Reason is required.",
    includeNotes: "Include notes (may contain sensitive data)",
    exportReason: "Export reason",
    exportStart: "Generate Excel",
    exporting: "Generating",
    exportReady: "Excel is ready to download.",
    backToSamples: "Back to samples",
    deleteSample: "Delete sample",
    imageTitle: "Photo-assisted growth check",
    imageDescription: "Upload a plate photo to create OpenCV-assisted growth predictions. The result always goes to manual review and is not used as an official result before approval.",
    imageChoose: "Choose photo and analyze",
    imageUploading: "Analyzing image",
    imageSuccess: "Image analysis was registered for manual review.",
    imageReviewLink: "Open image review",
    imageServiceRequired: "The image analysis service must be running.",
    imageInvalid: "Choose an image file.",
  },
} as const;

interface HistoryEntry {
  states: PlateStateMap;
  details: WellDetailsMap;
}

interface ConflictState {
  payload: RevisionConflictPayload;
  merge: WellMergeResult;
  localWells: WellInput[];
}

interface SessionContext {
  actor: OfflineActor;
  role: UserRole;
}

interface WellContextMenu {
  key: string;
  rowIndex: number;
  columnIndex: number;
  x: number;
  y: number;
}

function createInitialStates(plate: PlateView): PlateStateMap {
  const states = createEmptyPlate();
  for (const well of plate.wells) states[wellKey(well.rowIndex, well.columnIndex)] = toUiWellState(well.state);
  return states;
}

function createInitialDetails(plate: PlateView): WellDetailsMap {
  const drugsByWell = buildWellDrugDetailMap(plate.drugs);
  const details: WellDetailsMap = {};
  for (let rowIndex = 0; rowIndex < PLATE_ROWS; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < PLATE_COLUMNS; columnIndex += 1) {
      const drug = drugsByWell.get(wellKey(rowIndex, columnIndex));
      details[wellKey(rowIndex, columnIndex)] = {
        drugName: drug?.drugName ?? "",
        concentration: drug?.concentration === undefined ? "" : String(drug.concentration),
        unit: drug?.unit ?? "",
        note: "",
      };
    }
  }
  return details;
}

function cloneDetails(details: WellDetailsMap): WellDetailsMap {
  return Object.fromEntries(Object.entries(details).map(([key, detail]) => [key, { ...detail }]));
}

function statesToWellInputs(states: PlateStateMap): WellInput[] {
  return Array.from({ length: PLATE_ROWS }, (_, rowIndex) =>
    Array.from({ length: PLATE_COLUMNS }, (_, columnIndex): WellInput => ({
      rowIndex,
      columnIndex,
      state: toApiWellState(states[wellKey(rowIndex, columnIndex)] ?? "EMPTY"),
      source: "MANUAL",
    })),
  ).flat();
}

function statesFromWellInputs(wells: WellInput[]): PlateStateMap {
  const states = createEmptyPlate();
  for (const well of wells) states[wellKey(well.rowIndex, well.columnIndex)] = toUiWellState(well.state);
  return states;
}

function coordinate(rowIndex: number, columnIndex: number): string {
  return `${ROW_LABELS[rowIndex]}${columnIndex + 1}`;
}

function normalizeMeResponse(value: unknown): SessionContext | null {
  if (!value || typeof value !== "object" || !("user" in value)) return null;
  const user = (value as { user?: { userId?: unknown; organizationId?: unknown; role?: unknown } }).user;
  if (typeof user?.userId !== "string" || typeof user.organizationId !== "string") return null;
  const role = user.role === "REVIEWER" || user.role === "ADMIN" || user.role === "AUDITOR" ? user.role : "TECHNICIAN";
  return { actor: { userId: user.userId, organizationId: user.organizationId }, role };
}

function allowedExportProfiles(role: UserRole | null): ExportProfile[] {
  if (role === "ADMIN" || role === "AUDITOR") return ["ANONYMIZED", "CLINICAL_INTERNAL", "AUDIT_FULL"];
  if (role === "REVIEWER") return ["ANONYMIZED", "CLINICAL_INTERNAL"];
  return ["ANONYMIZED"];
}

function exportProfileDescription(profile: ExportProfile, t: typeof copy[Locale]): string {
  if (profile === "AUDIT_FULL") return t.exportAudit;
  if (profile === "CLINICAL_INTERNAL") return t.exportClinical;
  return t.exportAnonymized;
}

interface ImageUploadResponse {
  assessment?: {
    id?: string;
    status?: string;
    manualReviewRequired?: boolean;
  };
  analysis?: {
    qc_score?: number;
    detected_wells?: number;
    confidence?: number;
    review_needed?: boolean;
  };
}

async function readApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    const trimmed = text.trim();
    const detail = trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")
      ? "Server returned an HTML error page instead of JSON."
      : trimmed;
    throw new Error(detail || `Unexpected non-JSON response (${response.status}).`);
  }
  const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(data?.error?.message ?? `Request failed (${response.status}).`);
  return data as T;
}

export function PlateEditor({
  plate,
  locale,
  onLocaleChange,
  onBack,
  onDeleteSample,
}: {
  plate: PlateView;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onBack: () => void;
  onDeleteSample?: () => void;
}) {
  const [wells, setWells] = useState<PlateStateMap>(() => createInitialStates(plate));
  const [details, setDetails] = useState<WellDetailsMap>(() => createInitialDetails(plate));
  const [bulkState, setBulkState] = useState<UiWellState>("NO_GROWTH");
  const [selectedKey, setSelectedKey] = useState(wellKey(0, 0));
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState<WellDetails>(details[wellKey(0, 0)]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [actor, setActor] = useState<OfflineActor | null>(null);
  const [actorRole, setActorRole] = useState<UserRole | null>(null);
  const [serverRevision, setServerRevision] = useState(plate.wellRevision ?? 0);
  const [baseWells, setBaseWells] = useState<WellInput[]>(() => statesToWellInputs(createInitialStates(plate)));
  const [conflictState, setConflictState] = useState<ConflictState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [exportProfile, setExportProfile] = useState<ExportProfile>("ANONYMIZED");
  const [includeNotes, setIncludeNotes] = useState(false);
  const [exportReason, setExportReason] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportDownload, setExportDownload] = useState<{ href: string; fileName: string } | null>(null);
  const [imageUploadBusy, setImageUploadBusy] = useState(false);
  const [imageUploadError, setImageUploadError] = useState("");
  const [imageUploadResult, setImageUploadResult] = useState<ImageUploadResponse | null>(null);
  const [imageFileName, setImageFileName] = useState("");
  const [wellContextMenu, setWellContextMenu] = useState<WellContextMenu | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressActivated = useRef(false);
  const longPressStart = useRef({ x: 0, y: 0 });
  const t = copy[locale];

  const selectedCoordinate = useMemo(() => {
    const [rowIndex, columnIndex] = selectedKey.split("-").map(Number);
    return `${ROW_LABELS[rowIndex]}${columnIndex + 1}`;
  }, [selectedKey]);
  const emptyCount = countEmptyWells(wells);
  const exportProfiles = useMemo(() => allowedExportProfiles(actorRole), [actorRole]);

  const buildPayload = (states: PlateStateMap, revision = serverRevision): SavePlateRequest => ({
    expectedRevision: revision,
    wells: statesToWellInputs(states),
  });

  const applySyncResults = (results: OfflineSyncResult[], localPayload = buildPayload(wells), successMessage: string = t.synced) => {
    const result = results.find((item) => item.plateId === plate.id && item.kind !== "skipped");
    if (!result) return;

    if (result.kind === "synced") {
      const nextRevision = result.resultingRevision ?? serverRevision + 1;
      setServerRevision(nextRevision);
      setBaseWells(localPayload.wells);
      setConflictState(null);
      setDirty(false);
      setMessage(successMessage);
      return;
    }

    if (result.kind === "conflict" && result.conflict) {
      const merge = mergePlateWellChanges(baseWells, localPayload.wells, result.conflict.serverWells);
      setConflictState({ payload: result.conflict, merge, localWells: localPayload.wells });
      setMessage(t.conflict);
      return;
    }

    if (result.kind === "retry_scheduled") {
      setMessage(result.message ?? t.queued);
      return;
    }

    if (result.kind === "failed") {
      setMessage(result.message ?? t.syncFailed);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) throw new Error("not authenticated");
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const session = normalizeMeResponse(data);
        if (session) {
          setActor(session.actor);
          setActorRole(session.role);
        }
        else setMessage(t.authRequired);
      })
      .catch(() => {
        if (!cancelled) setMessage(t.authRequired);
      });
    return () => { cancelled = true; };
  }, [t.authRequired]);

  useEffect(() => {
    if (!exportProfiles.includes(exportProfile)) setExportProfile("ANONYMIZED");
  }, [exportProfile, exportProfiles]);

  useEffect(() => {
    return () => {
      if (exportDownload) URL.revokeObjectURL(exportDownload.href);
    };
  }, [exportDownload]);

  useEffect(() => {
    if (!actor) return;
    const currentActor = actor;
    let cancelled = false;
    async function restoreAndSync() {
      await recoverStaleSyncing(currentActor);
      const draft = await loadLocalDraft(plate.id, currentActor);
      if (cancelled) return;
      if (draft) {
        setWells(statesFromWellInputs(draft.payload.wells));
        setBaseWells(draft.baseWells);
        setServerRevision(draft.baseRevision);
        if (draft.details) setDetails({ ...createInitialDetails(plate), ...draft.details });
        if (draft.syncStatus === "CONFLICT") setMessage(t.conflict);
      }
      if (typeof navigator !== "undefined" && navigator.onLine) {
        const results = await flushSyncQueue(currentActor).catch((): OfflineSyncResult[] => []);
        if (!cancelled) applySyncResults(results, draft?.payload);
      }
    }
    restoreAndSync().catch(() => undefined);
    return () => { cancelled = true; };
  }, [actor, plate.id, t.conflict]);

  useEffect(() => {
    if (!actor) return;
    const timer = window.setTimeout(() => {
      saveLocalDraft(plate.id, actor, buildPayload(wells), serverRevision, baseWells, details).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [actor, baseWells, details, plate.id, serverRevision, wells]);

  useEffect(() => {
    if (!actor) return;
    const sync = () => {
      flushSyncQueue(actor, { force: false })
        .then((results) => applySyncResults(results))
        .catch(() => undefined);
    };
    window.addEventListener("online", sync);
    const interval = window.setInterval(() => {
      if (navigator.onLine) sync();
    }, 60_000);
    return () => {
      window.removeEventListener("online", sync);
      window.clearInterval(interval);
    };
  }, [actor, baseWells, plate.id, serverRevision, wells]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("mic-plate-offline-sync");
    channel.onmessage = (event) => {
      const data = event.data as { plateId?: string; type?: string; status?: string };
      if (data.plateId !== plate.id) return;
      if (data.type === "OFFLINE_SYNC_STARTED") setMessage(t.syncing);
      if (data.status === "CONFLICT") setMessage(t.conflict);
    };
    return () => channel.close();
  }, [plate.id, t.conflict, t.synced, t.syncing]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    if (!editingKey) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [editingKey]);

  useEffect(() => {
    if (!wellContextMenu) return;
    const close = () => setWellContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [wellContextMenu]);

  const commit = (nextStates: PlateStateMap, nextDetails = details) => {
    setHistory((current) => [...current.slice(-29), { states: { ...wells }, details: cloneDetails(details) }]);
    setWells(nextStates);
    setDetails(nextDetails);
    setErrors([]);
    setMessage("");
    setDirty(true);
  };

  const openDetails = (key: string) => {
    setSelectedKey(key);
    setDetailDraft({ ...(details[key] ?? { drugName: "", concentration: "", unit: "", note: "" }) });
    setEditingKey(key);
  };

  const beginLongPress = (key: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    longPressActivated.current = false;
    longPressStart.current = { x: event.clientX, y: event.clientY };
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressActivated.current = true;
      openDetails(key);
    }, 550);
  };

  const moveLongPress = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (Math.hypot(event.clientX - longPressStart.current.x, event.clientY - longPressStart.current.y) > 8) {
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const stopLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const handleWellClick = (key: string) => {
    if (longPressActivated.current) {
      longPressActivated.current = false;
      return;
    }
    setSelectedKey(key);
    commit({ ...wells, [key]: cycleWellState(wells[key] ?? "EMPTY") });
  };

  const openWellContextMenu = (
    key: string,
    rowIndex: number,
    columnIndex: number,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    setSelectedKey(key);
    setWellContextMenu({
      key,
      rowIndex,
      columnIndex,
      x: Math.min(event.clientX, window.innerWidth - 260),
      y: Math.min(event.clientY, window.innerHeight - 170),
    });
  };

  const markLowerConcentrationsAsGrowth = (menu: WellContextMenu) => {
    commit(applyGrowthToLowerConcentrations(wells, menu.rowIndex, menu.columnIndex));
    setWellContextMenu(null);
  };

  const undo = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setWells(previous.states);
    setDetails(previous.details);
    setHistory((current) => current.slice(0, -1));
    setErrors([]);
    setMessage("");
    setDirty(true);
  };

  const updateDetails = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingKey) return;
    commit(wells, { ...details, [editingKey]: { ...detailDraft } });
    setEditingKey(null);
  };

  const save = async () => {
    const validationErrors = validatePlate(wells, details);
    setErrors(validationErrors);
    setMessage("");
    if (validationErrors.length > 0) return;
    if (!actor) {
      setErrors([t.authRequired]);
      return;
    }

    setSaving(true);
    const payload = buildPayload(wells);
    try {
      await saveLocalDraft(plate.id, actor, payload, serverRevision, baseWells, details);
      await queuePlateSave(plate.id, actor, payload, serverRevision, baseWells);
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setMessage(t.offline);
        return;
      }
      const results = await flushSyncQueue(actor, { force: true });
      applySyncResults(results, payload, t.saved);
    } catch {
      setMessage(t.syncFailed);
    } finally {
      setSaving(false);
    }
  };

  const retrySync = async () => {
    if (!actor) {
      setErrors([t.authRequired]);
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload(wells);
      await queuePlateSave(plate.id, actor, payload, serverRevision, baseWells);
      const results = await flushSyncQueue(actor, { force: true });
      applySyncResults(results, payload);
    } finally {
      setSaving(false);
    }
  };

  const applyServerVersion = async () => {
    if (!actor || !conflictState) return;
    const serverStates = statesFromWellInputs(conflictState.payload.serverWells);
    setWells(serverStates);
    setBaseWells(conflictState.payload.serverWells);
    setServerRevision(conflictState.payload.serverWellRevision);
    setConflictState(null);
    setDirty(false);
    await deleteLocalDraft(plate.id, actor);
    setMessage(t.useServer);
  };

  const applyAutoMerge = async () => {
    if (!actor || !conflictState) return;
    const mergedStates = statesFromWellInputs(conflictState.merge.mergedWells);
    const nextPayload = buildPayload(mergedStates, conflictState.payload.serverWellRevision);
    setWells(mergedStates);
    setBaseWells(conflictState.payload.serverWells);
    setServerRevision(conflictState.payload.serverWellRevision);
    setConflictState(null);
    setDirty(true);
    await resolveDraftConflict(
      plate.id,
      actor,
      nextPayload,
      conflictState.payload.serverWellRevision,
      conflictState.payload.serverWells,
      details,
    );
    setMessage(conflictState.merge.conflicts.length > 0
      ? `${t.conflictsFound}: ${conflictState.merge.conflicts.map((item) => coordinate(item.rowIndex, item.columnIndex)).join(", ")}`
      : t.noConflictWells);
  };

  const discardLocal = async () => {
    await applyServerVersion();
    setMessage(t.discardLocal);
  };

  const exportExcel = async () => {
    setExportError("");
    setExportDownload((current) => {
      if (current) URL.revokeObjectURL(current.href);
      return null;
    });
    if (exportProfile === "AUDIT_FULL" && !exportReason.trim()) {
      setExportError(locale === "ja" ? "監査出力には理由が必要です。" : "Audit export requires a reason.");
      return;
    }
    setExportBusy(true);
    try {
      const params = new URLSearchParams({ profile: exportProfile });
      if (includeNotes && exportProfile !== "ANONYMIZED") {
        params.set("includeNotes", "true");
        params.set("acknowledgeSensitive", "true");
      }
      if (exportReason.trim()) params.set("reason", exportReason.trim());
      const response = await fetch(`/api/export/${plate.id}?${params.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? (locale === "ja" ? "Excel出力に失敗しました。" : "Excel export failed."));
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const fileName = match?.[1] ?? "ast-export.xlsx";
      const href = URL.createObjectURL(blob);
      setExportDownload({ href, fileName });
      setMessage(t.exportReady);
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : (locale === "ja" ? "Excel出力に失敗しました。" : "Excel export failed."));
    } finally {
      setExportBusy(false);
    }
  };

  const uploadPlateImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    setImageUploadError("");
    setImageUploadResult(null);

    if (!file) return;
    setImageFileName(file.name);
    if (!file.type.startsWith("image/")) {
      setImageUploadError(t.imageInvalid);
      return;
    }
    if (!actor) {
      setImageUploadError(t.authRequired);
      return;
    }

    setImageUploadBusy(true);
    try {
      const form = new FormData();
      form.append("image", file, file.name);
      const response = await fetch(`/api/plates/${plate.id}/image-assessments`, {
        method: "POST",
        body: form,
      });
      const data = await readApiJson<ImageUploadResponse>(response);
      setImageUploadResult(data);
      setMessage(t.imageSuccess);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t.imageServiceRequired;
      setImageUploadError(message.includes("fetch") ? t.imageServiceRequired : message);
    } finally {
      setImageUploadBusy(false);
    }
  };

  return (
    <main className="plate-page">
      <header className="app-header plate-app-header">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="brand-copy"><strong>MIC Plate</strong><small>RECORDER</small></div>
        <div className="header-empty-count" aria-live="polite"><b>{emptyCount}</b><span>{t.remaining}</span></div>
        <button type="button" className="secondary-button header-back-button" onClick={onBack}>{t.backToSamples}</button>
        {onDeleteSample && (
          <button type="button" className="secondary-button header-delete-button danger-action" onClick={onDeleteSample}>
            {t.deleteSample}
          </button>
        )}
        <button className="language-button" onClick={() => onLocaleChange(locale === "ja" ? "en" : "ja")}>{locale === "ja" ? "EN" : "日本語"}</button>
      </header>

      <section className="plate-heading compact-plate-heading">
        <div>
          <p className="eyebrow">{plate.sample.sampleCode}</p>
          <h1>{t.title}</h1>
          <p>{plate.sample.organism ?? t.organismUnset}</p>
        </div>
        <div className="connection-badge"><span />{t.autosave} / rev {serverRevision}</div>
      </section>

      <section className="bulk-panel" aria-labelledby="bulk-title">
        <div className="bulk-panel-copy">
          <strong id="bulk-title">{t.bulkTitle}</strong>
          <small>{t.bulkHint}</small>
        </div>
        <div className="bulk-state-list">
          {UI_WELL_STATES.map((state) => {
            const meta = stateMeta[state];
            return (
              <button
                type="button"
                key={state}
                className={`bulk-choice bulk-choice-${state.toLowerCase()}`}
                aria-pressed={bulkState === state}
                onClick={() => setBulkState(state)}
              ><b>{meta.symbol}</b><span>{locale === "ja" ? meta.shortJa : meta.shortEn}</span></button>
            );
          })}
        </div>
      </section>

      <section className="plate-panel plate-input-panel" aria-label={locale === "ja" ? "96穴プレート" : "96-well plate"}>
        <div className="plate-scroll plate-scroll-mobile">
          <table className="plate-grid plate-entry-grid">
            <thead>
              <tr>
                <th className="corner sticky-corner">{locale === "ja" ? "行 / 列" : "Row / Col"}</th>
                {Array.from({ length: PLATE_COLUMNS }, (_, columnIndex) => (
                  <th className="column-head" key={columnIndex}>
                    <button
                      type="button"
                      className="bulk-header-button"
                      aria-label={`${locale === "ja" ? "列" : "Column "}${columnIndex + 1}${locale === "ja" ? `を${stateMeta[bulkState].ja}に一括入力` : `: apply ${stateMeta[bulkState].en}`}`}
                      onClick={() => commit(applyStateToColumn(wells, columnIndex, bulkState))}
                    >{columnIndex + 1}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROW_LABELS.map((label, rowIndex) => (
                <tr key={label}>
                  <th className="row-head">
                    <button
                      type="button"
                      className="bulk-header-button row-bulk-button"
                      aria-label={`${locale === "ja" ? "行" : "Row "}${label}${locale === "ja" ? `を${stateMeta[bulkState].ja}に一括入力` : `: apply ${stateMeta[bulkState].en}`}`}
                      onClick={() => commit(applyStateToRow(wells, rowIndex, bulkState))}
                    ><b>{label}</b><small>{locale === "ja" ? "行" : "row"}</small></button>
                  </th>
                  {Array.from({ length: PLATE_COLUMNS }, (_, columnIndex) => {
                    const key = wellKey(rowIndex, columnIndex);
                    const state = wells[key] ?? "EMPTY";
                    const meta = stateMeta[state];
                    const wellName = `${label}${columnIndex + 1}`;
                    const detail = details[key];
                    const doseLabel = [detail?.concentration, detail?.unit].filter(Boolean).join(" ");
                    return (
                      <td key={columnIndex}>
                        <button
                          type="button"
                          className={`well ui-well well-ui-${state.toLowerCase()} ${selectedKey === key ? "well-selected" : ""}`}
                          aria-label={`${wellName}: ${locale === "ja" ? meta.ja : meta.en}`}
                          aria-pressed={selectedKey === key}
                          onClick={() => handleWellClick(key)}
                          onPointerDown={(event) => beginLongPress(key, event)}
                          onPointerMove={moveLongPress}
                          onPointerUp={stopLongPress}
                          onPointerCancel={stopLongPress}
                          onPointerLeave={stopLongPress}
                          onContextMenu={(event) => openWellContextMenu(key, rowIndex, columnIndex, event)}
                        >
                          <b>{meta.symbol}</b>
                          <small>{locale === "ja" ? meta.shortJa : meta.shortEn}</small>
                          {detail?.drugName && <em className="well-drug-label">{detail.drugName}</em>}
                          {doseLabel && <em className="well-dose-label">{doseLabel}</em>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tap-help">{t.longPress}</p>
      </section>

      {errors.length > 0 && (
        <section className="plate-validation" role="alert" aria-labelledby="validation-title">
          <strong id="validation-title">保存できません</strong>
          <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </section>
      )}

      {conflictState && (
        <section className="offline-conflict-panel" role="alert" aria-labelledby="offline-conflict-title">
          <div>
            <strong id="offline-conflict-title">{t.conflictTitle}</strong>
            <p>{t.conflictSummary}</p>
          </div>
          <dl>
            <div><dt>{t.clientRevision}</dt><dd>{conflictState.payload.clientBaseRevision}</dd></div>
            <div><dt>{t.serverRevision}</dt><dd>{conflictState.payload.serverRevision}</dd></div>
            <div><dt>{t.serverUpdatedAt}</dt><dd>{new Date(conflictState.payload.serverUpdatedAt).toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}</dd></div>
            <div><dt>{t.serverUpdatedBy}</dt><dd>{conflictState.payload.serverUpdatedBy ?? "—"}</dd></div>
          </dl>
          <p>
            auto merge: local {conflictState.merge.localOnlyCount} / server {conflictState.merge.serverOnlyCount} /
            same {conflictState.merge.autoMergedCount}
          </p>
          {conflictState.merge.conflicts.length > 0 ? (
            <ul>
              {conflictState.merge.conflicts.slice(0, 12).map((item) => (
                <li key={item.key}>
                  {coordinate(item.rowIndex, item.columnIndex)}:
                  base {item.baseState} / local {item.localState} / server {item.serverState}
                </li>
              ))}
            </ul>
          ) : <p>{t.noConflictWells}</p>}
          <div className="offline-conflict-actions">
            <button type="button" className="secondary-button" onClick={applyAutoMerge}>{t.autoMerge}</button>
            <button type="button" className="secondary-button" onClick={applyServerVersion}>{t.useServer}</button>
            <button type="button" className="secondary-button danger-action" onClick={discardLocal}>{t.discardLocal}</button>
          </div>
        </section>
      )}

      {message && <p className="status-message" role="status">{message}</p>}

      <section className="image-panel image-upload-panel" aria-labelledby="image-upload-title">
        <div>
          <p className="eyebrow">IMAGE ASSIST</p>
          <h2 id="image-upload-title">{t.imageTitle}</h2>
          <p>{t.imageDescription}</p>
          {imageFileName && <p className="image-file-name">{imageFileName}</p>}
          {imageUploadResult?.assessment && (
            <dl className="image-upload-summary" data-testid="image-upload-status">
              <div><dt>Status</dt><dd>{imageUploadResult.assessment.status ?? "REVIEW_REQUIRED"}</dd></div>
              <div><dt>Manual review</dt><dd>{imageUploadResult.assessment.manualReviewRequired === false ? "NO" : "YES"}</dd></div>
              <div><dt>Wells</dt><dd>{imageUploadResult.analysis?.detected_wells ?? "N/A"}</dd></div>
              <div><dt>QC</dt><dd>{imageUploadResult.analysis?.qc_score ?? "N/A"}</dd></div>
            </dl>
          )}
          {imageUploadError && <p className="error-message image-upload-error" role="alert">{imageUploadError}</p>}
        </div>
        <div className="image-upload-actions">
          <label className={`file-button secondary-button ${imageUploadBusy ? "is-busy" : ""}`}>
            <input
              data-testid="plate-image-input"
              type="file"
              accept="image/*"
              disabled={imageUploadBusy || !actor}
              onChange={uploadPlateImage}
            />
            {imageUploadBusy ? t.imageUploading : t.imageChoose}
          </label>
          {imageUploadResult?.assessment && (
            <a className="primary-button image-review-link" href="/review/image">{t.imageReviewLink}</a>
          )}
        </div>
      </section>

      <section className="export-panel" aria-labelledby="export-title">
        <div>
          <p className="eyebrow">EXPORT</p>
          <h2 id="export-title">{t.exportTitle}</h2>
          <p>{exportProfileDescription(exportProfile, t)}</p>
        </div>
        <div className="export-controls">
          <label>
            <span>{t.exportProfile}</span>
            <select value={exportProfile} onChange={(event) => setExportProfile(event.target.value as ExportProfile)} disabled={exportBusy}>
              {exportProfiles.map((profile) => (
                <option key={profile} value={profile}>{profile}</option>
              ))}
            </select>
          </label>
          {exportProfile === "CLINICAL_INTERNAL" && (actorRole === "ADMIN" || actorRole === "AUDITOR") && (
            <label className="check-row export-check">
              <input type="checkbox" checked={includeNotes} onChange={(event) => setIncludeNotes(event.target.checked)} disabled={exportBusy} />
              <span>{t.includeNotes}</span>
            </label>
          )}
          {exportProfile === "AUDIT_FULL" && (
            <label>
              <span>{t.exportReason}</span>
              <textarea rows={3} value={exportReason} onChange={(event) => setExportReason(event.target.value)} disabled={exportBusy} />
            </label>
          )}
          {exportError && <p className="error-message" role="alert">{exportError}</p>}
          <div className="export-actions">
            <button type="button" className="secondary-button" onClick={exportExcel} disabled={exportBusy || !actor}>
              {exportBusy ? t.exporting : t.exportStart}
            </button>
            {exportDownload && (
              <a className="primary-button export-download" href={exportDownload.href} download={exportDownload.fileName}>
                {locale === "ja" ? "ダウンロード" : "Download"}
              </a>
            )}
          </div>
        </div>
      </section>

      <div className="plate-action-bar" aria-label={locale === "ja" ? "プレート操作" : "Plate actions"}>
        <div className="selected-well"><small>{t.selected}</small><b>{selectedCoordinate}</b></div>
        <button type="button" className="bar-action" onClick={undo} disabled={history.length === 0}><span aria-hidden="true">↶</span>{t.undo}</button>
        <button type="button" className="bar-action" onClick={() => commit(createEmptyPlate())}><span aria-hidden="true">×</span>{t.clear}</button>
        <button type="button" className="bar-action" onClick={() => openDetails(selectedKey)}><span aria-hidden="true">⋯</span>{t.details}</button>
        <button type="button" className="bar-action" onClick={retrySync} disabled={saving || !actor}><span aria-hidden="true">↻</span>{saving ? t.syncing : t.sync}</button>
        <button type="button" className="bar-action bar-save" onClick={save} disabled={saving || !actor}><span aria-hidden="true">✓</span>{saving ? t.saving : t.save}</button>
      </div>

      {wellContextMenu && (
        <div
          className="well-context-menu"
          role="menu"
          aria-label={`${coordinate(wellContextMenu.rowIndex, wellContextMenu.columnIndex)} well menu`}
          style={{ left: wellContextMenu.x, top: wellContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <strong>{coordinate(wellContextMenu.rowIndex, wellContextMenu.columnIndex)}</strong>
          <button type="button" role="menuitem" onClick={() => markLowerConcentrationsAsGrowth(wellContextMenu)}>
            {locale === "ja" ? "このウェルより低濃度を発育あり" : "Mark lower concentrations as growth"}
          </button>
          <button type="button" role="menuitem" onClick={() => { openDetails(wellContextMenu.key); setWellContextMenu(null); }}>
            {t.details}
          </button>
        </div>
      )}

      {editingKey && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingKey(null); }}>
          <section className="well-modal" role="dialog" aria-modal="true" aria-labelledby="well-modal-title">
            <header>
              <div><p>{selectedCoordinate}</p><h2 id="well-modal-title">{t.modalTitle}</h2></div>
              <button type="button" className="modal-close" aria-label={locale === "ja" ? "閉じる" : "Close"} onClick={() => setEditingKey(null)}>×</button>
            </header>
            <form onSubmit={updateDetails}>
              <label><span>drug_name</span><input value={detailDraft.drugName} onChange={(event) => setDetailDraft({ ...detailDraft, drugName: event.target.value })} /></label>
              <div className="modal-field-row">
                <label><span>concentration</span><input type="number" min="0" step="any" value={detailDraft.concentration} onChange={(event) => setDetailDraft({ ...detailDraft, concentration: event.target.value })} /></label>
                <label><span>unit</span><input value={detailDraft.unit} onChange={(event) => setDetailDraft({ ...detailDraft, unit: event.target.value })} placeholder="µg/mL" /></label>
              </div>
              <label><span>note</span><textarea rows={4} value={detailDraft.note} onChange={(event) => setDetailDraft({ ...detailDraft, note: event.target.value })} placeholder={locale === "ja" ? "要確認の理由や観察メモ" : "Observation or review reason"} /></label>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setEditingKey(null)}>{t.cancel}</button>
                <button type="submit" className="primary-button">{t.update}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
