import type { RawMicOperator } from "@/types/domain";

export interface PopulationMic {
  sampleId: string;
  drugName: string;
  unit: string;
  organism: string | null;
  value: number | null;
  operator: RawMicOperator | null;
  needsReview: boolean;
  exclusionReason?: string;
}

interface Bound { value: number; open: boolean }
function bounds(mic: PopulationMic): { lower: Bound; upper: Bound } {
  const value = mic.value!;
  if (mic.operator === "<" || mic.operator === "<=") return { lower: { value: 0, open: true }, upper: { value, open: mic.operator === "<" } };
  if (mic.operator === ">" || mic.operator === ">=") return { lower: { value, open: mic.operator === ">" }, upper: { value: Infinity, open: true } };
  return { lower: { value, open: false }, upper: { value, open: false } };
}

export function percentileMic(values: PopulationMic[], fraction: number): string {
  if (!values.length) return "";
  if (fraction <= 0 || fraction > 1) throw new Error("Percentile must be in (0, 1].");
  const rank = Math.ceil(values.length * fraction) - 1;
  const intervals = values.map(bounds);
  const lower = intervals.map(item => item.lower).sort((a, b) => a.value - b.value || Number(a.open) - Number(b.open))[rank];
  const upper = intervals.map(item => item.upper).sort((a, b) => a.value - b.value || Number(b.open) - Number(a.open))[rank];
  if (lower.value === upper.value && !lower.open && !upper.open) return String(lower.value);
  if (lower.value === 0 && Number.isFinite(upper.value)) return `${upper.open ? "<" : "≤"}${upper.value}`;
  if (upper.value === Infinity && lower.value > 0) return `${lower.open ? ">" : "≥"}${lower.value}`;
  if (lower.value === 0 && upper.value === Infinity) return "未確定";
  return `${lower.open ? ">" : "≥"}${lower.value} ～ ${upper.open ? "<" : "≤"}${upper.value}`;
}

export function calculateMicStatistics(values: PopulationMic[]) {
  const groups = new Map<string, PopulationMic[]>();
  for (const mic of values) {
    const key = JSON.stringify([mic.drugName, mic.unit, mic.organism]);
    groups.set(key, [...(groups.get(key) ?? []), mic]);
  }
  return [...groups.values()].map(group => {
    const bySample = new Map<string, PopulationMic[]>();
    for (const mic of group) bySample.set(mic.sampleId, [...(bySample.get(mic.sampleId) ?? []), mic]);
    const eligible: PopulationMic[] = [];
    let duplicateSamples = 0;
    let invalidSamples = 0;
    const exclusionReasons = new Set<string>();
    for (const sample of bySample.values()) {
      if (sample.length !== 1) { duplicateSamples++; exclusionReasons.add("同一Sampleの同一薬剤・単位に複数の測定があります"); continue; }
      const mic = sample[0];
      if (mic.needsReview || mic.value === null || !Number.isFinite(mic.value) || mic.value <= 0 || !mic.operator) {
        invalidSamples++;
        exclusionReasons.add(mic.exclusionReason || (mic.needsReview ? "要確認のMICです" : "MICが未確定です"));
        continue;
      }
      eligible.push(mic);
    }
    return {
      drugName: group[0].drugName, unit: group[0].unit, organism: group[0].organism,
      totalSamples: bySample.size, includedSamples: eligible.length, invalidSamples, duplicateSamples,
      qualifiedSamples: eligible.filter(mic => mic.operator !== "=").length,
      exclusionReasons: [...exclusionReasons],
      mic50: percentileMic(eligible, 0.5), mic90: percentileMic(eligible, 0.9),
    };
  });
}
