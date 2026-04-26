"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { NotesExtractOk } from "@/app/api/notes/extract/route";

type Stage = "idle" | "extracting" | "preview" | "saving";

export function PhotoUploadButton({ classId }: { classId: string }) {
  const t = useTranslations("mistakes");
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<NotesExtractOk | null>(null);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");

  function reset() {
    setStage("idle");
    setError(null);
    setExtracted(null);
    setBody("");
    setTitle("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage("extracting");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/notes/extract", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const errBody = await res
          .json()
          .catch(() => ({ error: t("photo_extract_failed") }));
        throw new Error(errBody.error ?? t("photo_extract_failed"));
      }
      const json = (await res.json()) as NotesExtractOk;
      setExtracted(json);
      setBody(json.markdown);
      setTitle(deriveTitleFromFile(file.name));
      setStage("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("photo_extract_failed"));
      setStage("idle");
    }
  }

  async function onSave() {
    if (!extracted) return;
    setStage("saving");
    setError(null);
    try {
      const res = await fetch("/api/mistakes/save-handwritten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || deriveTitleFromFile(extracted.blob.filename),
          classId: classId || null,
          bodyMarkdown: body,
          sourceBlobAssetId: extracted.blob.blobAssetId,
        }),
      });
      if (!res.ok) {
        const errBody = await res
          .json()
          .catch(() => ({ error: t("photo_save_failed") }));
        throw new Error(errBody.error ?? t("photo_save_failed"));
      }
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("photo_save_failed"));
      setStage("preview");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]"
      >
        {t("add_from_photo")}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={onFileSelected}
      />

      {stage !== "idle" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-2xl rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 shadow-lg">
            <header className="mb-4">
              <h2 className="text-h2 text-[hsl(var(--foreground))]">
                {t("photo_upload_modal_title")}
              </h2>
              <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
                {t("photo_upload_modal_subtitle")} · {t("photo_supported_formats")}
              </p>
            </header>

            {stage === "extracting" && (
              <div className="flex items-center justify-center py-12 text-small text-[hsl(var(--muted-foreground))]">
                {t("photo_extracting")}
              </div>
            )}

            {(stage === "preview" || stage === "saving") && (
              <div className="space-y-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("photo_title_placeholder")}
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                />
                <div>
                  <div className="mb-1 text-xs text-[hsl(var(--muted-foreground))]">
                    {t("photo_preview_label")}
                  </div>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={16}
                    className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-md bg-[hsl(var(--destructive)/0.1)] px-3 py-2 text-xs text-[hsl(var(--destructive))]">
                {error}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-small"
              >
                {t("photo_cancel")}
              </button>
              {(stage === "preview" || stage === "saving") && (
                <button
                  type="button"
                  onClick={onSave}
                  disabled={stage === "saving" || !body.trim()}
                  className="rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
                >
                  {stage === "saving"
                    ? t("photo_extracting")
                    : t("photo_save_button")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Drop the extension and replace separators so an upload of
// "calc-ch5-page2.png" lands in the title field as
// "calc ch5 page2" — a sane starter the user can rewrite.
export function deriveTitleFromFile(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  return base.replace(/[_-]+/g, " ").trim() || filename;
}
