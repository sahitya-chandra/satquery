"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { buildAnalysisForm } from "../lib/analysis-form";

const API_BASE = "";
const MODES = ["Auto Detect", "Single Image", "Bi-temporal Change", "Optical-SAR Pair"];

type DemoCase = {
  id: string;
  name: string;
  mode: string;
  files: string[];
  query: string;
  image_urls: string[];
};

type Check = {
  name: string;
  status: string;
  message: string;
};

type TraceStep = {
  step: string;
  tool: string;
  status: string;
  parameters: Record<string, unknown>;
  duration_ms: number;
  message: string;
};

type Visual = {
  id: string;
  label: string;
  src: string;
};

type AnalysisSummary = {
  task: string;
  answer: string;
  model: string;
  reason: string;
  clarification: string;
  observations: { image: number; description: string }[];
  limitations: string[];
  all_warnings: string[];
};

type AnalyzeResponse = {
  ok: boolean;
  error?: string | null;
  errors?: string[];
  result?: AnalysisSummary | null;
  visuals: Visual[];
  input_metadata: Record<string, unknown>[];
  validation?: {
    valid: boolean;
    checks: Check[];
    warnings: string[];
    errors: string[];
  } | null;
  routing?: {
    task: string;
    reason: string;
    required_tools?: string[];
  } | null;
  trace: TraceStep[];
  report?: string | null;
};

function imageUrl(url: string): string {
  if (url.startsWith("data:") || url.startsWith("http")) {
    return url;
  }
  return `${API_BASE}${url}`;
}

function UploadPreview({ file }: { file: File }) {
  const [src, setSrc] = useState<string | null>(null);
  const isTIFF = /\.tiff?$/i.test(file.name);
  const tooLarge = file.size > 3_900_000;
  useEffect(() => {
    if (isTIFF || tooLarge) return;
    const reader = new FileReader();
    reader.onload = () => setSrc(String(reader.result));
    reader.readAsDataURL(file);
    return () => { reader.onload = null; reader.abort(); };
  }, [file, isTIFF, tooLarge]);
  return <figure>
    {src ? <img src={src} alt={file.name} /> : <p className="preview-note">{tooLarge ? "This file exceeds the 3.9 MB upload limit." : isTIFF ? "TIFF preview available after analysis." : "Loading preview…"}</p>}
    <figcaption>{file.name}</figcaption>
  </figure>;
}

