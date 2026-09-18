"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp, CirclePlus, Clock3, Compass, ImageIcon, Layers2, LoaderCircle, Orbit, Radar, RefreshCw, ScanLine, Sparkles, Upload, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ImageInput, ImageView } from "@/components/workspace/image-input";
import { AnalysisResult, LoadingAnalysis } from "@/components/workspace/analysis-result";
import { buildAnalysisForm } from "@/lib/analysis-form";
import { errorPayload, type AnalysisPayload } from "@/lib/contracts";
import type { DemoCase } from "@/lib/demo-cases";
import { analysisOptions, getAnalysisOption, MAX_QUERY_LENGTH, uploadError } from "@/lib/analysis-options";
import { cn } from "@/lib/utils";

const modeIcons = { "Auto Detect": Sparkles, "Single Image": ImageIcon, "Bi-temporal Change": Clock3, "Optical-SAR Pair": Radar };
const modeOptions = analysisOptions.map(option => ({ ...option, icon: modeIcons[option.value] }));
const exampleTitles: Record<string, string> = { single: "Explore a landscape", change: "Spot the differences", fusion: "Two sensor views" };

async function readService(signal?: AbortSignal) {
  return Promise.allSettled([
    fetch("/api/health", { signal }).then(async response => { if (!response.ok) throw new Error("Offline"); return response.json(); }),
    fetch("/api/demo-cases", { signal }).then(async response => { if (!response.ok) throw new Error("Examples unavailable"); return response.json(); }),
  ]);
}

