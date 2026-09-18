"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Expand, FileImage, ImagePlus, LoaderCircle, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function sizeLabel(size: number) {
  return size < 1_000_000 ? `${Math.ceil(size / 1000)} KB` : `${(size / 1_000_000).toFixed(1)} MB`;
}

export function ImageView({ src, name, label, caption }: { src: string; name: string; label: string; caption?: string }) {
  return <Dialog>
    <div className="image-stage group relative flex h-full min-h-64 items-center justify-center overflow-hidden rounded-lg">
      <img src={src} alt={`${label}: ${name}`} className="h-full max-h-[440px] min-h-64 w-full object-contain" />
      <Badge variant="secondary" className="absolute left-3 top-3 bg-white/95 text-[11px] shadow-sm">{label}</Badge>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon" className="absolute bottom-3 right-3 bg-white/95 shadow-sm" aria-label={`Enlarge ${name}`}><Expand className="size-4" /></Button>
      </DialogTrigger>
    </div>
    <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-5xl">
      <DialogTitle className="pr-6 break-all">{name}</DialogTitle>
      <DialogDescription>{caption || `${label} · Image preview. Small details may be lost when resized.`}</DialogDescription>
      <img src={src} alt={`${label}: ${name}, enlarged`} className="max-h-[72vh] w-full rounded-lg bg-muted object-contain" />
    </DialogContent>
  </Dialog>;
}

function FilePreview({ file, label, serverPreview }: { file: File; label: string; serverPreview?: string }) {
  const [preview, setPreview] = useState<{ file: File; src: string } | null>(null);
  const [failed, setFailed] = useState<File | null>(null);
  const isTIFF = /\.tiff?$/i.test(file.name);
  useEffect(() => {
    if (isTIFF || serverPreview) return;
    const reader = new FileReader();
    reader.onload = () => setPreview({ file, src: String(reader.result) });
    reader.onerror = () => setFailed(file);
    reader.readAsDataURL(file);
    return () => { reader.onload = null; reader.onerror = null; reader.abort(); };
  }, [file, isTIFF, serverPreview]);
  const src = serverPreview || (preview?.file === file ? preview.src : null);
  if (src) return <ImageView src={src} name={file.name} label={label} />;
  return <div className="terrain-grid flex min-h-72 flex-col items-center justify-center gap-3 rounded-lg p-5 text-center">
    {isTIFF || failed === file ? <FileImage className="size-9 text-primary/60" /> : <LoaderCircle className="size-7 animate-spin text-primary" />}
    <p className="text-sm font-medium">{isTIFF ? "GeoTIFF ready to analyse" : failed === file ? "Preview unavailable" : "Preparing preview…"}</p>
    <p className="max-w-60 text-xs leading-relaxed text-muted-foreground">{isTIFF ? "Your raster preview will appear after analysis. Its geospatial metadata will be preserved." : "The original file will be checked when you run analysis."}</p>
  </div>;
}

export function ImageInput({ file, label, optional, disabled, multiple, serverPreview, onFiles, onRemove }: {
  file: File | null; label: string; optional?: boolean; disabled: boolean; multiple?: boolean;
  serverPreview?: string; onFiles: (files: File[]) => void; onRemove: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dropDepth = useRef(0);
  return <div className="min-w-0" data-upload-label={label}>
    <input ref={input} id={id} type="file" accept=".png,.jpg,.jpeg,.tif,.tiff" multiple={multiple} disabled={disabled} className="sr-only" aria-label={`Choose ${label.toLowerCase()}`} onChange={event => {
      const files = Array.from(event.target.files || []);
      if (files.length) onFiles(files);
      event.target.value = "";
    }} />
    {file ? <div className="rounded-xl border bg-card p-2">
      <FilePreview file={file} label={label} serverPreview={serverPreview} />
      <div className="flex min-w-0 items-center gap-2 px-1 pb-1 pt-3">
        <FileImage className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={file.name}>{file.name}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{sizeLabel(file.size)}</p></div>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" type="button" disabled={disabled} onClick={onRemove} aria-label={`Remove ${label.toLowerCase()}`}><X className="size-4" /></Button>
      </div>
    </div> : <div className={cn("drop-target terrain-grid relative flex min-h-[280px] sm:min-h-[340px] flex-col items-center justify-center rounded-xl border border-dashed border-primary/25 p-6 text-center", dragging && "border-primary bg-accent ring-2 ring-primary/20", disabled && "opacity-60")}
      onDragEnter={event => { event.preventDefault(); if (!disabled) { dropDepth.current++; setDragging(true); } }}
      onDragOver={event => event.preventDefault()}
      onDragLeave={event => { event.preventDefault(); dropDepth.current--; if (dropDepth.current <= 0) setDragging(false); }}
      onDrop={event => { event.preventDefault(); dropDepth.current = 0; setDragging(false); if (!disabled) onFiles(Array.from(event.dataTransfer.files)); }}>
      <Badge variant="secondary" className="absolute left-3 top-3 bg-white/80 text-[11px]">{label}{optional ? " · optional" : ""}</Badge>
      <div className="upload-glyph mb-8 flex size-14 items-center justify-center rounded-2xl border border-primary/15 bg-white text-primary">{optional ? <ImagePlus className="size-6" /> : <Upload className="size-6" strokeWidth={1.6} />}</div>
      <p className="text-base font-semibold tracking-tight">{dragging ? "Drop your imagery here" : optional ? "Add another perspective" : "Start with a view of Earth"}</p>
      <p className="mb-5 mt-2 max-w-64 text-xs leading-5 text-muted-foreground">{optional ? "Add the second image to compare two dates or sensor views." : "Drag and drop your imagery here, or choose a file to explore."}</p>
      <Button type="button" variant="outline" className="bg-white shadow-sm" disabled={disabled} onClick={() => input.current?.click()}><ImagePlus className="size-4" />Choose {optional ? "second image" : "images"}</Button>
      <p className="mt-4 text-[10px] tracking-wide text-muted-foreground">PNG, JPG, TIFF & GEOTIFF</p>
    </div>}
  </div>;
}