export default function Home() {
  const [demoCases, setDemoCases] = useState<DemoCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("single");
  const [inputSource, setInputSource] = useState<"demo" | "upload">("demo");
  const [analysisMode, setAnalysisMode] = useState(MODES[0]);
  const [query, setQuery] = useState("What major land-cover regions are visible?");
  const requestController = useRef<AbortController | null>(null);
  const [firstFile, setFirstFile] = useState<File | null>(null);
  const [secondFile, setSecondFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiConfigured, setAIConfigured] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCases() {
      try {
        const healthResponse = await fetch(`${API_BASE}/api/health`);
        const health = await healthResponse.json();
        if (active) {
          setAIConfigured(health.ai?.configured === true);
          setApiOnline(healthResponse.ok);
        }

        const casesResponse = await fetch(`${API_BASE}/api/demo-cases`);
        if (!casesResponse.ok) {
          throw new Error("Demo cases unavailable.");
        }
        const payload = (await casesResponse.json()) as { cases: DemoCase[] };
        if (!active) {
          return;
        }
        setDemoCases(payload.cases);
        const firstCase = payload.cases[0];
        if (firstCase) {
          setSelectedCaseId(firstCase.id);
          setAnalysisMode(firstCase.mode);
          setQuery(firstCase.query);
        }
      } catch {
        if (active) {
          setApiOnline(false);
        }
      }
    }

    loadCases();
    return () => {
      active = false;
      requestController.current?.abort();
    };
  }, []);

  const selectedCase = useMemo(
    () => demoCases.find((demoCase) => demoCase.id === selectedCaseId) ?? demoCases[0],
    [demoCases, selectedCaseId]
  );

  const visibleDemoImages = selectedCase?.image_urls.map(imageUrl) ?? [];
  const needsSecondUpload = inputSource === "upload" && analysisMode !== "Single Image";
  const warnings = analysis?.result?.all_warnings ?? analysis?.validation?.warnings ?? [];

  function selectDemoCase(demoCase: DemoCase) {
    setSelectedCaseId(demoCase.id);
    setInputSource("demo");
    setAnalysisMode(demoCase.mode);
    setQuery(demoCase.query);
    setAnalysis(null);
  }

  function onFileChange(which: "first" | "second", event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setAnalysis(null);
    if (which === "first") {
      setFirstFile(nextFile);
    } else {
      setSecondFile(nextFile);
    }
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setAnalysis(null);

    try {
      const form = buildAnalysisForm({ inputSource, demoCase: selectedCaseId, mode: analysisMode, query, firstFile, secondFile });
      const controller = new AbortController();
      requestController.current = controller;
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        body: form,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)])
      });
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error(response.status === 413 ? "Uploads exceed the server's size limit." : `Analysis request failed (${response.status}).`);
      }
      const payload = (await response.json()) as AnalyzeResponse;
      setAnalysis(payload);
    } catch (error) {
      setAnalysis({
        ok: false,
        error: error instanceof Error && error.name === "AbortError" ? "Analysis cancelled." : error instanceof Error && error.name === "TimeoutError" ? "Analysis timed out. Please retry." : error instanceof Error ? error.message : "Request failed.",
        errors: [],
        visuals: [],
        input_metadata: [],
        trace: []
      });
    } finally {
      requestController.current = null;
      setLoading(false);
    }
  }

  function downloadReport() {
    if (!analysis?.report) {
      return;
    }
    const blob = new Blob([analysis.report], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "satquery_ai_report.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SatQuery AI</p>
          <h1>Satellite image analysis</h1>
        </div>
        <div className={`api-status ${apiOnline ? "online" : apiOnline === false ? "offline" : ""}`}>
          <span aria-hidden="true" />
          {apiOnline === null ? "Checking API" : apiOnline ? "API online" : "API offline"}
        </div>
      </header>

      <section className="workspace">
        <form onSubmit={analyze}>
        <fieldset className="control-panel" disabled={loading}>
          <div className="field-group">
            <label>Demo Case</label>
            <div className="segmented demo-grid">
              {demoCases.map((demoCase) => (
                <button
                  type="button"
                  key={demoCase.id}
                  className={selectedCaseId === demoCase.id && inputSource === "demo" ? "selected" : ""}
                  onClick={() => selectDemoCase(demoCase)}
                >
                  {demoCase.name}
                </button>
              ))}
            </div>
          </div>

          <div className="field-row">
            <div className="field-group">
              <label>Input Source</label>
              <div className="segmented">
                <button
                  type="button"
                  className={inputSource === "demo" ? "selected" : ""}
                  onClick={() => { if (selectedCase) selectDemoCase(selectedCase); }}
                >
                  Demo
                </button>
                <button
                  type="button"
                  className={inputSource === "upload" ? "selected" : ""}
                  onClick={() => { setInputSource("upload"); setAnalysis(null); }}
                >
                  Upload
                </button>
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="analysis-mode">Analysis Mode</label>
              <select id="analysis-mode" value={analysisMode} onChange={(event) => { setAnalysisMode(event.target.value); setAnalysis(null); if (event.target.value === "Single Image") setSecondFile(null); }}>
                {MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {inputSource === "upload" ? (
            <div className="upload-grid">
              <label className="file-drop">
                <span>{analysisMode === "Optical-SAR Pair" ? "Optical Image" : "First Image"}</span>
                <input type="file" accept=".png,.jpg,.jpeg,.tif,.tiff" onChange={(event) => onFileChange("first", event)} />
                <strong>{firstFile?.name ?? "Choose file"}</strong>
              </label>
              {needsSecondUpload ? (
                <label className="file-drop">
                  <span>{analysisMode === "Optical-SAR Pair" ? "SAR Image" : analysisMode === "Auto Detect" ? "Second Image (optional)" : "Second Image"}</span>
                  <input type="file" accept=".png,.jpg,.jpeg,.tif,.tiff" onChange={(event) => onFileChange("second", event)} />
                  <strong>{secondFile?.name ?? "Choose file"}</strong>
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="field-group">
            <label htmlFor="query">Natural-language Query</label>
            <textarea id="query" value={query} onChange={(event) => { setQuery(event.target.value); setAnalysis(null); }} maxLength={8000} rows={4} />
          </div>

          <small>{aiConfigured ? "Analysis sends your question and image previews to the configured AI provider. Results are visual interpretations; pixel masks and measured areas are not available." : "AI analysis is not configured. Set a model and API key on the server to analyse images."}</small>
          {analysisMode === "Bi-temporal Change" && <small>Upload the earlier image first and the later image second.</small>}
          {analysisMode === "Optical-SAR Pair" && <small>Upload optical first and SAR second. Results describe visible evidence; calibrated sensor fusion is not available.</small>}

          <button className="primary-action" type="submit" disabled={loading || apiOnline !== true || !aiConfigured}>
            {loading ? "Asking the model…" : "Analyse with AI"}
          </button>
        </fieldset>
        {loading && <button className="cancel-action" type="button" onClick={() => requestController.current?.abort()}>Cancel analysis</button>}
        </form>

        <section className="analysis-panel">
          {analysis?.result ? (
            <div className="result-stack">
              <div className="metric-strip">
                <div>
                  <span>Task</span>
                  <strong>{analysis.result.task.replaceAll("_", " ")}</strong>
                </div>
                <div>
                  <span>Model</span>
                  <strong>{analysis.result.model}</strong>
                </div>
                <div>
                  <span>Result type</span>
                  <strong>Visual interpretation</strong>
                </div>
              </div>

              <section className="answer-band">
                <h2>{analysis.result.task === "clarification" ? "Clarification needed" : analysis.result.task === "unsupported" ? "Capability unavailable" : "AI answer"}</h2>
                <p>{analysis.result.answer}</p>
                {analysis.result.clarification && <p className="clarification">{analysis.result.clarification}</p>}
                {analysis.result.task === "clarification" && <small>Update your question or analysis mode above, then analyse again.</small>}
              </section>

              {analysis.result.observations.length > 0 && <section className="answer-band">
                <h2>Visual observations</h2>
                <ul>{analysis.result.observations.map((observation, i) => <li key={i}><strong>Image {observation.image}:</strong> {observation.description}</li>)}</ul>
              </section>}

              <section className="visual-grid" aria-label="Source images">
                {analysis.visuals.map((visual) => (
                  <figure key={visual.id}>
                    <img src={visual.src} alt={visual.label} />
                    <figcaption>{visual.label}</figcaption>
                  </figure>
                ))}
              </section>
            </div>
          ) : (
            <div className="preview-stack">
              <div className="preview-copy">
                <h2>{inputSource === "upload" ? "Selected uploads" : selectedCase?.name ?? "SatQuery AI"}</h2>
                <p>{query}</p>
              </div>
              <div className="visual-grid preview-grid" aria-label="Selected images">
                {inputSource === "upload" ? <>
                  {firstFile ? <UploadPreview key={`first-${firstFile.name}-${firstFile.lastModified}-${firstFile.size}`} file={firstFile} /> : <p>Choose an image to preview.</p>}
                  {needsSecondUpload && secondFile && <UploadPreview key={`second-${secondFile.name}-${secondFile.lastModified}-${secondFile.size}`} file={secondFile} />}
                </> : visibleDemoImages.map((url, index) => (
                  <figure key={url}>
                    <img src={url} alt={`Demo image ${index + 1}`} />
                    <figcaption>{selectedCase?.files[index] ?? `Image ${index + 1}`}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {analysis && !analysis.ok ? (
            <section className="error-band">
              <h2>Request Status</h2>
              <p>{analysis.error || analysis.errors?.join(" ") || "Analysis did not complete."}</p>
            </section>
          ) : null}
        </section>
      </section>

      <section className="detail-grid">
        <details>
          <summary>Analysis limitations</summary>
          <p>These answers are model interpretations of image previews. Segmentation masks, precise object counts, measured areas and calibrated SAR fusion require specialist models that are not connected.</p>
        </details>

        <details>
          <summary>Input Metadata</summary>
          {analysis?.input_metadata.length ? (
            <pre>{JSON.stringify(analysis.input_metadata, null, 2)}</pre>
          ) : (
            <p>No analysed inputs yet.</p>
          )}
        </details>

        <details>
          <summary>Validation Checks</summary>
          {analysis?.validation?.checks.length ? (
            <div className="check-list">
              {analysis.validation.checks.map((check) => (
                <div key={`${check.name}-${check.message}`} className={`check ${check.status}`}>
                  <strong>{check.name}</strong>
                  <span>{check.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <p>No validation checks yet.</p>
          )}
        </details>

        <details open={warnings.length > 0}>
          <summary>Warnings</summary>
          {warnings.length ? (
            <ul className="warning-list">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p>No warnings were reported.</p>
          )}
        </details>

        <details>
          <summary>Execution Trace</summary>
          {analysis?.trace.length ? (
            <div className="trace-list">
              {analysis.trace.map((step, index) => (
                <div key={`${step.step}-${index}`}>
                  <strong>{step.step}</strong>
                  <span>{step.tool}</span>
                  <small>{step.status} · {step.duration_ms} ms</small>
                  <p>{step.message}</p>
                </div>
              ))}
            </div>
          ) : (
            <p>No trace yet.</p>
          )}
        </details>

        <details>
          <summary>Routing</summary>
          {analysis?.routing ? <pre>{JSON.stringify(analysis.routing, null, 2)}</pre> : <p>No route yet.</p>}
        </details>
      </section>

      <footer className="footer-actions">
        <button type="button" onClick={downloadReport} disabled={!analysis?.report}>
          Download JSON Report
        </button>
      </footer>
    </main>
  );
}
