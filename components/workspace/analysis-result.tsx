"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, CircleCheck, Clipboard, Download, Info, LoaderCircle, ScanLine, Sparkles } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AnalysisPayload } from "@/lib/contracts";

const taskLabels: Record<string, string> = { visual_question: "Scene understanding", change_comparison: "Change comparison", optical_sar_comparison: "Optical & SAR comparison", clarification: "Clarification needed", unsupported: "Capability unavailable" };

export function LoadingAnalysis({ onCancel }: { onCancel: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { const started = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000); return () => clearInterval(timer); }, []);
  return <Card className="overflow-hidden border-primary/15 shadow-none" aria-busy="true" data-testid="analysis-loading">
    <CardContent className="p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><LoaderCircle className="size-5 animate-spin" /></div>
        <div className="flex-1"><h2 className="font-semibold" role="status">Looking closer at your imagery…</h2><p className="mt-1 text-xs text-muted-foreground">{elapsed >= 30 ? "Still working. Detailed comparisons can take up to a minute." : "Reading the scene and preparing a response to your question."}</p></div>
        <span className="text-xs tabular-nums text-muted-foreground" aria-hidden="true">{elapsed}s</span>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} data-testid="cancel-analysis">Cancel analysis</Button>
      </div>
      <div className="ml-0 mt-7 max-w-2xl space-y-3 sm:ml-15" aria-hidden="true"><Skeleton className="h-3 w-11/12" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>
    </CardContent>
  </Card>;
}

