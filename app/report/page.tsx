"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle, Database, Layers2, Orbit, Network, ImageIcon, Sparkles, Check, ScanLine, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function WorkflowDiagram() {
  const nodeClass = "transition-all duration-300 hover:-translate-y-1 cursor-default [filter:drop-shadow(0_4px_12px_rgba(23,69,49,0.08))] hover:[filter:drop-shadow(0_8px_16px_rgba(23,69,49,0.15))]";
  
  return (
    <div className="w-full overflow-x-auto pb-6 pt-2">
      <svg viewBox="0 0 1000 280" className="min-w-[800px] w-full h-auto font-sans" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-primary" />
          </marker>
        </defs>

        {/* 1. Input */}
        <g className={nodeClass}>
          <rect x="40" y="90" width="140" height="100" rx="12" className="fill-white stroke-border" strokeWidth="1" />
          <rect x="40" y="90" width="140" height="40" rx="12" className="fill-muted" />
          {/* Cover bottom corners of header */}
          <rect x="40" y="110" width="140" height="20" className="fill-muted" />
          <path d="M 40 130 L 180 130" className="stroke-border" strokeWidth="1" />
          <text x="110" y="115" textAnchor="middle" className="fill-foreground text-[13px] font-semibold">User Query</text>
          <text x="110" y="152" textAnchor="middle" className="fill-muted-foreground text-[11px]">Images &</text>
          <text x="110" y="170" textAnchor="middle" className="fill-muted-foreground text-[11px]">Natural Language</text>
        </g>

        <path d="M 180 140 L 230 140" className="stroke-primary" strokeWidth="1.5" markerEnd="url(#arrow)" />

        {/* 2. Validation */}
        <g className={nodeClass}>
          <rect x="230" y="90" width="140" height="100" rx="12" className="fill-white stroke-border" strokeWidth="1" />
          <rect x="230" y="90" width="140" height="40" rx="12" className="fill-muted" />
          <rect x="230" y="110" width="140" height="20" className="fill-muted" />
          <path d="M 230 130 L 370 130" className="stroke-border" strokeWidth="1" />
          <text x="300" y="115" textAnchor="middle" className="fill-foreground text-[13px] font-semibold">Validation</text>
          <text x="300" y="152" textAnchor="middle" className="fill-muted-foreground text-[11px]">Format, CRS,</text>
          <text x="300" y="170" textAnchor="middle" className="fill-muted-foreground text-[11px]">Alignment</text>
        </g>

        <path d="M 370 140 L 420 140" className="stroke-primary" strokeWidth="1.5" markerEnd="url(#arrow)" />

        {/* 3. Planner (Highlight) */}
        <g className={nodeClass}>
          <rect x="420" y="85" width="160" height="110" rx="12" className="fill-accent stroke-primary/30" strokeWidth="1.5" />
          <rect x="420" y="85" width="160" height="40" rx="12" className="fill-primary text-white" />
          <rect x="420" y="105" width="160" height="20" className="fill-primary" />
          <text x="500" y="110" textAnchor="middle" className="fill-white text-[13px] font-semibold">Agentic Planner</text>
          <text x="500" y="145" textAnchor="middle" className="fill-primary text-[11px] font-medium">Automatic</text>
          <text x="500" y="163" textAnchor="middle" className="fill-primary text-[11px] font-medium">Task Routing</text>
          <text x="500" y="181" textAnchor="middle" className="fill-primary text-[11px] font-medium">& Model Binding</text>
        </g>

        <path d="M 580 140 L 630 140" className="stroke-primary" strokeWidth="1.5" markerEnd="url(#arrow)" />

        {/* 4. AI Models */}
        <g className={nodeClass}>
          <rect x="630" y="90" width="140" height="100" rx="12" className="fill-white stroke-border" strokeWidth="1" />
          <rect x="630" y="90" width="140" height="40" rx="12" className="fill-muted" />
          <rect x="630" y="110" width="140" height="20" className="fill-muted" />
          <path d="M 630 130 L 770 130" className="stroke-border" strokeWidth="1" />
          <text x="700" y="115" textAnchor="middle" className="fill-foreground text-[13px] font-semibold">AI Models</text>
          <text x="700" y="152" textAnchor="middle" className="fill-muted-foreground text-[11px]">VQA, Grounding,</text>
          <text x="700" y="170" textAnchor="middle" className="fill-muted-foreground text-[11px]">Change, Fusion</text>
        </g>

        <path d="M 770 140 L 820 140" className="stroke-primary" strokeWidth="1.5" markerEnd="url(#arrow)" />

        {/* 5. Output */}
        <g className={nodeClass}>
          <rect x="820" y="90" width="140" height="100" rx="12" className="fill-white stroke-border" strokeWidth="1" />
          <rect x="820" y="90" width="140" height="40" rx="12" className="fill-muted" />
          <rect x="820" y="110" width="140" height="20" className="fill-muted" />
          <path d="M 820 130 L 960 130" className="stroke-border" strokeWidth="1" />
          <text x="890" y="115" textAnchor="middle" className="fill-foreground text-[13px] font-semibold">Verified Output</text>
          <text x="890" y="152" textAnchor="middle" className="fill-muted-foreground text-[11px]">Answer +</text>
          <text x="890" y="170" textAnchor="middle" className="fill-muted-foreground text-[11px]">Visual Evidence</text>
        </g>

      </svg>
    </div>
  );
}

