"use client";

import { useId, useRef, useState } from "react";

export function DropZone({
  accept,
  file,
  onFile,
  status = "ready",
}: {
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  status?: "ready" | "extracting";
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  function pick() {
    inputRef.current?.click();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  }

  const hint = humanAcceptHint(accept);

  if (file) {
    const extracting = status === "extracting";
    return (
      <div className="mt-2 flex items-center justify-between rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-4 py-3 text-sm">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{file.name}</p>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            {extracting && (
              <span
                aria-hidden
                className="inline-block h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--primary))]"
              />
            )}
            <span>
              {extracting
                ? `Extracting ${file.name}…`
                : `Ready to extract · ${file.type || "file"} · ${formatSize(file.size)}`}
            </span>
          </p>
        </div>
        {!extracting && (
          <button
            type="button"
            onClick={() => onFile(null)}
            className="ml-3 rounded-md border border-[hsl(var(--border))] px-3 py-1 text-xs transition hover:bg-[hsl(var(--surface))]"
          >
            Remove
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      aria-label="Upload file"
      className={[
        "mt-2 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition",
        dragging
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)]"
          : "border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] hover:border-[hsl(var(--primary)/0.6)] hover:bg-[hsl(var(--primary)/0.04)]",
      ].join(" ")}
    >
      <p className="text-sm text-[hsl(var(--foreground))]">
        Drop {hint} here, or{" "}
        <span className="font-medium text-[hsl(var(--primary))]">click to browse</span>
      </p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Max 20 MB</p>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function humanAcceptHint(accept: string): string {
  const parts: string[] = [];
  if (accept.includes("application/pdf")) parts.push("a PDF");
  if (accept.includes("image/")) parts.push("an image");
  if (parts.length === 0) return "a file";
  if (parts.length === 1) return parts[0];
  return parts.join(" or ");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
