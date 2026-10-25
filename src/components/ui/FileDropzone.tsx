"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/ui/cn";

type FileDropzoneProps = {
  label: string;
  accept: string;
  required?: boolean;
  file: File | null;
  onFile: (file: File | null) => void;
  hint?: string;
};

export function FileDropzone({
  label,
  accept,
  required,
  file,
  onFile,
  hint,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function pick() {
    inputRef.current?.click();
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null;
    onFile(next);
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function onDragLeave() {
    setDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  }

  return (
    <div className="block text-sm">
      <span className="text-ink-primary">{label}</span>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      <button
        type="button"
        onClick={pick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "mt-2 flex w-full min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center transition",
          dragging
            ? "border-accent/50 bg-accent/10"
            : "border-[var(--border-subtle)] bg-[var(--surface-subtle)] hover:border-accent/30",
        )}
      >
        <Upload className="h-5 w-5 text-accent" strokeWidth={1.5} />
        <span className="text-xs text-ink-muted">
          {file ? file.name : "Click or drag a file here"}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        required={required}
        className="hidden"
        onChange={onInputChange}
      />
    </div>
  );
}
