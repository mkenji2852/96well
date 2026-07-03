"use client";

import { useEffect, useMemo, useState } from "react";
import { PlateEditor } from "@/components/plate-editor";
import { COMMON_ORGANISMS, ORGANISM_DATALIST_ID } from "@/lib/organisms";
import { ROW_LABELS, type CreateSampleRequest, type DrugConfigInput, type PlateView } from "@/types/domain";

type Locale = "ja" | "en";
type Stage = "sample" | "layout";

interface ApiErrorPayload {
  error?: string | { code?: string; message?: string };
}

interface SampleListItem {
  id: string;
  sampleCode: string;
  organism: string | null;
  plates: Array<{ id: string; name: string; status: string }>;
}

interface RowLayoutDraft {
  rowIndex: number;
  enabled: boolean;
  drugName: string;
  unit: string;
  concentrations: string;
}

const defaultConcentrations = "64,32,16,8,4,2,1,0.5,0.25,0.125,0.0625,0.03125";

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
    nextLayout: "薬剤配置へ",
    backSample: "Sample選択へ戻る",
    layoutTitle: "プレート内の薬剤配置",
    layoutHelp: "A-H行ごとに薬剤名・単位・12列分の濃度を固定します。列は左から高濃度→低濃度です。",
    useRow: "この行を使う",
    drugName: "薬剤名",
    unit: "単位",
    concentrations: "1-12列の濃度",
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
    nextLayout: "Configure drug layout",
    backSample: "Back to sample selection",
    layoutTitle: "Drug layout on plate",
    layoutHelp: "Assign drug name, unit, and 12 column concentrations by row A-H. Columns run high to low left-to-right.",
    useRow: "Use this row",
    drugName: "Drug name",
    unit: "Unit",
    concentrations: "Concentrations for columns 1-12",
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

function createRowLayouts(): RowLayoutDraft[] {
  return ROW_LABELS.map((_, rowIndex) => ({
    rowIndex,
    enabled: rowIndex === 0,
    drugName: rowIndex === 0 ? "Ampicillin" : "",
    unit: "µg/mL",
    concentrations: defaultConcentrations,
  }));
}

function parseConcentrations(value: string): number[] {
  return value.split(",").map((item) => Number(item.trim()));
}

export default function Home() {
  const [locale, setLocale] = useState<Locale>("ja");
  const [stage, setStage] = useState<Stage>("sample");
  const [samples, setSamples] = useState<SampleListItem[]>([]);
  const [selectedPlateId, setSelectedPlateId] = useState("");
  const [sampleCode, setSampleCode] = useState("");
  const [organism, setOrganism] = useState("");
  const [plateType, setPlateType] = useState("96-well standard");
  const [rowLayouts, setRowLayouts] = useState<RowLayoutDraft[]>(() => createRowLayouts());
  const [plate, setPlate] = useState<PlateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = copy[locale];

  const selectedSample = useMemo(
    () => samples.find((sample) => sample.plates.some((candidate) => candidate.id === selectedPlateId)) ?? null,
    [samples, selectedPlateId],
  );

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
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

  const updateRowLayout = (rowIndex: number, patch: Partial<RowLayoutDraft>) => {
    setRowLayouts((current) => current.map((row) => row.rowIndex === rowIndex ? { ...row, ...patch } : row));
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
      setError(caught instanceof Error ? caught.message : "Plate loading failed");
    } finally {
      setBusy(false);
    }
  };

  const goLayout = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!sampleCode.trim()) {
      setError(locale === "ja" ? "Sample-IDを入力してください。" : "Enter a Sample ID.");
      return;
    }
    setStage("layout");
  };

  const createSample = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const configuredRows = rowLayouts.filter((row) => row.enabled);
    if (configuredRows.length === 0) {
      setError(locale === "ja" ? "少なくとも1行に薬剤を配置してください。" : "Configure at least one drug row.");
      return;
    }

    const mapped: DrugConfigInput[] = configuredRows.map((row) => ({
      rowIndex: row.rowIndex,
      drugName: row.drugName.trim(),
      unit: row.unit.trim(),
      concentrations: parseConcentrations(row.concentrations),
    }));
    if (mapped.some((drug) => !drug.drugName || !drug.unit || drug.concentrations.length !== 12 || drug.concentrations.some((value) => !Number.isFinite(value) || value <= 0))) {
      setError(locale === "ja" ? "使用する各行に薬剤名・単位・12個の正の濃度を入力してください。" : "Each enabled row needs drug name, unit, and 12 positive concentrations.");
      return;
    }

    const payload: CreateSampleRequest = { sampleCode: sampleCode.trim(), organism: organism.trim() || undefined, drugs: mapped };
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
      setError(caught instanceof Error ? caught.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  if (plate) {
    return <PlateEditor plate={plate} locale={locale} onLocaleChange={setLocale} onBack={() => { setPlate(null); setStage("sample"); }} />;
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
        {COMMON_ORGANISMS.map((name) => <option value={name} key={name} />)}
      </datalist>

      {stage === "sample" ? (
        <section className="start-layout">
          <form className="form-card start-card" onSubmit={goLayout}>
            <div className="section-number">01</div>
            <div className="section-body">
              <h2>{t.newSample}</h2>
              <div className="field-grid">
                <label>{t.sampleCode}<input required value={sampleCode} onChange={(event) => setSampleCode(event.target.value)} placeholder="SMP-001" /></label>
                <label>{t.organism}<input list={ORGANISM_DATALIST_ID} value={organism} onChange={(event) => setOrganism(event.target.value)} placeholder="Escherichia coli" /></label>
                <label>{t.plateType}
                  <select value={plateType} onChange={(event) => setPlateType(event.target.value)}>
                    <option value="96-well standard">96-well standard</option>
                  </select>
                </label>
              </div>
              <button className="primary-button" disabled={busy}>{t.nextLayout}<span aria-hidden="true">→</span></button>
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
                  <button type="button" className="secondary-button" onClick={() => openPlate()} disabled={busy || !selectedPlateId}>{t.openPlate}</button>
                </>
              )}
            </div>
          </section>
        </section>
      ) : (
        <form className="form-shell" onSubmit={createSample}>
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
              <div className="row-layout-grid">
                {rowLayouts.map((row) => (
                  <fieldset className={row.enabled ? "row-layout-card enabled" : "row-layout-card"} key={row.rowIndex}>
                    <legend>{ROW_LABELS[row.rowIndex]}</legend>
                    <label className="check-row">
                      <input type="checkbox" checked={row.enabled} onChange={(event) => updateRowLayout(row.rowIndex, { enabled: event.target.checked })} />
                      <span>{t.useRow}</span>
                    </label>
                    <label>{t.drugName}<input value={row.drugName} onChange={(event) => updateRowLayout(row.rowIndex, { drugName: event.target.value })} disabled={!row.enabled} placeholder="Ampicillin" /></label>
                    <label>{t.unit}<input value={row.unit} onChange={(event) => updateRowLayout(row.rowIndex, { unit: event.target.value })} disabled={!row.enabled} /></label>
                    <label>{t.concentrations}<input value={row.concentrations} onChange={(event) => updateRowLayout(row.rowIndex, { concentrations: event.target.value })} disabled={!row.enabled} /></label>
                  </fieldset>
                ))}
              </div>
            </div>
          </section>
          <p className="safety-note"><span aria-hidden="true">!</span>{t.safety}</p>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? t.creating : t.createAndOpen}<span aria-hidden="true">→</span></button>
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
