"use client";

import { useEffect, useState } from "react";
import { PlateEditor } from "@/components/plate-editor";
import type { CreateSampleRequest, DrugConfigInput, PlateView } from "@/types/domain";

type Locale = "ja" | "en";

const copy = {
  ja: {
    eyebrow: "微量液体希釈法 / 96穴プレート",
    title: "MIC Plate Recorder",
    subtitle: "サンプル情報と濃度系列を設定して、プレート入力を開始します。",
    sampleCode: "サンプルID",
    organism: "菌種（任意）",
    drug: "薬剤",
    concentrations: "濃度（高濃度から12点、カンマ区切り）",
    unit: "単位",
    breakpoint: "施設で承認済みの判定基準を設定",
    sMax: "S 上限",
    rMin: "R 下限",
    version: "基準バージョン",
    addDrug: "＋ 薬剤を追加",
    remove: "削除",
    start: "プレート入力へ",
    creating: "作成中…",
    safety: "判定基準はデモ値ではありません。施設で承認された値と版のみ入力してください。",
  },
  en: {
    eyebrow: "Broth microdilution / 96-well plate",
    title: "MIC Plate Recorder",
    subtitle: "Configure the sample and dilution series, then start plate entry.",
    sampleCode: "Sample ID",
    organism: "Organism (optional)",
    drug: "Drug",
    concentrations: "12 concentrations, high to low (comma-separated)",
    unit: "Unit",
    breakpoint: "Use an institution-approved breakpoint",
    sMax: "S maximum",
    rMin: "R minimum",
    version: "Rule version",
    addDrug: "+ Add drug",
    remove: "Remove",
    start: "Start plate entry",
    creating: "Creating…",
    safety: "No clinical demo breakpoints are supplied. Enter only approved values and versions.",
  },
} as const;

interface DrugDraft {
  drugName: string;
  unit: string;
  concentrations: string;
}

const newDrug = (): DrugDraft => ({
  drugName: "",
  unit: "µg/mL",
  concentrations: "64,32,16,8,4,2,1,0.5,0.25,0.125,0.0625,0.03125",
});

export default function Home() {
  const [locale, setLocale] = useState<Locale>("ja");
  const [sampleCode, setSampleCode] = useState("");
  const [organism, setOrganism] = useState("");
  const [drugs, setDrugs] = useState<DrugDraft[]>([newDrug()]);
  const [plate, setPlate] = useState<PlateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = copy[locale];

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  const updateDrug = (index: number, patch: Partial<DrugDraft>) => {
    setDrugs((current) => current.map((drug, itemIndex) => itemIndex === index ? { ...drug, ...patch } : drug));
  };

  const createSample = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const mapped: DrugConfigInput[] = drugs.map((drug) => {
      const concentrations = drug.concentrations.split(",").map((value) => Number(value.trim()));
      return {
        drugName: drug.drugName,
        unit: drug.unit,
        concentrations,
      };
    });
    if (mapped.some((drug) => drug.concentrations.length !== 12 || drug.concentrations.some((value) => !Number.isFinite(value) || value <= 0))) {
      setError(locale === "ja" ? "各薬剤に正の濃度を12点入力してください。" : "Enter 12 positive concentrations for each drug.");
      return;
    }

    const payload: CreateSampleRequest = { sampleCode, organism: organism || undefined, drugs: mapped };
    setBusy(true);
    try {
      const response = await fetch("/api/samples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === "SAMPLE_CODE_EXISTS" ? "Sample ID already exists." : "Create failed");
      const plateResponse = await fetch(`/api/plates/${data.plate.id}`);
      if (!plateResponse.ok) throw new Error("Plate loading failed");
      setPlate(await plateResponse.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  if (plate) return <PlateEditor plate={plate} locale={locale} onLocaleChange={setLocale} />;

  return (
    <main>
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
        <div className="brand-copy"><strong>MIC Plate</strong><small>RECORDER</small></div>
        <button className="language-button" onClick={() => setLocale(locale === "ja" ? "en" : "ja")}>
          {locale === "ja" ? "EN" : "日本語"}
        </button>
      </header>
      <section className="hero">
        <p className="eyebrow">{t.eyebrow}</p>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
      </section>
      <form className="form-shell" onSubmit={createSample}>
        <section className="form-card">
          <div className="section-number">01</div>
          <div className="section-body">
            <h2>{locale === "ja" ? "サンプル" : "Sample"}</h2>
            <div className="field-grid">
              <label>{t.sampleCode}<input required value={sampleCode} onChange={(event) => setSampleCode(event.target.value)} placeholder="SMP-2026-001" /></label>
              <label>{t.organism}<input value={organism} onChange={(event) => setOrganism(event.target.value)} placeholder="Escherichia coli" /></label>
            </div>
          </div>
        </section>
        <section className="form-card">
          <div className="section-number">02</div>
          <div className="section-body">
            <h2>{locale === "ja" ? "薬剤と濃度系列" : "Drug and dilution series"}</h2>
            {drugs.map((drug, index) => (
              <div className="drug-card" key={index}>
                <div className="drug-card-head"><strong>{t.drug} {index + 1}</strong>{drugs.length > 1 && <button type="button" className="text-button" onClick={() => setDrugs((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t.remove}</button>}</div>
                <div className="field-grid compact">
                  <label>{t.drug}<input required value={drug.drugName} onChange={(event) => updateDrug(index, { drugName: event.target.value })} placeholder="Drug name" /></label>
                  <label>{t.unit}<input required value={drug.unit} onChange={(event) => updateDrug(index, { unit: event.target.value })} /></label>
                </div>
                <label>{t.concentrations}<input required value={drug.concentrations} onChange={(event) => updateDrug(index, { concentrations: event.target.value })} /></label>
              </div>
            ))}
            {drugs.length < 8 && <button type="button" className="secondary-button" onClick={() => setDrugs((current) => [...current, newDrug()])}>{t.addDrug}</button>}
          </div>
        </section>
        <p className="safety-note"><span aria-hidden="true">!</span>{t.safety}</p>
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy}>{busy ? t.creating : t.start}<span aria-hidden="true">→</span></button>
      </form>
    </main>
  );
}