function Guide() {
  return <Dialog><DialogTrigger asChild><Button variant="ghost" size="sm" className="text-muted-foreground"><CircleHelp className="size-4" /><span className="hidden sm:inline">How it works</span><span className="sr-only sm:hidden">How it works</span></Button></DialogTrigger><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>A closer look, in three steps</DialogTitle><DialogDescription>Turn a question about your imagery into a visual explanation.</DialogDescription></DialogHeader>
    <ol className="space-y-5 py-3">{[["Choose your imagery", "Upload one image, or a pair for comparison. PNG, JPEG and GeoTIFF files are supported."], ["Ask what you want to know", "Describe a scene or ask about visible differences. Let AI choose a task, or select a mode."], ["Review the evidence", "Read the answer alongside source-linked observations, limitations and a downloadable report."]].map(([title, text], i) => <li key={title} className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary">{i + 1}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{text}</p></div></li>)}</ol>
    <div className="rounded-lg bg-muted p-4 text-xs leading-6 text-muted-foreground">Image previews, metadata and your question are sent to the configured AI provider. Answers are visual interpretations. Exact counts, pixel masks, measured areas and calibrated SAR fusion are not available. Examples use synthetic illustrations.</div>
  </DialogContent></Dialog>;
}

export default function Home() {
  const [cases, setCases] = useState<DemoCase[]>([]);
  const [caseId, setCaseId] = useState("single");
  const [source, setSource] = useState<"upload" | "demo">("upload");
  const [mode, setMode] = useState("Auto Detect");
  const [query, setQuery] = useState("");
  const [first, setFirst] = useState<File | null>(null);
  const [second, setSecond] = useState<File | null>(null);
  const [addSecond, setAddSecond] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [highlightedImage, setHighlightedImage] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const resultArea = useRef<HTMLDivElement>(null);
  const question = useRef<HTMLTextAreaElement>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedCase = cases.find(item => item.id === caseId);
  const selectedMode = modeOptions.find(item => item.value === mode)!;
  const pairRequired = selectedMode.imageCount === 2;
  const showSecond = mode !== "Single Image" && (pairRequired || addSecond || !!second);
  const hasImages = source === "demo" ? !!selectedCase : !!first && (!pairRequired || !!second);
  const imageCount = source === "demo" ? selectedCase?.files.length || 0 : Number(!!first) + Number(showSecond && !!second);
  const { suggestions, labels } = selectedMode;

  const applyService = useCallback(([health, examples]: Awaited<ReturnType<typeof readService>>) => {
    setApiOnline(health.status === "fulfilled");
    setAiConfigured(health.status === "fulfilled" && health.value.ai?.configured === true);
    if (examples.status === "fulfilled") setCases(examples.value.cases);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void readService(controller.signal).then(result => { if (!controller.signal.aborted) applyService(result); });
    return () => { controller.abort(); request.current?.abort(); if (highlightTimer.current) clearTimeout(highlightTimer.current); };
  }, [applyService]);

  function loadService() { void readService().then(applyService); }

  function clearResult() { setAnalysis(null); setInputError(null); }
  function chooseExample(item: DemoCase) { setCaseId(item.id); setSource("demo"); setMode(item.mode); setQuery(item.query); clearResult(); }
  function changeMode(value: string) {
    setMode(value); clearResult();
    if (source === "demo") {
      const matchingId = getAnalysisOption(value)?.example;
      if (matchingId) setCaseId(matchingId);
    }
    if (value === "Single Image") { setSecond(null); setAddSecond(false); }
  }
  function acceptFiles(files: File[], position: "first" | "second") {
    if (loading || !files.length) return;
    const limit = position === "first" && mode !== "Single Image" ? 2 : 1;
    if (files.length > limit) { setInputError(`Choose up to ${limit} image${limit === 1 ? "" : "s"} for this slot.`); return; }
    const nextFirst = position === "first" ? files[0] : first;
    const nextSecond = position === "second" ? files[0] : files[1] || second;
    const activeSecond = mode === "Single Image" ? null : nextSecond;
    const error = uploadError([nextFirst, activeSecond].filter((file): file is File => file !== null));
    if (error) { setInputError(error); return; }
    setFirst(nextFirst); setSecond(activeSecond); if (activeSecond) setAddSecond(true); clearResult();
  }
  function reset() { setFirst(null); setSecond(null); setAddSecond(false); setSource("upload"); setQuery(""); setMode("Auto Detect"); clearResult(); question.current?.focus(); }
  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setAnalysis(null); setInputError(null);
    let form: FormData;
    try { form = buildAnalysisForm({ inputSource: source, demoCase: caseId, mode, query, firstFile: first, secondFile: second }); }
    catch (error) { setInputError(error instanceof Error ? error.message : "Check your inputs."); return; }
    const controller = new AbortController(); request.current = controller; setLoading(true);
    try {
      const response = await fetch("/api/analyze", { method: "POST", body: form, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]) });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(response.status === 413 ? "Uploads exceed the server limit. Choose smaller images." : `Analysis failed (${response.status}). Please try again.`);
      setAnalysis(await response.json());
    } catch (error) {
      setAnalysis(errorPayload(error instanceof Error && error.name === "AbortError" ? "Analysis cancelled. Your images and question are still here." : error instanceof Error && error.name === "TimeoutError" ? "Analysis took too long. Your inputs are saved here; please try again." : error instanceof Error ? error.message : "Request failed. Please try again."));
    } finally { request.current = null; setLoading(false); }
  }
  useEffect(() => {
    if (analysis?.result) resultArea.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" });
  }, [analysis]);
  function downloadReport() {
    if (!analysis?.report) return;
    const url = URL.createObjectURL(new Blob([analysis.report], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "satquery_ai_report.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function viewImage(image: number) {
    const target = document.getElementById(`image-${image}`);
    target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    target?.focus({ preventScroll: true }); setHighlightedImage(image);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedImage(null), 2500);
  }
  const status = apiOnline === null ? "Connecting" : !apiOnline ? "Connection unavailable" : !aiConfigured ? "AI setup needed" : "AI connected";
  const error = analysis && !analysis.ok ? analysis.error : null;

  return <div className="min-h-screen">
    <header className="border-b bg-white/90">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-6 px-5 sm:px-8 lg:px-12">
        <Link href="/" aria-label="SatQuery home" className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white"><Orbit className="size-5" strokeWidth={1.6} /></span><span className="text-xl font-semibold tracking-[-0.8px]">satquery<span className="text-primary">.</span></span></Link>
        <Separator orientation="vertical" className="hidden !h-5 sm:block" />
        <span className="hidden items-center gap-2 text-xs font-medium text-muted-foreground sm:flex"><Layers2 className="size-3.5" />Workspace</span>
        <div className="ml-auto flex items-center gap-2 sm:gap-5"><span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" role="status" data-testid="connection-status"><span className={cn("size-1.5 rounded-full", apiOnline && aiConfigured ? "bg-emerald-500" : apiOnline === null ? "animate-pulse bg-slate-400" : "bg-amber-500")} />{status}</span><Guide /></div>
      </div>
    </header>

    <main className="mx-auto max-w-[1440px] px-5 pb-8 pt-8 sm:px-8 lg:px-12 lg:pt-10">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
        <div><p className="mb-2 text-[10px] font-semibold tracking-[.16em] text-primary">A DIFFERENT PERSPECTIVE</p><h1 className="text-[30px] font-semibold tracking-[-1.1px] sm:text-[36px]">Ask your imagery.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Explore a scene. Compare two moments. See what your imagery has to say.</p></div>
        <Tooltip><TooltipTrigger asChild><Button type="button" variant="outline" size="sm" className="bg-white" disabled={loading || (!first && !query && source === "upload")} onClick={reset}><CirclePlus className="size-3.5" />New analysis</Button></TooltipTrigger><TooltipContent>Clear your images and question</TooltipContent></Tooltip>
      </div>

      {apiOnline !== null && (!apiOnline || !aiConfigured) && <Alert className="mb-6 border-amber-200 bg-amber-50"><CircleHelp className="size-4" /><AlertTitle>{!apiOnline ? "Unable to connect to the analysis service" : "Connect an AI model to get started"}</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{!apiOnline ? "Check your connection and try again. Your selected images will stay here." : "Add the model ID and API key to the server environment, then restart the app."}</span><Button type="button" variant="outline" size="sm" className="bg-white" onClick={() => void loadService()}><RefreshCw className="size-3" />Check again</Button></AlertDescription></Alert>}

      <form onSubmit={analyze} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && hasImages && query.trim() && apiOnline && aiConfigured && !loading) { event.preventDefault(); event.currentTarget.requestSubmit(); } }}>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_350px] xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="gap-0 overflow-hidden py-0 shadow-[0_4px_24px_-16px_#17453140]" id="imagery">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6"><div className="flex items-center gap-2.5"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">1</span><h2 className="text-sm font-semibold">Your imagery</h2></div><span className="text-[11px] text-muted-foreground">{imageCount ? `${imageCount} image${imageCount > 1 ? "s" : ""} selected` : "Every question starts with an image"}</span></div>
            <Tabs value={source} onValueChange={value => { if (loading) return; if (value === "demo" && selectedCase) chooseExample(selectedCase); else { setSource(value as "upload" | "demo"); clearResult(); } }} className="gap-0">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-4 pt-5 sm:px-6"><TabsList className="h-9 bg-muted"><TabsTrigger value="upload" disabled={loading} className="gap-1.5 px-3 text-xs"><Upload className="size-3.5" />Upload images</TabsTrigger><TabsTrigger value="demo" disabled={loading} className="gap-1.5 px-3 text-xs"><Compass className="size-3.5" />Try an example</TabsTrigger></TabsList><span className="text-[10px] text-muted-foreground">Up to 3.9 MB combined</span></div>
              <TabsContent value="upload" className="mt-0 px-5 pb-5 sm:px-6">
                <div className={cn("grid gap-3", showSecond && "sm:grid-cols-2")} data-testid="upload-grid">
                  <div id="image-1" tabIndex={-1} className={cn("min-w-0 rounded-xl outline-none transition-shadow", highlightedImage === 1 && "ring-2 ring-primary ring-offset-4")}><ImageInput file={first} label={labels[0]} disabled={loading} multiple={mode !== "Single Image"} serverPreview={analysis?.result ? analysis.visuals[0]?.src : undefined} onFiles={files => acceptFiles(files, "first")} onRemove={() => { setFirst(null); clearResult(); }} /></div>
                  {showSecond && <div id="image-2" tabIndex={-1} className={cn("min-w-0 rounded-xl outline-none transition-shadow", highlightedImage === 2 && "ring-2 ring-primary ring-offset-4")}><ImageInput file={second} label={labels[1]} optional={!pairRequired} disabled={loading} serverPreview={analysis?.result ? analysis.visuals[1]?.src : undefined} onFiles={files => acceptFiles(files, "second")} onRemove={() => { setSecond(null); if (!pairRequired) setAddSecond(false); clearResult(); }} /></div>}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ScanLine className="size-3.5" />PNG, JPEG, TIFF & GeoTIFF</p>{mode === "Auto Detect" && !showSecond && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-primary" disabled={loading} onClick={() => setAddSecond(true)}><CirclePlus className="size-3.5" />Add a second image</Button>}{mode === "Auto Detect" && showSecond && !second && <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" disabled={loading} onClick={() => setAddSecond(false)}><X className="size-3" />Use one image</Button>}</div>
              </TabsContent>
              <TabsContent value="demo" className="mt-0 px-5 pb-5 sm:px-6">
                {selectedCase ? <><div className={cn("grid gap-3", selectedCase.files.length > 1 && "sm:grid-cols-2")}>{selectedCase.image_urls.map((url, i) => <div id={`image-${i + 1}`} tabIndex={-1} key={url} className={cn("min-w-0 rounded-xl outline-none", highlightedImage === i + 1 && "ring-2 ring-primary ring-offset-4")}><ImageView src={url} name={selectedCase.files[i]} label={`Image ${i + 1}`} caption="Synthetic example illustration, not a real satellite observation." /></div>)}</div><p className="mb-4 mt-3 text-[10px] text-muted-foreground">Synthetic example · For exploring the workflow, not evaluating accuracy.</p></> : <div className="rounded-lg bg-muted p-8 text-center text-sm text-muted-foreground">{apiOnline === null ? "Loading examples…" : "Examples could not be loaded."}<Button type="button" variant="link" onClick={() => void loadService()}>Try again</Button></div>}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{cases.map((item, i) => <button key={item.id} type="button" disabled={loading} aria-pressed={caseId === item.id} onClick={() => chooseExample(item)} className={cn("flex items-center gap-2 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50", caseId === item.id ? "border-primary/40 bg-accent/60" : "bg-white")} data-example={item.id}><img src={item.image_urls[0]} alt="" className="size-8 shrink-0 rounded object-cover" /><span className="min-w-0"><span className="block text-[9px] text-muted-foreground">EXAMPLE 0{i + 1}</span><span className="block text-[11px] font-medium">{exampleTitles[item.id] || item.name}</span></span>{caseId === item.id && <Check className="ml-auto size-3 shrink-0 text-primary" />}</button>)}</div>
              </TabsContent>
            </Tabs>
            {inputError && <Alert variant="destructive" className="mx-5 mb-5 w-auto border-destructive/25 bg-red-50/60" data-testid="input-error"><CircleHelp className="size-4" /><AlertTitle>Check your image</AlertTitle><AlertDescription>{inputError}</AlertDescription></Alert>}
          </Card>

          <Card className="gap-0 overflow-hidden py-0 shadow-[0_4px_24px_-16px_#17453140]">
            <div className="flex items-center gap-2.5 border-b px-5 py-4"><span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-primary">2</span><h2 className="text-sm font-semibold">What would you like to know?</h2></div>
            <div className="space-y-5 p-5">
              <div><label htmlFor="analysis-mode" className="mb-2 block text-[11px] font-semibold text-muted-foreground">ANALYSIS MODE</label><Select value={mode} onValueChange={changeMode} disabled={loading}><SelectTrigger id="analysis-mode" className="h-11 w-full bg-white"><SelectValue /></SelectTrigger><SelectContent>{modeOptions.map(item => <SelectItem key={item.value} value={item.value}><span className="flex items-center gap-2"><item.icon className="size-3.5 text-primary" />{item.label}</span></SelectItem>)}</SelectContent></Select><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{selectedMode.description}</p></div>
              <Separator />
              <div><label htmlFor="query" className="mb-2 block text-[11px] font-semibold text-muted-foreground">YOUR QUESTION</label><Textarea ref={question} id="query" value={query} onChange={event => { setQuery(event.target.value); clearResult(); }} disabled={loading} maxLength={MAX_QUERY_LENGTH} placeholder="What can you tell me about this landscape?" className="min-h-[135px] resize-y bg-[#fafcfb] p-3 text-sm leading-6 placeholder:text-muted-foreground/65" /><div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground"><span>Be as curious or specific as you like.</span><span aria-label={`${query.length} of ${MAX_QUERY_LENGTH} characters`}>{query.length.toLocaleString()}/{MAX_QUERY_LENGTH.toLocaleString()}</span></div></div>
              <div><p className="mb-2.5 text-[10px] font-medium text-muted-foreground">NEED A STARTING POINT?</p><div className="flex flex-col gap-2">{suggestions.map(suggestion => <button type="button" key={suggestion} disabled={loading} onClick={() => { setQuery(suggestion); clearResult(); question.current?.focus(); }} className="group flex items-center justify-between gap-3 rounded-md border border-transparent px-2 py-1 text-left text-xs leading-5 text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-2 disabled:opacity-50"><span>{suggestion}</span><ArrowUpRight className="size-3 shrink-0 text-muted-foreground/60 group-hover:text-primary" /></button>)}</div></div>
              <div className="pt-1"><Button type="submit" className="h-11 w-full gap-2 text-sm shadow-sm" disabled={loading || !apiOnline || !aiConfigured || !hasImages || !query.trim()} data-testid="analyze">{loading ? <><LoaderCircle className="size-4 animate-spin" />Analysing imagery…</> : <><Sparkles className="size-4" />Analyse imagery<ArrowRight className="ml-auto size-4" /></>}</Button><p className="mt-2 text-center text-[10px] text-muted-foreground">{!hasImages ? "Add your imagery to get started" : !query.trim() ? "Write a question or choose a suggestion" : "Ctrl / ⌘ + Enter to analyse"}</p></div>
              <p className="border-t pt-3 text-[10px] leading-[1.7] text-muted-foreground">Your question and image previews are sent to the configured AI provider when you analyse. Results are visual interpretations.</p>
            </div>
          </Card>
        </div>
      </form>

      {error && <Alert variant="destructive" className="mt-5 border-destructive/25 bg-red-50/60" data-testid="analysis-error"><CircleHelp className="size-4" /><AlertTitle>{error.startsWith("Analysis cancelled") ? "Analysis cancelled" : "Let’s try that again"}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      <div ref={resultArea} className="mt-6 scroll-mt-6">
        {loading ? <LoadingAnalysis onCancel={() => request.current?.abort()} /> : analysis?.result ? <AnalysisResult analysis={analysis} onDownload={downloadReport} onEditQuestion={() => { question.current?.scrollIntoView({ block: "center" }); question.current?.focus(); }} onViewImage={viewImage} /> : !error && <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-5 py-7 text-center sm:flex-row sm:gap-4 sm:py-6"><div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white"><ScanLine className="size-4 text-primary/65" /></div><div className="sm:text-left"><p className="text-xs font-medium">A place for your next discovery</p><p className="mt-1 text-[11px] text-muted-foreground">Your answer, visual observations, and source references will appear here.</p></div><ArrowDown className="hidden size-3.5 text-muted-foreground/40 sm:ml-auto sm:block" /></div>}
      </div>

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-[10px] text-muted-foreground/85"><span className="flex items-center gap-1.5"><Orbit className="size-3" />SatQuery AI <ChevronRight className="size-2.5" /> A new perspective on your imagery</span><span>Visual understanding · No measured areas or generated masks</span></footer>
    </main>
  </div>;
}
