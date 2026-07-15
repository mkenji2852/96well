"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { PlateEditor } from "@/components/plate-editor";
import { wellKey, wellName, type DrugWellAssignment } from "@/lib/drug-layout";
import { COMMON_ORGANISMS, ORGANISM_DATALIST_ID } from "@/lib/organisms";
import { ROW_LABELS, type CreateSampleRequest, type DrugConfigInput, type PlateView } from "@/types/domain";

type Locale = "ja" | "en";
type Stage = "sample" | "layout" | "settings" | "imageBatch";
type LayoutMode = "sample" | "template";

interface ApiErrorPayload {
  error?: string | { code?: string; message?: string };
}

interface SampleListItem {
  id: string;
  sampleCode: string;
  organism: string | null;
  plates: Array<{ id: string; name: string; status: string }>;
}

interface DrugLayoutDraft {
  id: string;
  drugName: string;
  unit: string;
  wells: DrugWellAssignment[];
}

interface PlateTemplate {
  id: string;
  name: string;
  drugs: DrugLayoutDraft[];
  createdAt: string;
}

interface LocalSettings {
  organisms: string[];
  breakpointSets: string[];
}

interface BatchUploadStatus {
  fileName: string;
  status: "pending" | "uploading" | "done" | "error";
  message: string;
  previewUrl?: string;
}

interface WellCoordinate {
  rowIndex: number;
  columnIndex: number;
}

const defaultConcentrations = "64,32,16,8,4,2,1,0.5,0.25,0.125,0.0625,0.03125";
const PLATE_TEMPLATES_STORAGE_KEY = "mic-plate-templates-v1";
const LOCAL_SETTINGS_STORAGE_KEY = "mic-local-settings-v1";

