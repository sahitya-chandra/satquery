"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

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
  reliability: string;
  changed_or_detected_percentage: number;
  explanation?: string;
  metrics?: Record<string, unknown>;
  area_measurement?: Record<string, unknown>;
  all_warnings?: string[];
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

function formatValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, "");
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value === null || value === undefined) {
    return "None";
  }
  return JSON.stringify(value);
}

function imageUrl(url: string): string {
  if (url.startsWith("data:") || url.startsWith("http")) {
    return url;
  }
  return `${API_BASE}${url}`;
}

export default function Home() {
  const [demoCases, setDemoCases] = useState<DemoCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("single");
  const [inputSource, setInputSource] = useState<"demo" | "upload">("demo");
  const [analysisMode, setAnalysisMode] = useState(MODES[0]);
  const [query, setQuery] = useState("What major land-cover regions are visible?");
  const [useAI, setUseAI] = useState(false);
  const [firstFile, setFirstFile] = useState<File | null>(null);
  const [secondFile, setSecondFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCases() {
      try {
        const healthResponse = await fetch(`${API_BASE}/api/health`);
        if (active) {
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
    };
  }, []);

  const selectedCase = useMemo(
    () => demoCases.find((demoCase) => demoCase.id === selectedCaseId) ?? demoCases[0],
    [demoCases, selectedCaseId]
  );

  const visibleDemoImages = selectedCase?.image_urls.map(imageUrl) ?? [];
  const needsSecondUpload = inputSource === "upload" && analysisMode !== "Single Image";
  const warnings = analysis?.result?.all_warnings ?? analysis?.validation?.warnings ?? [];
  const metricEntries = Object.entries(analysis?.result?.metrics ?? {});

  function selectDemoCase(demoCase: DemoCase) {
    setSelectedCaseId(demoCase.id);
    setInputSource("demo");
    setAnalysisMode(demoCase.mode);
    setQuery(demoCase.query);
    setAnalysis(null);
  }

  function onFileChange(which: "first" | "second", event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
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

    const form = new FormData();
    form.append("input_source", inputSource);
    form.append("demo_case", selectedCaseId);
    form.append("analysis_mode", analysisMode);
    form.append("query", query);
    form.append("use_ai", String(useAI));
    if (firstFile) {
      form.append("first_image", firstFile);
    }
    if (secondFile) {
      form.append("second_image", secondFile);
    }

    try {
      if (inputSource === "upload" && (firstFile?.size || 0) + (secondFile?.size || 0) > 3_900_000) {
        throw new Error("Combined uploads must be smaller than 3.9 MB.");
      }
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        body: form
      });
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error(response.status === 413 ? "Uploads exceed the server's size limit." : `Analysis request failed (${response.status}).`);
      }
      const payload = (await response.json()) as AnalyzeResponse;
      setAnalysis(payload);
    } catch (error) {
      setAnalysis({
        ok: false,
        error: error instanceof Error ? error.message : "Request failed.",
        errors: [],
        visuals: [],
        input_metadata: [],
        trace: []
      });
    } finally {
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
        <form className="control-panel" onSubmit={analyze}>
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
                  onClick={() => setInputSource("demo")}
                >
                  Demo
                </button>
                <button
                  type="button"
                  className={inputSource === "upload" ? "selected" : ""}
                  onClick={() => setInputSource("upload")}
                >
                  Upload
                </button>
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="analysis-mode">Analysis Mode</label>
              <select id="analysis-mode" value={analysisMode} onChange={(event) => setAnalysisMode(event.target.value)}>
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
                  <span>{analysisMode === "Optical-SAR Pair" ? "SAR Image" : "Second Image"}</span>
                  <input type="file" accept=".png,.jpg,.jpeg,.tif,.tiff" onChange={(event) => onFileChange("second", event)} />
                  <strong>{secondFile?.name ?? "Choose file"}</strong>
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="field-group">
            <label htmlFor="query">Natural-language Query</label>
            <textarea id="query" value={query} onChange={(event) => setQuery(event.target.value)} rows={4} />
          </div>

          <label className="toggle-row">
            <input type="checkbox" checked={useAI} onChange={(event) => setUseAI(event.target.checked)} />
            <span>Include AI answer</span>
          </label>

          <button className="primary-action" type="submit" disabled={loading || apiOnline === false}>
            {loading ? "Analysing" : "Analyse"}
          </button>
        </form>

        <section className="analysis-panel">
          {analysis?.result ? (
            <div className="result-stack">
              <div className="metric-strip">
                <div>
                  <span>Task</span>
                  <strong>{analysis.result.task}</strong>
                </div>
                <div>
                  <span>Reliability</span>
                  <strong>{analysis.result.reliability}</strong>
                </div>
                <div>
                  <span>Detected Area</span>
                  <strong>{analysis.result.changed_or_detected_percentage.toFixed(1)}%</strong>
                </div>
              </div>

              <section className="answer-band">
                <h2>Answer</h2>
                <p>{analysis.result.answer}</p>
                {analysis.result.explanation ? <small>{analysis.result.explanation}</small> : null}
              </section>

              <section className="visual-grid" aria-label="Visual evidence">
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
                <h2>{selectedCase?.name ?? "SatQuery AI"}</h2>
                <p>{query}</p>
              </div>
              <div className="visual-grid preview-grid" aria-label="Selected demo images">
                {visibleDemoImages.map((url, index) => (
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
        <details open={metricEntries.length > 0}>
          <summary>Metrics</summary>
          {metricEntries.length ? (
            <dl className="key-values">
              {metricEntries.map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replaceAll("_", " ")}</dt>
                  <dd>{formatValue(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>No metrics yet.</p>
          )}
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
