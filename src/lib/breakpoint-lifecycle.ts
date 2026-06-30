import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

export type LifecycleStatus = "DRAFT" | "APPROVED" | "RETIRED";
export const BREAKPOINT_CONTENT_HASH_ALGORITHM = "sha256" as const;
export const BREAKPOINT_CONTENT_HASH_VERSION = 1 as const;

export class BreakpointLifecycleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BreakpointLifecycleError";
  }
}

export interface HashableBreakpointRule {
  drugName: string;
  organism: string | null;
  standard: string;
  version: string;
  susceptibleMax: number;
  resistantMin: number;
  intermediateMin: number | null;
  intermediateMax: number | null;
  unit: string;
  method: string;
  exceptionJson: unknown;
}

export interface HashableBreakpointSet {
  standard: string;
  version: string;
  organism: string | null;
  unit: string;
  method: string;
  effectiveFrom: Date | string | null;
  effectiveTo: Date | string | null;
  sourceDocumentReference: string | null;
  sourceDocumentChecksum: string | null;
  rules: HashableBreakpointRule[];
}

function normalizedText(value: string | null): string | null {
  return value == null ? null : value.trim().normalize("NFC");
}

function normalizedDate(value: Date | string | null): string | null {
  if (value == null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function stableRuleKey(rule: HashableBreakpointRule): string {
  return [
    normalizedText(rule.drugName),
    normalizedText(rule.organism),
    normalizedText(rule.unit),
    normalizedText(rule.method),
    rule.susceptibleMax,
    rule.intermediateMin ?? "",
    rule.intermediateMax ?? "",
    rule.resistantMin,
    JSON.stringify(canonicalize(rule.exceptionJson)),
  ].join("\u001f");
}

export function canonicalBreakpointContent(set: HashableBreakpointSet): string {
  const rules = [...set.rules]
    .sort((left, right) => stableRuleKey(left).localeCompare(stableRuleKey(right)))
    .map((rule) => ({
      drugName: normalizedText(rule.drugName),
      organism: normalizedText(rule.organism),
      standard: normalizedText(rule.standard),
      version: normalizedText(rule.version),
      susceptibleMax: rule.susceptibleMax,
      resistantMin: rule.resistantMin,
      intermediateMin: rule.intermediateMin,
      intermediateMax: rule.intermediateMax,
      unit: normalizedText(rule.unit),
      method: normalizedText(rule.method),
      exceptionJson: canonicalize(rule.exceptionJson),
    }));
  return JSON.stringify(canonicalize({
    standard: normalizedText(set.standard),
    version: normalizedText(set.version),
    organism: normalizedText(set.organism),
    unit: normalizedText(set.unit),
    method: normalizedText(set.method),
    effectiveFrom: normalizedDate(set.effectiveFrom),
    effectiveTo: normalizedDate(set.effectiveTo),
    sourceDocumentReference: normalizedText(set.sourceDocumentReference),
    sourceDocumentChecksum: normalizedText(set.sourceDocumentChecksum),
    rules,
  }));
}

export function calculateBreakpointContentHash(set: HashableBreakpointSet): string {
  return createHash(BREAKPOINT_CONTENT_HASH_ALGORITHM).update(canonicalBreakpointContent(set), "utf8").digest("hex");
}

export function assertDraft(status: LifecycleStatus): void {
  if (status !== "DRAFT") {
    throw new BreakpointLifecycleError(
      "BREAKPOINT_IMMUTABLE",
      "承認済みまたは失効済みのBreakpointSetは変更できません。新しいDRAFTへcloneしてください。",
      409,
    );
  }
}

export function validateBreakpointSetForApproval(set: HashableBreakpointSet): string[] {
  const errors: string[] = [];
  if (!set.standard.trim()) errors.push("standardが必要です。");
  if (!set.version.trim()) errors.push("versionが必要です。");
  if (!set.unit.trim()) errors.push("unitが必要です。");
  if (!set.method.trim()) errors.push("methodが必要です。");
  if (set.rules.length === 0) errors.push("ruleを1件以上登録してください。");
  if (set.effectiveFrom && set.effectiveTo && new Date(set.effectiveFrom) >= new Date(set.effectiveTo)) {
    errors.push("effectiveToはeffectiveFromより後に設定してください。");
  }

  const keys = new Set<string>();
  for (const rule of set.rules) {
    const key = [
      normalizedText(rule.drugName)?.toLocaleLowerCase(),
      normalizedText(rule.organism)?.toLocaleLowerCase(),
      normalizedText(rule.unit)?.toLocaleLowerCase(),
      normalizedText(rule.method)?.toLocaleLowerCase(),
    ].join("|");
    if (keys.has(key)) errors.push(`${rule.drugName}: drug/organism/unit/methodが重複しています。`);
    keys.add(key);
    if (rule.standard !== set.standard || rule.version !== set.version) {
      errors.push(`${rule.drugName}: standard/versionがBreakpointSetと一致しません。`);
    }
    if ((rule.organism ?? null) !== (set.organism ?? null)) {
      errors.push(`${rule.drugName}: organism条件がBreakpointSetと一致しません。`);
    }
    if (rule.unit !== set.unit || rule.method !== set.method) {
      errors.push(`${rule.drugName}: unit/methodがBreakpointSetと一致しません。`);
    }
    if (rule.susceptibleMax >= rule.resistantMin) {
      errors.push(`${rule.drugName}: S/R境界値が矛盾しています。`);
    }
    if (rule.intermediateMin != null && rule.intermediateMin <= rule.susceptibleMax) {
      errors.push(`${rule.drugName}: intermediateMinがS境界以下です。`);
    }
    if (rule.intermediateMax != null && rule.intermediateMax >= rule.resistantMin) {
      errors.push(`${rule.drugName}: intermediateMaxがR境界以上です。`);
    }
    if (rule.intermediateMin != null && rule.intermediateMax != null && rule.intermediateMin > rule.intermediateMax) {
      errors.push(`${rule.drugName}: intermediate境界が逆転しています。`);
    }
  }
  return errors;
}

export function assertBreakpointContentHash(
  set: HashableBreakpointSet & {
    contentHash: string | null;
    contentHashAlgorithm?: string | null;
    contentHashVersion?: number | null;
  },
): string {
  if (
    (set.contentHashAlgorithm ?? BREAKPOINT_CONTENT_HASH_ALGORITHM) !== BREAKPOINT_CONTENT_HASH_ALGORITHM ||
    (set.contentHashVersion ?? BREAKPOINT_CONTENT_HASH_VERSION) !== BREAKPOINT_CONTENT_HASH_VERSION
  ) {
    throw new BreakpointLifecycleError(
      "BREAKPOINT_HASH_MISMATCH",
      "BreakpointSetのhash方式が現在の検証方式と一致しないため、正式処理を拒否しました。",
      409,
    );
  }
  const calculated = calculateBreakpointContentHash(set);
  if (!set.contentHash || set.contentHash !== calculated) {
    throw new BreakpointLifecycleError(
      "BREAKPOINT_HASH_MISMATCH",
      "BreakpointSetの内容hashが一致しないため、正式処理を拒否しました。",
      409,
    );
  }
  return calculated;
}

export function breakpointInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