export default function WorkflowPage() {
  return (
    <div className="min-h-screen bg-[#fafcfb]">
      <header className="border-b bg-white/90 sticky top-0 z-10">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-6 px-5 sm:px-8 lg:px-12">
          <Link href="/" aria-label="SatQuery home" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white">
              <Orbit className="size-5" strokeWidth={1.6} />
            </span>
            <span className="text-xl font-semibold tracking-[-0.8px]">
              satquery<span className="text-primary">.</span>
            </span>
          </Link>
          <Separator orientation="vertical" className="hidden !h-5 sm:block" />
          <span className="hidden items-center gap-2 text-xs font-medium text-muted-foreground sm:flex"><Network className="size-3.5" />Workflow Architecture</span>
          <div className="ml-auto flex items-center">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href="/" className="group flex items-center"><ArrowLeft className="size-4 mr-1.5 transition-transform duration-300 group-hover:-translate-x-1" /><span className="hidden sm:inline">Back to workspace</span></Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 pb-8 pt-8 sm:px-8 lg:px-12 lg:pt-10 space-y-8">
        
        <div className="mb-7">
          <p className="mb-2 text-[10px] font-semibold tracking-[.16em] text-primary">SYSTEM ARCHITECTURE</p>
          <h1 className="text-[30px] font-semibold tracking-[-1.1px] sm:text-[36px]">How SatQuery works.</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            A transparent look into the lifecycle of a query: from image ingestion and validation, to agentic orchestration and evidence-backed answers.
          </p>
        </div>

        {/* The SVG Diagram Card */}
        <Card className="gap-0 overflow-hidden py-0 shadow-[0_4px_24px_-16px_#17453140] bg-white transition-all duration-300 hover:shadow-[0_8px_30px_-12px_#17453150] hover:-translate-y-0.5">
          <div className="flex items-center gap-2.5 border-b px-5 py-4">
            <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-primary">
              <Network className="size-3" />
            </span>
            <h2 className="text-sm font-semibold">Query Lifecycle Diagram</h2>
          </div>
          <div className="p-5">
            <WorkflowDiagram />
          </div>
        </Card>

        {/* Detailed Explanation */}
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          
          <Card className="gap-0 overflow-hidden py-0 shadow-[0_4px_24px_-16px_#17453140] bg-white transition-all duration-300 hover:shadow-[0_8px_30px_-12px_#17453150] hover:-translate-y-0.5">
            <div className="flex items-center gap-2.5 border-b px-5 py-4">
              <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-primary">1</span>
              <h2 className="text-sm font-semibold">Ingestion & Validation</h2>
            </div>
            <div className="p-5 sm:p-7 space-y-4">
              <p className="text-[13px] leading-6 text-foreground/90">
                When a query is submitted, the system first passes the imagery through the <strong>GeoGuard Validation</strong> step. 
                This extracts critical metadata (CRS, band count, spatial resolution, and timestamps) directly from file headers or naming conventions. 
              </p>
              <p className="text-[13px] leading-6 text-foreground/90">
                If the user submits an image pair (for change detection or optical-SAR fusion), GeoGuard ensures the images overlap geographically, are properly co-registered, and possess compatible spatial resolutions before any AI inference begins.
              </p>
            </div>
          </Card>

          <Card className="gap-0 overflow-hidden py-0 shadow-[0_4px_24px_-16px_#17453140] bg-white transition-all duration-300 hover:shadow-[0_8px_30px_-12px_#17453150] hover:-translate-y-0.5">
            <div className="flex items-center gap-2.5 border-b px-5 py-4">
              <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-primary">2</span>
              <h2 className="text-sm font-semibold">Agentic Task Controller</h2>
            </div>
            <div className="p-5 sm:p-7 space-y-4">
              <p className="text-[13px] leading-6 text-foreground/90">
                SatQuery employs an <strong>Agentic Controller</strong> to select the appropriate specialist AI model based on the user's natural language query and the validated imagery characteristics.
              </p>
              <ul className="space-y-3 mt-4">
                <li className="flex gap-3">
                  <CheckCircle className="size-4 text-primary shrink-0 mt-0.5" />
                  <span className="text-[13px] leading-5 text-foreground/90"><strong>Task Routing:</strong> Evaluates if the query requires standard VQA, grounding, temporal change analysis, or multi-sensor fusion.</span>
                </li>
                <li className="flex gap-3">
                  <CheckCircle className="size-4 text-primary shrink-0 mt-0.5" />
                  <span className="text-[13px] leading-5 text-foreground/90"><strong>Fallback Strategy:</strong> If a user asks for an unsupported capability (like exact pixel counting), the controller aborts and safely asks for clarification rather than hallucinating an answer.</span>
                </li>
              </ul>
            </div>
          </Card>
          
        </div>

        {/* Naming Architecture */}
        <Card className="gap-0 overflow-hidden py-0 shadow-[0_4px_24px_-16px_#17453140] bg-white transition-all duration-300 hover:shadow-[0_8px_30px_-12px_#17453150] hover:-translate-y-0.5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-primary">
                <Database className="size-3" />
              </span>
              <h2 className="text-sm font-semibold">Image Naming & Metadata Architecture</h2>
            </div>
          </div>
          <div className="grid lg:grid-cols-[1.2fr_1fr]">
            <div className="p-5 sm:p-7">
              <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold"><ImageIcon className="size-4 text-muted-foreground" />Context from Filenames</h3>
              <p className="text-[13px] leading-6 text-foreground/90 mb-4">
                Filenames provide vital context during inference. For example, our system uses semantic markers inside the filename to determine sensor types and chronological ordering before injecting them into the Vision-Language Model.
              </p>
              <div className="bg-muted p-4 rounded-lg font-mono text-[11px] leading-6 text-foreground/80 border break-all space-y-2 transition-colors duration-300 hover:bg-muted/80 hover:border-primary/20">
                <div>2026-08-01-00_00_2026-08-01-23_59_<strong className="text-primary">Sentinel-1</strong>_IW_<strong className="text-amber-600">RGB_Ratio</strong>.jpg</div>
                <div>2023-07-01-00_00_2023-07-01-23_59_<strong className="text-primary">Sentinel-1</strong>_IW__<strong className="text-blue-600">SAR_Urban</strong>.jpg</div>
              </div>
            </div>
            <div className="border-t bg-muted/35 p-5 sm:p-7 lg:border-l lg:border-t-0 space-y-5">
              <h3 className="mb-4 flex items-center gap-2 text-xs font-semibold"><ScanLine className="size-4 text-muted-foreground" />How it is used</h3>
              <div className="flex gap-3 text-xs">
                <Check className="size-4 shrink-0 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold text-[13px]">Temporal Extraction</p>
                  <p className="mt-1 leading-5 text-muted-foreground">The system identifies chronological order (e.g., 2023 vs 2026) to correctly orient "before" and "after" for bi-temporal change detection tasks.</p>
                </div>
              </div>
              <div className="flex gap-3 text-xs">
                <Check className="size-4 shrink-0 text-primary mt-0.5" />
                <div>
                  <p className="font-semibold text-[13px]">Sensor Identification</p>
                  <p className="mt-1 leading-5 text-muted-foreground">The <code>Sentinel-1</code> marker alerts the AI that it is analyzing Synthetic Aperture Radar (SAR), which measures structural/roughness data rather than optical color.</p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 text-[10px] text-muted-foreground/85">
          <span className="flex items-center gap-1.5"><Orbit className="size-3" />SatQuery AI <ChevronRight className="size-2.5" /> System Architecture</span>
          <span>Transparent execution · Grounded visual evidence</span>
        </footer>

      </main>
    </div>
  );
}
