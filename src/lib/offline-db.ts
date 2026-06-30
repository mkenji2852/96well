import Dexie, { type EntityTable } from "dexie";
import type { WellDetailsMap } from "@/lib/plate-ui";
import type { SavePlateRequest, WellInput } from "@/types/domain";

export type OfflineSyncStatus = "DRAFT" | "QUEUED" | "SYNCING" | "CONFLICT" | "FAILED" | "SYNCED";

export interface OfflineActor {
  userId: string;
  organizationId: string;
}

interface LegacyPlateDraft {
  plateId: string;
  payload: SavePlateRequest;
  details?: WellDetailsMap;
  updatedAt: string;
}

interface LegacySyncItem {
  id?: number;
  plateId: string;
  payload: SavePlateRequest;
  queuedAt: string;
}

export interface PlateDraftV2 {
  draftId: string;
  environmentId: string;
  plateId: string;
  userId: string;
  organizationId: string;
  baseRevision: number;
  baseWellRevision: number;
  localRevision: number;
  baseWells: WellInput[];
  payload: SavePlateRequest;
  details?: WellDetailsMap;
  createdAt: string;
  updatedAt: string;
  syncStatus: OfflineSyncStatus;
  retryCount: number;
  nextRetryAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  idempotencyKey?: string | null;
}