const copy = {
  ja: {
    title: "MIC Plate Recorder",
    subtitle: "研究用・ローカル利用向けに、Sample、菌名、プレート、薬剤配置を固定してから96ウェル入力へ進みます。",
    existing: "既存Sample / Plateを開く",
    newSample: "新規Sample",
    sampleCode: "Sample-ID",
    organism: "菌名（任意・入力またはリスト選択）",
    plateType: "プレート",
    openPlate: "選択したプレートを開く",
    deleteSample: "Sample削除",
    deleteSampleConfirm: "このSample-IDと関連するPlateを削除します。元に戻せません。削除しますか？",
    deleteSampleDone: "Sampleを削除しました。",
    nextLayout: "薬剤配置へ",
    backSample: "Sample選択へ戻る",
    layoutTitle: "プレート内の薬剤配置",
    layoutHelp: "ウェルをドラッグして範囲選択し、薬剤名・単位・濃度を割り当てます。濃度は1個なら選択範囲すべてへ、複数ならA1→A12→B1の順で割り当てます。",
    addDrug: "薬剤を追加",
    assignSelection: "選択ウェルへ割り当て",
    clearSelection: "選択解除",
    removeSelected: "選択ウェルの割り当て削除",
    selectedWells: "選択ウェル",
    assignedWells: "割り当て済み",
    drugName: "薬剤名",
    unit: "単位",
    concentrations: "選択範囲の濃度",
    createAndOpen: "プレート入力へ",
    creating: "作成中…",
    noSamples: "既存Sampleがありません。新規作成してください。",
    safety: "研究用・ローカル・非臨床利用です。患者識別情報や正式検査報告には使用しないでください。",
  },
  en: {
    title: "MIC Plate Recorder",
    subtitle: "For research/local use: choose a sample, organism, plate, and fixed drug layout before 96-well entry.",
    existing: "Open existing Sample / Plate",
    newSample: "New sample",
    sampleCode: "Sample ID",
    organism: "Organism (optional; type or choose)",
    plateType: "Plate",
    openPlate: "Open selected plate",
    deleteSample: "Delete sample",
    deleteSampleConfirm: "Delete this Sample ID and related plates? This cannot be undone.",
    deleteSampleDone: "Sample deleted.",
    nextLayout: "Configure drug layout",
    backSample: "Back to sample selection",
    layoutTitle: "Drug layout on plate",
    layoutHelp: "Drag over wells to select a range, then assign drug name, unit, and concentrations. One concentration repeats; multiple values are assigned A1→A12→B1 order.",
    addDrug: "Add drug",
    assignSelection: "Assign to selected wells",
    clearSelection: "Clear selection",
    removeSelected: "Remove selected assignments",
    selectedWells: "Selected wells",
    assignedWells: "Assigned wells",
    drugName: "Drug name",
    unit: "Unit",
    concentrations: "Concentrations for selection",
    createAndOpen: "Start plate entry",
    creating: "Creating…",
    noSamples: "No existing samples. Create a new one.",
    safety: "Research/local/non-clinical use only. Do not enter patient identifiers or use for official reporting.",
  },
} as const;

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    const trimmed = text.trim();
    const detail = trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")
      ? "Server returned an HTML error page instead of JSON."
      : trimmed;
    throw new Error(detail || `Unexpected non-JSON response (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function apiErrorMessage(payload: ApiErrorPayload | null, fallback: string): string {
  if (payload?.error === "SAMPLE_CODE_EXISTS") return "Sample ID already exists.";
  if (typeof payload?.error === "string") return payload.error;
  if (payload?.error?.message) return payload.error.message;
  return fallback;
}

function userFacingError(caught: unknown, fallback: string): string {
  if (caught instanceof TypeError && /fetch/i.test(caught.message)) {
    return "ローカルアプリのサーバーに接続できません。ターミナルで pnpm dev が起動しているか確認してから、画面を再読み込みしてください。";
  }
  return caught instanceof Error ? caught.message : fallback;
}

function createDrugLayouts(): DrugLayoutDraft[] {
  return [{
    id: "drug-1",
    drugName: "Ampicillin",
    unit: "µg/mL",
    wells: [],
  }];
}

function cloneDrugLayouts(layouts: DrugLayoutDraft[]): DrugLayoutDraft[] {
  return layouts.map((drug) => ({
    ...drug,
    wells: drug.wells.map((well) => ({ ...well })),
  }));
}

function loadPlateTemplates(): PlateTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PLATE_TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlateTemplate[];
    return Array.isArray(parsed) ? parsed.filter((template) => template.id && template.name) : [];
  } catch {
    return [];
  }
}

function savePlateTemplates(templates: PlateTemplate[]) {
  window.localStorage.setItem(PLATE_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
}

function loadLocalSettings(): LocalSettings {
  if (typeof window === "undefined") return { organisms: [], breakpointSets: [] };
  try {
    const raw = window.localStorage.getItem(LOCAL_SETTINGS_STORAGE_KEY);
    if (!raw) return { organisms: [], breakpointSets: [] };
    const parsed = JSON.parse(raw) as Partial<LocalSettings>;
    return {
      organisms: Array.isArray(parsed.organisms) ? parsed.organisms.filter(Boolean) : [],
      breakpointSets: Array.isArray(parsed.breakpointSets) ? parsed.breakpointSets.filter(Boolean) : [],
    };
  } catch {
    return { organisms: [], breakpointSets: [] };
  }
}

function saveLocalSettings(settings: LocalSettings) {
  window.localStorage.setItem(LOCAL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function parseConcentrations(value: string): number[] {
  return value.split(",").map((item) => Number(item.trim()));
}

function parseWellKey(key: string): WellCoordinate {
  const [rowIndex, columnIndex] = key.split("-").map(Number);
  return { rowIndex, columnIndex };
}

function rangeKeys(start: WellCoordinate, end: WellCoordinate): Set<string> {
  const minRow = Math.min(start.rowIndex, end.rowIndex);
  const maxRow = Math.max(start.rowIndex, end.rowIndex);
  const minColumn = Math.min(start.columnIndex, end.columnIndex);
  const maxColumn = Math.max(start.columnIndex, end.columnIndex);
  const keys = new Set<string>();
  for (let rowIndex = minRow; rowIndex <= maxRow; rowIndex += 1) {
    for (let columnIndex = minColumn; columnIndex <= maxColumn; columnIndex += 1) {
      keys.add(wellKey(rowIndex, columnIndex));
    }
  }
  return keys;
}

function sortedSelection(keys: Set<string>): WellCoordinate[] {
  return Array.from(keys)
    .map(parseWellKey)
    .sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
}

function selectionLabel(keys: Set<string>): string {
  const coordinates = sortedSelection(keys);
  if (coordinates.length === 0) return "0";
  if (coordinates.length === 1) return wellName(coordinates[0].rowIndex, coordinates[0].columnIndex);
  return `${wellName(coordinates[0].rowIndex, coordinates[0].columnIndex)}〜${wellName(coordinates[coordinates.length - 1].rowIndex, coordinates[coordinates.length - 1].columnIndex)} (${coordinates.length})`;
}

function rowKeys(rowIndex: number): Set<string> {
  return rangeKeys({ rowIndex, columnIndex: 0 }, { rowIndex, columnIndex: 11 });
}

function columnKeys(columnIndex: number): Set<string> {
  return rangeKeys({ rowIndex: 0, columnIndex }, { rowIndex: 7, columnIndex });
}

function toDrugConfigInputs(layouts: DrugLayoutDraft[]): DrugConfigInput[] {
  return layouts
    .filter((drug) => drug.wells.length > 0)
    .map((drug, index) => ({
      rowIndex: index,
      drugName: drug.drugName.trim(),
      unit: drug.unit.trim(),
      wells: drug.wells,
    }));
}

function hasInvalidDrugConfig(drugs: DrugConfigInput[]): boolean {
  return drugs.some((drug) =>
    !drug.drugName ||
    !drug.unit ||
    !drug.wells?.length ||
    drug.wells.some((well) => !Number.isFinite(well.concentration) || well.concentration <= 0),
  );
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>("ja");
  const [stage, setStage] = useState<Stage>("sample");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("sample");
  const [samples, setSamples] = useState<SampleListItem[]>([]);
  const [selectedPlateId, setSelectedPlateId] = useState("");
  const [sampleCode, setSampleCode] = useState("");
  const [organism, setOrganism] = useState("");
  const [plateType, setPlateType] = useState("96-well standard");
  const [plateTemplates, setPlateTemplates] = useState<PlateTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [plateTemplateName, setPlateTemplateName] = useState("96-well standard");
  const [localOrganisms, setLocalOrganisms] = useState<string[]>([]);
  const [localBreakpointSets, setLocalBreakpointSets] = useState<string[]>([]);
  const [settingsOrganismDraft, setSettingsOrganismDraft] = useState("");
  const [settingsBreakpointDraft, setSettingsBreakpointDraft] = useState("");
  const [imageBatchFiles, setImageBatchFiles] = useState<File[]>([]);
  const [imageBatchStatuses, setImageBatchStatuses] = useState<BatchUploadStatus[]>([]);
  const [drugLayouts, setDrugLayouts] = useState<DrugLayoutDraft[]>(() => createDrugLayouts());
  const [activeDrugId, setActiveDrugId] = useState("drug-1");
  const [selectedWellKeys, setSelectedWellKeys] = useState<Set<string>>(() => new Set());
  const [dragStart, setDragStart] = useState<WellCoordinate | null>(null);
  const [assignmentConcentrations, setAssignmentConcentrations] = useState(defaultConcentrations);
  const [plate, setPlate] = useState<PlateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = copy[locale];

  const selectedSample = useMemo(
    () => samples.find((sample) => sample.plates.some((candidate) => candidate.id === selectedPlateId)) ?? null,
    [samples, selectedPlateId],
  );
  const selectedTemplate = useMemo(
    () => plateTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [plateTemplates, selectedTemplateId],
  );
  const availableOrganisms = useMemo(
    () => Array.from(new Set([...COMMON_ORGANISMS, ...localOrganisms])).sort((a, b) => a.localeCompare(b)),
    [localOrganisms],
  );
  const imageBatchPreviews = useMemo(
    () => typeof window === "undefined" ? [] : imageBatchFiles.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [imageBatchFiles],
  );

  useEffect(() => () => {
    imageBatchPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [imageBatchPreviews]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    const templates = loadPlateTemplates();
    setPlateTemplates(templates);
    if (templates[0]) {
      setSelectedTemplateId(templates[0].id);
      setPlateType(templates[0].name);
    }
    const settings = loadLocalSettings();
    setLocalOrganisms(settings.organisms);
    setLocalBreakpointSets(settings.breakpointSets);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/samples")
      .then((response) => readJsonResponse<{ samples: SampleListItem[] } & ApiErrorPayload>(response))
      .then((data) => {
        if (cancelled) return;
        setSamples(data.samples ?? []);
        const firstPlate = data.samples?.flatMap((sample) => sample.plates)[0];
        if (firstPlate) setSelectedPlateId(firstPlate.id);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const activeDrug = drugLayouts.find((drug) => drug.id === activeDrugId) ?? drugLayouts[0];
  const assignedWellMap = useMemo(() => {
    const map = new Map<string, { drugId: string; drugName: string; unit: string; concentration: number }>();
    for (const drug of drugLayouts) {
      for (const assignment of drug.wells) {
        map.set(wellKey(assignment.rowIndex, assignment.columnIndex), {
          drugId: drug.id,
          drugName: drug.drugName,
          unit: drug.unit,
          concentration: assignment.concentration,
        });
      }
    }
    return map;
  }, [drugLayouts]);

  const updateDrugLayout = (drugId: string, patch: Partial<DrugLayoutDraft>) => {
    setDrugLayouts((current) => current.map((drug) => drug.id === drugId ? { ...drug, ...patch } : drug));
  };

  const addDrugLayout = () => {
    const id = `drug-${Date.now()}`;
    setDrugLayouts((current) => [...current, { id, drugName: "", unit: "µg/mL", wells: [] }]);
    setActiveDrugId(id);
  };

  const beginWellSelection = (coordinate: WellCoordinate) => {
    setDragStart(coordinate);
    setSelectedWellKeys(new Set([wellKey(coordinate.rowIndex, coordinate.columnIndex)]));
  };

  const extendWellSelection = (coordinate: WellCoordinate) => {
    if (!dragStart) return;
    setSelectedWellKeys(rangeKeys(dragStart, coordinate));
  };

  const endWellSelection = () => setDragStart(null);

  const assignSelection = () => {
    setError("");
    if (!activeDrug) return;
    const selected = sortedSelection(selectedWellKeys);
    if (selected.length === 0) {
      setError(locale === "ja" ? "割り当てるウェルを選択してください。" : "Select wells to assign.");
      return;
    }
    const values = parseConcentrations(assignmentConcentrations);
    if (
      values.length === 0 ||
      values.some((value) => !Number.isFinite(value) || value <= 0) ||
      (values.length !== 1 && values.length !== selected.length)
    ) {
      setError(locale === "ja"
        ? "濃度は正の数値で、1個または選択ウェル数と同じ個数を入力してください。"
        : "Enter positive concentration values: either one value or one per selected well.");
      return;
    }
    if (!activeDrug.drugName.trim() || !activeDrug.unit.trim()) {
      setError(locale === "ja" ? "薬剤名と単位を入力してください。" : "Enter drug name and unit.");
      return;
    }

    const selectedKeys = new Set(selected.map((well) => wellKey(well.rowIndex, well.columnIndex)));
    const nextAssignments = selected.map((well, index) => ({
      ...well,
      concentration: values.length === 1 ? values[0] : values[index],
    }));
    setDrugLayouts((current) => current.map((drug) => {
      const retained = drug.wells.filter((well) => !selectedKeys.has(wellKey(well.rowIndex, well.columnIndex)));
      if (drug.id !== activeDrug.id) return { ...drug, wells: retained };
      return { ...drug, wells: [...retained, ...nextAssignments].sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex) };
    }));
  };

  const removeSelectedAssignments = () => {
    const selectedKeys = selectedWellKeys;
    setDrugLayouts((current) => current.map((drug) => ({
      ...drug,
      wells: drug.wells.filter((well) => !selectedKeys.has(wellKey(well.rowIndex, well.columnIndex))),
    })));
  };

  const openPlate = async (plateId = selectedPlateId) => {
    if (!plateId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/plates/${plateId}`);
      const data = await readJsonResponse<PlateView & ApiErrorPayload>(response);
      if (!response.ok) throw new Error(apiErrorMessage(data, "Plate loading failed"));
      setPlate(data);
    } catch (caught) {
      setError(userFacingError(caught, "Plate loading failed"));
    } finally {
      setBusy(false);
    }
  };

  const deleteSample = async (sampleId: string, code: string) => {
    if (!window.confirm(`${code}\n${t.deleteSampleConfirm}`)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/samples/${sampleId}`, { method: "DELETE" });
      const data = await readJsonResponse<{ deletedSampleId?: string } & ApiErrorPayload>(response);
      if (!response.ok) throw new Error(apiErrorMessage(data, "Sample delete failed"));

      setSamples((current) => {
        const next = current.filter((sample) => sample.id !== sampleId);
        const selectedStillExists = next.some((sample) =>
          sample.plates.some((candidate) => candidate.id === selectedPlateId),
        );
        if (!selectedStillExists) {
          const firstPlate = next.flatMap((sample) => sample.plates)[0];
          setSelectedPlateId(firstPlate?.id ?? "");
        }
        return next;
      });
      if (plate?.sample.id === sampleId) {
        setPlate(null);
        setStage("sample");
      }
      setError(t.deleteSampleDone);
    } catch (caught) {
      setError(userFacingError(caught, "Sample delete failed"));
    } finally {
      setBusy(false);
    }
  };

  const startCustomLayout = () => {
    setError("");
    if (!sampleCode.trim()) {
      setError(locale === "ja" ? "Sample-IDを入力してください。" : "Enter a Sample ID.");
      return;
    }
    setLayoutMode("sample");
    setPlateTemplateName(plateType);
    if (selectedTemplate) {
      setDrugLayouts(cloneDrugLayouts(selectedTemplate.drugs));
      setActiveDrugId(selectedTemplate.drugs[0]?.id ?? "drug-1");
    }
    setStage("layout");
  };

  const createSample = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const configuredDrugs = drugLayouts.filter((drug) => drug.wells.length > 0);
    if (configuredDrugs.length === 0) {
      setError(locale === "ja" ? "少なくとも1つのウェルに薬剤を配置してください。" : "Assign at least one well.");
      return;
    }

    const mapped: DrugConfigInput[] = configuredDrugs.map((drug, index) => ({
      rowIndex: index,
      drugName: drug.drugName.trim(),
      unit: drug.unit.trim(),
      wells: drug.wells,
    }));
    if (mapped.some((drug) => !drug.drugName || !drug.unit || !drug.wells?.length || drug.wells.some((well) => !Number.isFinite(well.concentration) || well.concentration <= 0))) {
      setError(locale === "ja" ? "配置済みの各薬剤に薬剤名・単位・正の濃度を入力してください。" : "Each assigned drug needs drug name, unit, and positive concentrations.");
      return;
    }

    const payload: CreateSampleRequest = {
      sampleCode: sampleCode.trim(),
      organism: organism.trim() || undefined,
      plateName: plateTemplateName.trim() || plateType,
      drugs: mapped,
    };
    setBusy(true);
    try {
      const response = await fetch("/api/samples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJsonResponse<{ plate: { id: string } } & ApiErrorPayload>(response);
      if (!response.ok) throw new Error(apiErrorMessage(data, "Create failed"));
      await openPlate(data.plate.id);
    } catch (caught) {
      setError(userFacingError(caught, "Create failed"));
    } finally {
      setBusy(false);
    }
  };

  const startTemplateCreation = () => {
    setError("");
    setLayoutMode("template");
    setPlateTemplateName(selectedTemplate?.name ?? "96-well standard");
    setDrugLayouts(selectedTemplate ? cloneDrugLayouts(selectedTemplate.drugs) : createDrugLayouts());
    setActiveDrugId(selectedTemplate?.drugs[0]?.id ?? "drug-1");
    setSelectedWellKeys(new Set());
    setStage("layout");
  };

  const savePlateTemplate = () => {
    setError("");
    const mapped = toDrugConfigInputs(drugLayouts);
    if (!plateTemplateName.trim()) {
      setError(locale === "ja" ? "プレート名称を入力してください。" : "Enter a plate template name.");
      return;
    }
    if (mapped.length === 0 || hasInvalidDrugConfig(mapped)) {
      setError(locale === "ja" ? "薬剤名・単位・濃度が設定されたウェルを1つ以上登録してください。" : "Create at least one valid drug assignment.");
      return;
    }
    const template: PlateTemplate = {
      id: `template-${Date.now()}`,
      name: plateTemplateName.trim(),
      drugs: cloneDrugLayouts(drugLayouts),
      createdAt: new Date().toISOString(),
    };
    const next = [template, ...plateTemplates.filter((item) => item.name !== template.name)];
    setPlateTemplates(next);
    savePlateTemplates(next);
    setSelectedTemplateId(template.id);
    setPlateType(template.name);
    setStage("sample");
    setError(locale === "ja" ? "プレート設定を保存しました。" : "Plate template saved.");
  };

  const createSampleFromTemplate = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!sampleCode.trim()) {
      setError(locale === "ja" ? "Sample-IDを入力してください。" : "Enter a Sample ID.");
      return;
    }
    if (!selectedTemplate) {
      setError(locale === "ja" ? "使用するプレートを選択してください。先に「プレート作成」で配置を登録できます。" : "Choose a plate template.");
      return;
    }
    setPlateTemplateName(selectedTemplate.name);
    setDrugLayouts(cloneDrugLayouts(selectedTemplate.drugs));
    setBusy(true);
    try {
      const mapped = toDrugConfigInputs(selectedTemplate.drugs);
      const payload: CreateSampleRequest = {
        sampleCode: sampleCode.trim(),
        organism: organism.trim() || undefined,
        plateName: selectedTemplate.name,
        drugs: mapped,
      };
      const response = await fetch("/api/samples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readJsonResponse<{ plate: { id: string } } & ApiErrorPayload>(response);
      if (!response.ok) throw new Error(apiErrorMessage(data, "Create failed"));
      await openPlate(data.plate.id);
    } catch (caught) {
      setError(userFacingError(caught, "Create failed"));
    } finally {
      setBusy(false);
    }
  };

  const addLocalOrganism = () => {
    const name = settingsOrganismDraft.trim();
    if (!name) return;
    const next = Array.from(new Set([...localOrganisms, name])).sort((a, b) => a.localeCompare(b));
    setLocalOrganisms(next);
    saveLocalSettings({ organisms: next, breakpointSets: localBreakpointSets });
    setSettingsOrganismDraft("");
  };

  const addLocalBreakpointSet = () => {
    const name = settingsBreakpointDraft.trim();
    if (!name) return;
    const next = Array.from(new Set([...localBreakpointSets, name])).sort((a, b) => a.localeCompare(b));
    setLocalBreakpointSets(next);
    saveLocalSettings({ organisms: localOrganisms, breakpointSets: next });
    setSettingsBreakpointDraft("");
  };

  const uploadImageBatch = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!sampleCode.trim()) {
      setError("Sample-IDを入力してください。");
      return;
    }
    if (!selectedTemplate) {
      setError("使用するプレートを選択してください。");
      return;
    }
    if (imageBatchFiles.length === 0) {
      setError("アップロードする画像を選択してください。");
      return;
    }
    setBusy(true);
    setImageBatchStatuses(imageBatchFiles.map((file) => ({ fileName: file.name, status: "pending", message: "待機中" })));
    try {
      const mapped = toDrugConfigInputs(selectedTemplate.drugs);
      const payload: CreateSampleRequest = {
        sampleCode: sampleCode.trim(),
        organism: organism.trim() || undefined,
        plateName: selectedTemplate.name,
        drugs: mapped,
      };
      const createResponse = await fetch("/api/samples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const created = await readJsonResponse<{ plate: { id: string } } & ApiErrorPayload>(createResponse);
      if (!createResponse.ok) throw new Error(apiErrorMessage(created, "Create failed"));

      for (const file of imageBatchFiles) {
        setImageBatchStatuses((current) => current.map((item) =>
          item.fileName === file.name ? { ...item, status: "uploading", message: "解析依頼中" } : item,
        ));
        const formData = new FormData();
        formData.set("image", file);
        const response = await fetch(`/api/plates/${created.plate.id}/image-assessments`, { method: "POST", body: formData });
        const data = await readJsonResponse<{ assessment?: { id: string; status: string; imageReference?: string | null } } & ApiErrorPayload>(response);
        if (!response.ok) throw new Error(apiErrorMessage(data, "Image upload failed"));
        setImageBatchStatuses((current) => current.map((item) =>
          item.fileName === file.name
            ? { ...item, status: "done", message: `レビュー待ち: ${data.assessment?.status ?? "REVIEW_REQUIRED"}`, previewUrl: data.assessment?.imageReference ?? undefined }
            : item,
        ));
      }
      setError("画像をレビュー待ちに登録しました。画像レビュー画面で確認してください。");
    } catch (caught) {
      const message = userFacingError(caught, "Image upload failed");
      setImageBatchStatuses((current) => current.map((item) =>
        item.status === "uploading" || item.status === "pending" ? { ...item, status: "error", message } : item,
      ));
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  if (plate) {
    return (
      <PlateEditor
        plate={plate}
        locale={locale}
        onLocaleChange={setLocale}
        onBack={() => { setPlate(null); setStage("sample"); }}
        onDeleteSample={() => deleteSample(plate.sample.id, plate.sample.sampleCode)}
      />
    );
  }

  return (
    <main>
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="brand-copy"><strong>MIC Plate</strong><small>RECORDER</small></div>
        <button className="language-button" onClick={() => setLocale(locale === "ja" ? "en" : "ja")}>
          {locale === "ja" ? "EN" : "日本語"}
        </button>
      </header>

      <section className="hero quick-hero">
        <p className="eyebrow">Research / local / non-clinical</p>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
      </section>

      <datalist id={ORGANISM_DATALIST_ID}>
        {availableOrganisms.map((name) => <option value={name} key={name} />)}
      </datalist>

      {stage === "sample" && (
        <section className="start-layout">
          <section className="form-card start-card primary-start-card">
            <div className="section-number">00</div>
            <div className="section-body">
              <h2>初期メニュー</h2>
              <p className="muted-text">
                先にプレートの名称と薬剤配置を作成し、その後Sample-ID入力時に使用するプレートとして選択します。
              </p>
              <div className="home-nav-actions">
                <button type="button" className="primary-button" onClick={startTemplateCreation}>プレート作成</button>
                <button type="button" className="secondary-button" onClick={() => setStage("imageBatch")}>画像解析へ</button>
                <button type="button" className="secondary-button" onClick={() => setStage("settings")}>菌種 / Breakpoint設定</button>
              </div>
            </div>
          </section>

          <form className="form-card start-card" onSubmit={createSampleFromTemplate}>
            <div className="section-number">01</div>
            <div className="section-body">
              <h2>{t.newSample}</h2>
              <div className="field-grid">
                <label>{t.sampleCode}<input required value={sampleCode} onChange={(event) => setSampleCode(event.target.value)} placeholder="SMP-001" /></label>
                <label>{t.organism}<input list={ORGANISM_DATALIST_ID} value={organism} onChange={(event) => setOrganism(event.target.value)} placeholder="Escherichia coli" /></label>
                <label>{t.plateType}
                  <select value={selectedTemplateId} onChange={(event) => {
                    const templateId = event.target.value;
                    setSelectedTemplateId(templateId);
                    const template = plateTemplates.find((item) => item.id === templateId);
                    if (template) setPlateType(template.name);
                  }}>
                    <option value="">プレートを選択</option>
                    {plateTemplates.map((template) => (
                      <option value={template.id} key={template.id}>{template.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="home-nav-actions">
                <button className="primary-button" disabled={busy || !selectedTemplateId}>プレート入力へ<span aria-hidden="true">→</span></button>
                <button type="button" className="secondary-button" onClick={startTemplateCreation}>プレート作成</button>
                <button type="button" className="secondary-button" onClick={startCustomLayout}>薬剤配置を直接編集</button>
                <button type="button" className="secondary-button" onClick={() => setStage("imageBatch")}>画像解析へ</button>
                <button type="button" className="secondary-button" onClick={() => setStage("settings")}>設定</button>
              </div>
              {plateTemplates.length === 0 && <p className="validation-hint">先に「プレート作成」で薬剤配置テンプレートを登録してください。</p>}
            </div>
          </form>

          <section className="form-card start-card">
            <div className="section-number">02</div>
            <div className="section-body">
              <h2>{t.existing}</h2>
              {samples.length === 0 ? <p className="muted-text">{t.noSamples}</p> : (
                <>
                  <label>{t.plateType}
                    <select value={selectedPlateId} onChange={(event) => setSelectedPlateId(event.target.value)}>
                      {samples.flatMap((sample) => sample.plates.map((samplePlate) => (
                        <option value={samplePlate.id} key={samplePlate.id}>
                          {sample.sampleCode} / {sample.organism ?? "organism未設定"} / {samplePlate.name}
                        </option>
                      )))}
                    </select>
                  </label>
                  {selectedSample && <p className="muted-text">{selectedSample.sampleCode} / {selectedSample.organism ?? "organism未設定"}</p>}
                  <div className="sample-action-row">
                    <button type="button" className="secondary-button" onClick={() => openPlate()} disabled={busy || !selectedPlateId}>{t.openPlate}</button>
                    {selectedSample && (
                      <button
                        type="button"
                        className="secondary-button danger-action"
                        onClick={() => deleteSample(selectedSample.id, selectedSample.sampleCode)}
                        disabled={busy}
                      >
                        {t.deleteSample}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>
        </section>
      )}

      {stage === "settings" && (
        <section className="start-layout">
          <section className="form-card start-card">
            <div className="section-number">SET</div>
            <div className="section-body">
              <div className="layout-heading">
                <div>
                  <h2>設定</h2>
                  <p className="muted-text">研究用ローカルで使う菌種候補とBreakpoint候補名を追加できます。</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => setStage("sample")}>初期画面へ戻る</button>
              </div>
              <div className="settings-grid">
                <section>
                  <h3>菌種リスト</h3>
                  <div className="inline-input-action">
                    <input value={settingsOrganismDraft} onChange={(event) => setSettingsOrganismDraft(event.target.value)} placeholder="例: Escherichia coli" />
                    <button type="button" className="secondary-button" onClick={addLocalOrganism}>追加</button>
                  </div>
                  <ul className="settings-list">
                    {localOrganisms.map((name) => (
                      <li key={name}>
                        <span>{name}</span>
                        <button type="button" className="secondary-button" onClick={() => {
                          const next = localOrganisms.filter((item) => item !== name);
                          setLocalOrganisms(next);
                          saveLocalSettings({ organisms: next, breakpointSets: localBreakpointSets });
                        }}>削除</button>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3>Breakpoint set候補</h3>
                  <div className="inline-input-action">
                    <input value={settingsBreakpointDraft} onChange={(event) => setSettingsBreakpointDraft(event.target.value)} placeholder="例: CLSI 2026 local draft" />
                    <button type="button" className="secondary-button" onClick={addLocalBreakpointSet}>追加</button>
                  </div>
                  <ul className="settings-list">
                    {localBreakpointSets.map((name) => (
                      <li key={name}>
                        <span>{name}</span>
                        <button type="button" className="secondary-button" onClick={() => {
                          const next = localBreakpointSets.filter((item) => item !== name);
                          setLocalBreakpointSets(next);
                          saveLocalSettings({ organisms: localOrganisms, breakpointSets: next });
                        }}>削除</button>
                      </li>
                    ))}
                  </ul>
                  <p className="muted-text">正式なBreakpointSet管理APIは互換・履歴用に残しています。通常の研究用保存や画像承認では未選択でも進められます。</p>
                </section>
              </div>
            </div>
          </section>
        </section>
      )}

      {stage === "imageBatch" && (
        <form className="form-shell" onSubmit={uploadImageBatch}>
          <section className="form-card">
            <div className="section-number">IMG</div>
            <div className="section-body">
              <div className="layout-heading">
                <div>
                  <h2>画像解析</h2>
                  <p className="muted-text">複数画像をまとめて添付し、manual reviewへ送ります。解析結果は補助判定です。</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => setStage("sample")}>初期画面へ戻る</button>
              </div>
              <div className="field-grid">
                <label>{t.sampleCode}<input required value={sampleCode} onChange={(event) => setSampleCode(event.target.value)} placeholder="SMP-IMG-001" /></label>
                <label>{t.organism}<input list={ORGANISM_DATALIST_ID} value={organism} onChange={(event) => setOrganism(event.target.value)} placeholder="Escherichia coli" /></label>
                <label>{t.plateType}
                  <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                    <option value="">プレートを選択</option>
                    {plateTemplates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
                  </select>
                </label>
                <label>画像ファイル
                  <input type="file" accept="image/*" multiple onChange={(event) => setImageBatchFiles(Array.from(event.target.files ?? []))} />
                </label>
              </div>
              <div className="image-preview-list" aria-label="選択画像プレビュー">
                {imageBatchPreviews.map((preview) => (
                  <figure className="image-preview-card" key={`${preview.file.name}-${preview.file.lastModified}`}>
                    <img src={preview.url} alt={`${preview.file.name} preview`} />
                    <figcaption>{preview.file.name}</figcaption>
                  </figure>
                ))}
              </div>
              <div className="batch-status-list" aria-live="polite">
                {imageBatchStatuses.map((item) => (
                  <p key={item.fileName} className={`batch-status ${item.status}`}>
                    <strong>{item.fileName}</strong>: {item.message}
                  </p>
                ))}
              </div>
              <div className="home-nav-actions">
                <button className="primary-button" disabled={busy || imageBatchFiles.length === 0 || !selectedTemplateId}>画像をレビュー待ちに登録</button>
                <a className="secondary-button" href="/review/image">画像レビュー画面を開く</a>
              </div>
            </div>
          </section>
          <p className="safety-note"><span aria-hidden="true">!</span>confidenceに関係なくmanual reviewが必要です。臨床・診断用途には使用しないでください。</p>
          {error && <p className="error-message" role="alert">{error}</p>}
        </form>
      )}

      {stage === "layout" && (
        <form className="form-shell" onSubmit={(event) => {
          if (layoutMode === "template") {
            event.preventDefault();
            savePlateTemplate();
            return;
          }
          void createSample(event);
        }}>
          <section className="form-card">
            <div className="section-number">02</div>
            <div className="section-body">
              <div className="layout-heading">
                <div>
                  <h2>{t.layoutTitle}</h2>
                  <p className="muted-text">{sampleCode} / {organism || "organism未設定"} / {plateType}</p>
                </div>
                <button type="button" className="secondary-button" onClick={() => setStage("sample")}>{t.backSample}</button>
              </div>
              <p className="safety-note"><span aria-hidden="true">!</span>{t.layoutHelp}</p>
              <div className="field-grid">
                <label>プレート名称
                  <input value={plateTemplateName} onChange={(event) => {
                    setPlateTemplateName(event.target.value);
                    setPlateType(event.target.value);
                  }} placeholder="例: 研究用 96well Plate A" />
                </label>
                <label>モード
                  <input readOnly value={layoutMode === "template" ? "プレート作成（テンプレート保存）" : "このSample用に直接編集"} />
                </label>
              </div>
              <div className="flex-layout-builder">
                <aside className="drug-layout-sidebar">
                  <button type="button" className="secondary-button" onClick={addDrugLayout}>{t.addDrug}</button>
                  <div className="drug-tabs" role="list">
                    {drugLayouts.map((drug, index) => (
                      <button
                        type="button"
                        role="listitem"
                        key={drug.id}
                        className={drug.id === activeDrugId ? "drug-tab active" : "drug-tab"}
                        onClick={() => setActiveDrugId(drug.id)}
                      >
                        <strong>{drug.drugName || `Drug ${index + 1}`}</strong>
                        <span>{drug.wells.length} wells</span>
                      </button>
                    ))}
                  </div>
                  {activeDrug && (
                    <fieldset className="drug-assignment-card">
                      <legend>{activeDrug.drugName || "Drug"}</legend>
                      <label>{t.drugName}<input value={activeDrug.drugName} onChange={(event) => updateDrugLayout(activeDrug.id, { drugName: event.target.value })} placeholder="Ampicillin" /></label>
                      <label>{t.unit}<input value={activeDrug.unit} onChange={(event) => updateDrugLayout(activeDrug.id, { unit: event.target.value })} placeholder="µg/mL" /></label>
                      <label>{t.concentrations}<input value={assignmentConcentrations} onChange={(event) => setAssignmentConcentrations(event.target.value)} placeholder={defaultConcentrations} /></label>
                      <p className="muted-text">{t.selectedWells}: {selectionLabel(selectedWellKeys)}</p>
                      <div className="assignment-actions">
                        <button type="button" className="primary-button" onClick={assignSelection}>{t.assignSelection}</button>
                        <button type="button" className="secondary-button" onClick={removeSelectedAssignments}>{t.removeSelected}</button>
                        <button type="button" className="secondary-button" onClick={() => setSelectedWellKeys(new Set())}>{t.clearSelection}</button>
                      </div>
                    </fieldset>
                  )}
                  <div className="assignment-summary">
                    <strong>{t.assignedWells}</strong>
                    <ul>
                      {drugLayouts.filter((drug) => drug.wells.length > 0).map((drug) => (
                        <li key={drug.id}>
                          {drug.drugName || "Drug"}: {drug.wells.map((well) => wellName(well.rowIndex, well.columnIndex)).slice(0, 8).join(", ")}
                          {drug.wells.length > 8 ? ` +${drug.wells.length - 8}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                </aside>

                <div className="layout-plate-panel" onPointerUp={endWellSelection} onPointerLeave={endWellSelection}>
                  <div className="layout-plate-grid" role="grid" aria-label={locale === "ja" ? "薬剤配置グリッド" : "Drug layout grid"}>
                    <div className="layout-grid-corner" />
                    {Array.from({ length: 12 }, (_, columnIndex) => (
                      <button
                        type="button"
                        className="layout-grid-head layout-select-header"
                        key={columnIndex}
                        onClick={() => setSelectedWellKeys(columnKeys(columnIndex))}
                        aria-label={locale === "ja" ? `列${columnIndex + 1}を選択` : `Select column ${columnIndex + 1}`}
                      >
                        {columnIndex + 1}
                      </button>
                    ))}
                    {ROW_LABELS.map((rowLabel, rowIndex) => (
                      <div className="layout-grid-row" role="row" key={rowLabel}>
                        <button
                          type="button"
                          className="layout-grid-head layout-select-header row-label"
                          onClick={() => setSelectedWellKeys(rowKeys(rowIndex))}
                          aria-label={locale === "ja" ? `行${rowLabel}を選択` : `Select row ${rowLabel}`}
                        >
                          {rowLabel}
                        </button>
                        {Array.from({ length: 12 }, (_, columnIndex) => {
                          const key = wellKey(rowIndex, columnIndex);
                          const assigned = assignedWellMap.get(key);
                          const selected = selectedWellKeys.has(key);
                          return (
                            <button
                              type="button"
                              role="gridcell"
                              key={key}
                              className={[
                                "layout-well",
                                selected ? "selected" : "",
                                assigned ? "assigned" : "",
                              ].filter(Boolean).join(" ")}
                              aria-label={`${wellName(rowIndex, columnIndex)} ${assigned ? `${assigned.drugName} ${assigned.concentration} ${assigned.unit}` : "empty"}`}
                              onPointerDown={(event) => {
                                event.preventDefault();
                                beginWellSelection({ rowIndex, columnIndex });
                              }}
                              onPointerEnter={() => extendWellSelection({ rowIndex, columnIndex })}
                            >
                              <b>{wellName(rowIndex, columnIndex)}</b>
                              {assigned && <><span>{assigned.drugName}</span><small>{assigned.concentration} {assigned.unit}</small></>}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
          <p className="safety-note"><span aria-hidden="true">!</span>{t.safety}</p>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? t.creating : (layoutMode === "template" ? "プレート設定を保存" : t.createAndOpen)}<span aria-hidden="true">→</span></button>
        </form>
      )}

      {stage === "sample" && (
        <>
          <p className="safety-note start-safety"><span aria-hidden="true">!</span>{t.safety}</p>
          {error && <p className="error-message start-error" role="alert">{error}</p>}
        </>
      )}
    </main>
  );
}