export function AnalysisResult({ analysis, onDownload, onEditQuestion, onViewImage }: { analysis: AnalysisPayload; onDownload: () => void; onEditQuestion: () => void; onViewImage: (image: number) => void }) {
  const result = analysis.result!;
  const [copyState, setCopyState] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(result.answer); setCopyState("Copied"); }
    catch { setCopyState("Copy unavailable. Select the answer to copy it."); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState(""), 3000);
  }
  return <Card className="gap-0 overflow-hidden py-0 shadow-[0_4px_24px_-16px_#17453140]" data-testid="analysis-result">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-7">
      <div className="flex items-center gap-3"><div className="flex size-8 items-center justify-center rounded-lg bg-accent"><Sparkles className="size-4 text-primary" /></div><h2 className="text-sm font-semibold">Your analysis</h2><Badge variant="secondary" className="hidden text-[10px] sm:inline-flex">{taskLabels[result.task] || result.task}</Badge></div>
      <div className="flex items-center gap-2">
        <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Copy answer" onClick={copy}>{copyState === "Copied" ? <Check className="size-4" /> : <Clipboard className="size-4" />}</Button></TooltipTrigger><TooltipContent>Copy answer</TooltipContent></Tooltip>
        <Button type="button" variant="outline" size="sm" onClick={onDownload} disabled={!analysis.report} data-testid="download-report"><Download className="size-3.5" />Export report</Button>
      </div>
    </div>
    <div className="grid lg:grid-cols-[1.4fr_1fr]">
      <div className="p-5 sm:p-7">
        <div className="mb-5 flex items-center gap-2 text-[11px] font-medium text-primary"><CircleCheck className="size-3.5" /><span>{result.task === "clarification" ? "ONE MORE DETAIL" : result.task === "unsupported" ? "ABOUT THIS REQUEST" : "AI RESPONSE"}</span></div>
        <p className="whitespace-pre-line text-[15px] leading-7 text-foreground/90" data-testid="answer">{result.answer}</p>
        {result.clarification && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-medium leading-6 text-amber-950">{result.clarification}</p><Button type="button" variant="outline" size="sm" className="mt-3 bg-white" onClick={onEditQuestion}>Update question<ArrowUpRight className="size-3.5" /></Button></div>}
        {result.task === "unsupported" && <Button type="button" variant="outline" size="sm" className="mt-5" onClick={onEditQuestion}>Ask a different question<ArrowUpRight className="size-3.5" /></Button>}
        <p className="mt-6 text-[11px] text-muted-foreground">Generated by {result.model} · Visual interpretation, not a verified measurement.</p>
        <p className="mt-2 text-xs text-primary" role="status">{copyState}</p>
      </div>
      <div className="border-t bg-muted/35 p-5 sm:p-7 lg:border-l lg:border-t-0">
        <h3 className="mb-5 flex items-center gap-2 text-xs font-semibold"><ScanLine className="size-4 text-muted-foreground" />What the model noticed</h3>
        {result.observations.length ? <ol className="space-y-5">{result.observations.map((observation, index) => <li key={index} className="flex gap-3"><span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border bg-white text-[10px] text-muted-foreground">{index + 1}</span><div><p className="text-sm leading-6 text-foreground/85">{observation.description}</p><button type="button" onClick={() => onViewImage(observation.image)} className="mt-1 flex items-center gap-1 rounded text-[11px] font-medium text-primary hover:underline focus-visible:outline-2">View image {observation.image}<ArrowUpRight className="size-3" /></button></div></li>)}</ol> : <p className="text-sm leading-6 text-muted-foreground">{result.task === "clarification" ? "Observations will appear when there is enough context to answer your question." : "No visual observations were generated for this request."}</p>}
      </div>
    </div>
    <Accordion type="multiple" className="border-t px-5 sm:px-7">
      {result.all_warnings.length > 0 && <AccordionItem value="warnings"><AccordionTrigger className="py-4 text-xs hover:no-underline"><span className="flex items-center gap-2"><Info className="size-3.5 text-amber-700" />Things to keep in mind<Badge variant="secondary" className="text-[10px]">{result.all_warnings.length}</Badge></span></AccordionTrigger><AccordionContent><ul className="space-y-2 pl-5 text-xs leading-6 text-muted-foreground">{result.all_warnings.map((warning, i) => <li key={i} className="list-disc">{warning}</li>)}</ul></AccordionContent></AccordionItem>}
      <AccordionItem value="details" className="border-b-0"><AccordionTrigger className="py-4 text-xs hover:no-underline"><span className="flex items-center gap-2"><ScanLine className="size-3.5 text-muted-foreground" />Analysis details</span></AccordionTrigger><AccordionContent>
        <Tabs defaultValue="inputs"><TabsList className="h-8"><TabsTrigger value="inputs" className="text-xs">Image metadata</TabsTrigger><TabsTrigger value="checks" className="text-xs">Validation</TabsTrigger><TabsTrigger value="trace" className="text-xs">Execution trace</TabsTrigger></TabsList>
          <TabsContent value="inputs"><pre className="max-h-72 overflow-auto rounded-lg bg-muted p-4 text-[11px] leading-5 whitespace-pre-wrap break-all">{JSON.stringify(analysis.input_metadata, null, 2)}</pre></TabsContent>
          <TabsContent value="checks"><div className="space-y-3 py-2">{analysis.validation?.checks.map((check, i) => <div key={i} className="flex items-start gap-2 text-xs"><CircleCheck className="mt-0.5 size-3.5 shrink-0 text-primary" /><div><p className="font-medium">{check.name}</p><p className="mt-1 leading-5 text-muted-foreground">{check.message}</p></div></div>)}</div></TabsContent>
          <TabsContent value="trace"><div className="space-y-4 py-2">{analysis.trace.map((step, i) => <div key={i} className="flex gap-3 text-xs"><ChevronRight className="size-4 shrink-0 text-primary" /><div><p className="font-medium">{step.step} <span className="ml-1 font-normal text-muted-foreground">· {step.duration_ms} ms</span></p><p className="mt-1 leading-5 text-muted-foreground">{step.message}</p></div></div>)}<p className="text-xs leading-5 text-muted-foreground">Task selection: {analysis.routing?.reason}</p></div></TabsContent>
        </Tabs>
      </AccordionContent></AccordionItem>
    </Accordion>
  </Card>;
}