export interface SyncQueueItemV2 {
  idempotencyKey: string;
  draftId: string;
  environmentId: string;
  plateId: string;
  userId: string;
  organizationId: string;
  baseRevision: number;
  baseWellRevision: number;
  localRevision: number;
  baseWells: WellInput[];
  payload: SavePlateRequest;
  createdAt: string;
  updatedAt: string;
  syncStatus: OfflineSyncStatus;
  retryCount: number;
  nextRetryAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export interface RevisionConflictPayload {
  plateId: string;
  clientBaseRevision: number;
  serverRevision: number;
  serverWellRevision: number;
  serverUpdatedAt: string;
  serverUpdatedBy: string | null;
  serverWells: WellInput[];
}

export interface OfflineSyncResult {
  kind: "synced" | "conflict" | "failed" | "retry_scheduled" | "skipped";
  plateId?: string;
  status?: OfflineSyncStatus;
  resultingRevision?: number;
  conflict?: RevisionConflictPayload;
  errorCode?: string;
  message?: string;
  nextRetryAt?: string | null;
}

export interface WellMergeConflict {
  key: string;
  rowIndex: number;
  columnIndex: number;
  baseState: string;
  localState: string;
  serverState: string;
}

export interface WellMergeResult {
  mergedWells: WellInput[];
  conflicts: WellMergeConflict[];
  localOnlyCount: number;
  serverOnlyCount: number;
  autoMergedCount: number;
}

const MAX_RETRY_COUNT = 5;
const STALE_SYNCING_MS = 2 * 60 * 1000;

const db = new Dexie("mic-plate-recorder") as Dexie & {
  plateDrafts: EntityTable<LegacyPlateDraft, "plateId">;
  syncQueue: EntityTable<LegacySyncItem, "id">;
  plateDraftsV2: EntityTable<PlateDraftV2, "draftId">;
  syncQueueV2: EntityTable<SyncQueueItemV2, "idempotencyKey">;
};

db.version(1).stores({
  plateDrafts: "plateId, updatedAt",
  syncQueue: "++id, plateId, queuedAt",
});

db.version(2).stores({
  plateDrafts: "plateId, updatedAt",
  syncQueue: "++id, plateId, queuedAt",
  plateDraftsV2: "draftId, environmentId, plateId, userId, organizationId, syncStatus, updatedAt, nextRetryAt",
  syncQueueV2: "idempotencyKey, draftId, environmentId, plateId, userId, organizationId, syncStatus, updatedAt, nextRetryAt",
});

function nowIso(): string {
  return new Date().toISOString();
}

export function offlineEnvironmentId(): string {
  const origin = typeof location === "undefined" ? "server" : location.origin;
  const mode = process.env.NODE_ENV ?? "development";
  return `${origin}:${mode}`;
}

export function draftIdFor(actor: OfflineActor, plateId: string, environmentId = offlineEnvironmentId()): string {
  return `${environmentId}::${actor.organizationId}::${actor.userId}::${plateId}`;
}

function randomId(): string {
  const cryptoLike = globalThis.crypto as Crypto | undefined;
  if (cryptoLike?.randomUUID) return cryptoLike.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createIdempotencyKey(actor: OfflineActor, plateId: string): string {
  return `plate-save:${actor.organizationId}:${actor.userId}:${plateId}:${randomId()}`;
}

function queueDue(item: SyncQueueItemV2, at = new Date()): boolean {
  return !item.nextRetryAt || Date.parse(item.nextRetryAt) <= at.getTime();
}

function backoffMs(retryCount: number): number {
  return Math.min(60_000, 1_000 * (2 ** Math.max(0, retryCount - 1)));
}

function wellStateMap(wells: WellInput[]): Map<string, WellInput> {
  return new Map(wells.map((well) => [`${well.rowIndex}:${well.columnIndex}`, well]));
}

function completeWells(wells: WellInput[]): WellInput[] {
  const map = wellStateMap(wells);
  return Array.from({ length: 8 }, (_, rowIndex) =>
    Array.from({ length: 12 }, (_, columnIndex): WellInput => {
      const existing = map.get(`${rowIndex}:${columnIndex}`);
      return existing ?? { rowIndex, columnIndex, state: "UNREAD", source: "MANUAL" };
    }),
  ).flat();
}

export function mergePlateWellChanges(baseWells: WellInput[], localWells: WellInput[], serverWells: WellInput[]): WellMergeResult {
  const base = wellStateMap(completeWells(baseWells));
  const local = wellStateMap(completeWells(localWells));
  const server = wellStateMap(completeWells(serverWells));
  const mergedWells: WellInput[] = [];
  const conflicts: WellMergeConflict[] = [];
  let localOnlyCount = 0;
  let serverOnlyCount = 0;
  let autoMergedCount = 0;

  for (let rowIndex = 0; rowIndex < 8; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < 12; columnIndex += 1) {
      const key = `${rowIndex}:${columnIndex}`;
      const baseWell = base.get(key);
      const localWell = local.get(key);
      const serverWell = server.get(key);
      const baseState = baseWell?.state ?? "UNREAD";
      const localState = localWell?.state ?? "UNREAD";
      const serverState = serverWell?.state ?? "UNREAD";
      const localChanged = localState !== baseState;
      const serverChanged = serverState !== baseState;
      let state = serverState;

      if (localChanged && !serverChanged) {
        state = localState;
        localOnlyCount += 1;
      } else if (!localChanged && serverChanged) {
        state = serverState;
        serverOnlyCount += 1;
      } else if (localChanged && serverChanged && localState === serverState) {
        state = localState;
        autoMergedCount += 1;
      } else if (localChanged && serverChanged && localState !== serverState) {
        state = serverState;
        conflicts.push({ key, rowIndex, columnIndex, baseState, localState, serverState });
      }

      mergedWells.push({ rowIndex, columnIndex, state, source: "MANUAL" });
    }
  }

  return { mergedWells, conflicts, localOnlyCount, serverOnlyCount, autoMergedCount };
}

export async function saveLocalDraft(
  plateId: string,
  actor: OfflineActor,
  payload: SavePlateRequest,
  baseRevision: number,
  baseWells: WellInput[],
  details?: WellDetailsMap,
  status: OfflineSyncStatus = "DRAFT",
): Promise<PlateDraftV2> {
  const draftId = draftIdFor(actor, plateId);
  const existing = await db.plateDraftsV2.get(draftId);
  const timestamp = nowIso();
  const draft: PlateDraftV2 = {
    draftId,
    environmentId: offlineEnvironmentId(),
    plateId,
    userId: actor.userId,
    organizationId: actor.organizationId,
    baseRevision,
    baseWellRevision: baseRevision,
    localRevision: (existing?.localRevision ?? 0) + 1,
    baseWells: completeWells(baseWells),
    payload: { ...payload, expectedRevision: baseRevision },
    details,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    syncStatus: status,
    retryCount: existing?.retryCount ?? 0,
    nextRetryAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    idempotencyKey: existing?.idempotencyKey ?? null,
  };
  await db.plateDraftsV2.put(draft);
  return draft;
}

export async function loadLocalDraft(plateId: string, actor: OfflineActor): Promise<PlateDraftV2 | undefined> {
  return db.plateDraftsV2.get(draftIdFor(actor, plateId));
}

export async function deleteLocalDraft(plateId: string, actor: OfflineActor): Promise<void> {
  const draftId = draftIdFor(actor, plateId);
  await db.transaction("rw", db.plateDraftsV2, db.syncQueueV2, async () => {
    await db.syncQueueV2.where("draftId").equals(draftId).delete();
    await db.plateDraftsV2.delete(draftId);
  });
}

export async function clearOfflineDataForActor(actor: OfflineActor): Promise<void> {
  const drafts = (await db.plateDraftsV2.toArray()).filter((item) =>
    item.userId === actor.userId && item.organizationId === actor.organizationId && item.environmentId === offlineEnvironmentId(),
  );
  const queue = (await db.syncQueueV2.toArray()).filter((item) =>
    item.userId === actor.userId && item.organizationId === actor.organizationId && item.environmentId === offlineEnvironmentId(),
  );
  await db.transaction("rw", db.plateDraftsV2, db.syncQueueV2, async () => {
    await Promise.all(drafts.map((item) => db.plateDraftsV2.delete(item.draftId)));
    await Promise.all(queue.map((item) => db.syncQueueV2.delete(item.idempotencyKey)));
  });
}

export async function queuePlateSave(
  plateId: string,
  actor: OfflineActor,
  payload: SavePlateRequest,
  baseRevision: number,
  baseWells: WellInput[],
): Promise<SyncQueueItemV2> {
  const draftId = draftIdFor(actor, plateId);
  const existingDraft = await db.plateDraftsV2.get(draftId);
  const idempotencyKey = existingDraft?.idempotencyKey ?? createIdempotencyKey(actor, plateId);
  const timestamp = nowIso();
  const localRevision = existingDraft?.localRevision ?? 1;
  const queueItem: SyncQueueItemV2 = {
    idempotencyKey,
    draftId,
    environmentId: offlineEnvironmentId(),
    plateId,
    userId: actor.userId,
    organizationId: actor.organizationId,
    baseRevision,
    baseWellRevision: baseRevision,
    localRevision,
    baseWells: completeWells(baseWells),
    payload: { ...payload, expectedRevision: baseRevision, idempotencyKey },
    createdAt: existingDraft?.createdAt ?? timestamp,
    updatedAt: timestamp,
    syncStatus: "QUEUED",
    retryCount: existingDraft?.retryCount ?? 0,
    nextRetryAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
  const draft = existingDraft ?? (await saveLocalDraft(plateId, actor, payload, baseRevision, baseWells, undefined, "QUEUED"));
  await db.transaction("rw", db.plateDraftsV2, db.syncQueueV2, async () => {
    await db.syncQueueV2.where("draftId").equals(draftId).delete();
    await db.syncQueueV2.put(queueItem);
    await db.plateDraftsV2.put({
      ...draft,
      idempotencyKey,
      payload: { ...payload, expectedRevision: baseRevision, idempotencyKey },
      syncStatus: "QUEUED",
      updatedAt: timestamp,
      retryCount: queueItem.retryCount,
      nextRetryAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    });
  });
  return queueItem;
}

export async function recoverStaleSyncing(actor: OfflineActor): Promise<void> {
  const cutoff = Date.now() - STALE_SYNCING_MS;
  const items = (await db.syncQueueV2.toArray()).filter((item) =>
    item.userId === actor.userId &&
    item.organizationId === actor.organizationId &&
    item.environmentId === offlineEnvironmentId() &&
    item.syncStatus === "SYNCING" &&
    Date.parse(item.updatedAt) < cutoff
  );
  await db.transaction("rw", db.plateDraftsV2, db.syncQueueV2, async () => {
    for (const item of items) {
      const restored = { ...item, syncStatus: "QUEUED" as const, updatedAt: nowIso() };
      await db.syncQueueV2.put(restored);
      const draft = await db.plateDraftsV2.get(item.draftId);
      if (draft) await db.plateDraftsV2.put({ ...draft, syncStatus: "QUEUED", updatedAt: restored.updatedAt });
    }
  });
}

async function markQueueFailure(item: SyncQueueItemV2, code: string, message: string, retryable: boolean): Promise<OfflineSyncResult> {
  const retryCount = item.retryCount + 1;
  const exhausted = retryCount >= MAX_RETRY_COUNT;
  const nextRetryAt = retryable && !exhausted ? new Date(Date.now() + backoffMs(retryCount)).toISOString() : null;
  const syncStatus: OfflineSyncStatus = retryable && !exhausted ? "QUEUED" : "FAILED";
  const next = {
    ...item,
    syncStatus,
    retryCount,
    nextRetryAt,
    lastErrorCode: code,
    lastErrorMessage: message,
    updatedAt: nowIso(),
  };
  await db.transaction("rw", db.plateDraftsV2, db.syncQueueV2, async () => {
    await db.syncQueueV2.put(next);
    const draft = await db.plateDraftsV2.get(item.draftId);
    if (draft) {
      await db.plateDraftsV2.put({
        ...draft,
        syncStatus,
        retryCount,
        nextRetryAt,
        lastErrorCode: code,
        lastErrorMessage: message,
        updatedAt: next.updatedAt,
      });
    }
  });
  return {
    kind: syncStatus === "QUEUED" ? "retry_scheduled" : "failed",
    plateId: item.plateId,
    status: syncStatus,
    errorCode: code,
    message,
    nextRetryAt,
  };
}

async function markConflict(item: SyncQueueItemV2, conflict: RevisionConflictPayload): Promise<OfflineSyncResult> {
  const timestamp = nowIso();
  await db.transaction("rw", db.plateDraftsV2, db.syncQueueV2, async () => {
    await db.syncQueueV2.put({
      ...item,
      syncStatus: "CONFLICT",
      lastErrorCode: "REVISION_CONFLICT",
      lastErrorMessage: "サーバー版とローカルdraftが競合しています。",
      updatedAt: timestamp,
    });
    const draft = await db.plateDraftsV2.get(item.draftId);
    if (draft) {
      await db.plateDraftsV2.put({
        ...draft,
        syncStatus: "CONFLICT",
        lastErrorCode: "REVISION_CONFLICT",
        lastErrorMessage: "サーバー版とローカルdraftが競合しています。",
        updatedAt: timestamp,
      });
    }
  });
  return { kind: "conflict", plateId: item.plateId, status: "CONFLICT", conflict };
}

async function markSynced(item: SyncQueueItemV2, resultingRevision: number): Promise<OfflineSyncResult> {
  await db.transaction("rw", db.plateDraftsV2, db.syncQueueV2, async () => {
    const draft = await db.plateDraftsV2.get(item.draftId);
    await db.syncQueueV2.delete(item.idempotencyKey);
    if (!draft || draft.localRevision <= item.localRevision) {
      await db.plateDraftsV2.delete(item.draftId);
    } else {
      await db.plateDraftsV2.put({
        ...draft,
        baseRevision: resultingRevision,
        baseWellRevision: resultingRevision,
        baseWells: item.payload.wells,
        syncStatus: "DRAFT",
        retryCount: 0,
        nextRetryAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        idempotencyKey: null,
        updatedAt: nowIso(),
      });
    }
  });
  return { kind: "synced", plateId: item.plateId, status: "SYNCED", resultingRevision };
}

async function syncQueueItem(item: SyncQueueItemV2): Promise<OfflineSyncResult> {
  const syncing = { ...item, syncStatus: "SYNCING" as const, updatedAt: nowIso() };
  await db.syncQueueV2.put(syncing);
  try {
    const response = await fetch(`/api/plates/${item.plateId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "if-match": String(item.baseRevision),
        "idempotency-key": item.idempotencyKey,
      },
      body: JSON.stringify({ ...item.payload, expectedRevision: item.baseRevision, idempotencyKey: item.idempotencyKey }),
    });
    const data = await response.json().catch(() => null) as {
      wellRevision?: number;
      error?: { code?: string; message?: string };
      conflict?: RevisionConflictPayload;
    } | null;

    if (response.ok) return markSynced(item, data?.wellRevision ?? item.baseRevision + 1);
    if (response.status === 409 && data?.conflict) return markConflict(item, data.conflict);
    if (response.status === 401) return markQueueFailure(item, "UNAUTHENTICATED", "ログイン状態の回復後に再試行してください。", false);
    if (response.status === 403 || response.status === 404) return markQueueFailure(item, data?.error?.code ?? String(response.status), data?.error?.message ?? "このdraftは同期できません。", false);
    if (response.status === 400 || response.status === 422 || response.status === 428) {
      return markQueueFailure(item, data?.error?.code ?? "INVALID_REQUEST", data?.error?.message ?? "入力内容の修正が必要です。", false);
    }
    return markQueueFailure(item, data?.error?.code ?? String(response.status), data?.error?.message ?? "一時的なエラーです。", true);
  } catch {
    return markQueueFailure(item, "NETWORK_ERROR", "ネットワーク接続を確認してください。", true);
  }
}

async function withSyncLock<T>(actor: OfflineActor, callback: () => Promise<T>): Promise<T> {
  const lockName = `mic-plate-sync:${offlineEnvironmentId()}:${actor.organizationId}:${actor.userId}`;
  const nav = typeof navigator === "undefined" ? undefined : navigator as Navigator & {
    locks?: { request<TValue>(name: string, callback: () => Promise<TValue>): Promise<TValue> };
  };
  if (nav?.locks) return nav.locks.request(lockName, callback);
  return callback();
}

function broadcastSync(message: Record<string, unknown>): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("mic-plate-offline-sync");
  channel.postMessage({ ...message, at: nowIso() });
  channel.close();
}

export async function flushSyncQueue(actor: OfflineActor, options: { force?: boolean } = {}): Promise<OfflineSyncResult[]> {
  return withSyncLock(actor, async () => {
    await recoverStaleSyncing(actor);
    const environmentId = offlineEnvironmentId();
    const items = (await db.syncQueueV2.toArray())
      .filter((item) =>
        item.userId === actor.userId &&
        item.organizationId === actor.organizationId &&
        item.environmentId === environmentId &&
        (item.syncStatus === "QUEUED" || item.syncStatus === "FAILED") &&
        (options.force || queueDue(item))
      )
      .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));

    const results: OfflineSyncResult[] = [];
    for (const item of items) {
      broadcastSync({ type: "OFFLINE_SYNC_STARTED", plateId: item.plateId });
      const result = await syncQueueItem(item);
      broadcastSync({ type: result.kind, plateId: item.plateId, status: result.status });
      results.push(result);
    }
    return results.length > 0 ? results : [{ kind: "skipped" }];
  });
}

export async function pendingQueueForActor(actor: OfflineActor): Promise<SyncQueueItemV2[]> {
  const environmentId = offlineEnvironmentId();
  return (await db.syncQueueV2.toArray()).filter((item) =>
    item.userId === actor.userId &&
    item.organizationId === actor.organizationId &&
    item.environmentId === environmentId
  );
}

export async function resolveDraftConflict(
  plateId: string,
  actor: OfflineActor,
  payload: SavePlateRequest,
  serverRevision: number,
  serverWells: WellInput[],
  details?: WellDetailsMap,
): Promise<PlateDraftV2> {
  const draftId = draftIdFor(actor, plateId);
  await db.syncQueueV2.where("draftId").equals(draftId).delete();
  return saveLocalDraft(plateId, actor, payload, serverRevision, serverWells, details, "DRAFT");
}
