"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DropZone } from "./drop-zone";

type ScheduleItem = { date: string | null; topic: string | null };

type Syllabus = {
  courseName: string | null;
  courseCode: string | null;
  term: string | null;
  instructor: string | null;
  officeHours: string | null;
  grading: string | null;
  attendance: string | null;
  textbooks: string | null;
  schedule: ScheduleItem[];
  sourceUrl: string | null;
  raw: string | null;
};

type Verbatim = {
  fullText: string;
  sourceKind: "pdf" | "image" | "url";
  blob?: {
    blobAssetId: string;
    url: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  };
};

async function friendlyError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // ignore
  }
  return `Request failed (${res.status})`;
}

export function SyllabusWizard({
  classes,
  blobConfigured = true,
}: {
  classes: Array<{ id: string; name: string }>;
  blobConfigured?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syllabus, setSyllabus] = useState<Syllabus | null>(null);
  const [verbatim, setVerbatim] = useState<Verbatim | null>(null);
  const [classId, setClassId] = useState<string>("");
  const router = useRouter();

  async function extract() {
    setError(null);
    setExtracting(true);
    try {
      const fd = new FormData();
      if (file) fd.append("file", file);
      else if (url.trim()) fd.append("url", url.trim());
      else throw new Error("Provide a file or URL.");
      const res = await fetch("/api/syllabus/extract", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await friendlyError(res));
      const body = (await res.json()) as { syllabus: Syllabus; verbatim: Verbatim };
      setSyllabus(body.syllabus);
      setVerbatim(body.verbatim);
    } catch (err) {
      setError(err instanceof Error ? err.message : "extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function save() {
    if (!syllabus || !verbatim) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/syllabus/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syllabus,
          verbatim,
          classNotionPageId: classId || null,
        }),
      });
      if (!res.ok) throw new Error(await friendlyError(res));
      const { pageId } = (await res.json()) as { pageId: string; url: string | null };
      router.push(`/app/syllabus?saved=${encodeURIComponent(pageId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  function patch<K extends keyof Syllabus>(key: K, value: Syllabus[K]) {
    setSyllabus((s) => (s ? { ...s, [key]: value } : s));
  }

  const imagesAllowed = blobConfigured;
  const accept = imagesAllowed ? "application/pdf,image/*" : "application/pdf";

  return (
    <div className="mt-8 space-y-6">
      {!syllabus && (
        <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          <label className="block text-xs text-[hsl(var(--muted-foreground))]">
            URL (web-page syllabi only)
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setFile(null);
            }}
            placeholder="https://…"
            className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
          <div className="mt-5">
            <label className="block text-xs text-[hsl(var(--muted-foreground))]">
              Or a {imagesAllowed ? "PDF / image" : "PDF"}
            </label>
            <DropZone
              accept={accept}
              file={file}
              status={extracting ? "extracting" : "ready"}
              onFile={(f) => {
                setFile(f);
                setUrl("");
              }}
            />
            {!imagesAllowed && (
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                Image uploads require Vercel Blob. Ask the administrator to
                configure <code className="font-mono">BLOB_READ_WRITE_TOKEN</code>.
                PDF uploads still work.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={extracting || (!url.trim() && !file)}
            onClick={extract}
            className="mt-5 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
          >
            {extracting ? "Extracting…" : "Extract"}
          </button>
        </section>
      )}

      {error && (
        <div className="rounded-lg bg-[hsl(var(--destructive)/0.1)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
          {error}
        </div>
      )}

      {syllabus && (
        <section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          <h2 className="text-h2 text-[hsl(var(--foreground))]">Preview</h2>
          <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
            Edit anything before saving. Leave a field blank to skip it.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Course name" value={syllabus.courseName} onChange={(v) => patch("courseName", v)} />
            <Field label="Course code" value={syllabus.courseCode} onChange={(v) => patch("courseCode", v)} />
            <Field label="Term" value={syllabus.term} onChange={(v) => patch("term", v)} />
            <Field label="Instructor" value={syllabus.instructor} onChange={(v) => patch("instructor", v)} />
          </div>

          <FieldArea label="Grading" value={syllabus.grading} onChange={(v) => patch("grading", v)} />
          <FieldArea label="Attendance" value={syllabus.attendance} onChange={(v) => patch("attendance", v)} />
          <FieldArea label="Textbooks" value={syllabus.textbooks} onChange={(v) => patch("textbooks", v)} />
          <FieldArea label="Office hours" value={syllabus.officeHours} onChange={(v) => patch("officeHours", v)} />

          <div className="mt-6">
            <label className="block text-xs text-[hsl(var(--muted-foreground))]">
              Class (optional — link this syllabus to a Class)
            </label>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
            >
              <option value="">(none)</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {syllabus.schedule.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium">Schedule</h3>
              <ul className="mt-2 space-y-1 text-xs text-[hsl(var(--muted-foreground))]">
                {syllabus.schedule.map((s, i) => (
                  <li key={i}>
                    {s.date ?? "?"} — {s.topic ?? "?"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save to Notion"}
            </button>
            <button
              type="button"
              onClick={() => setSyllabus(null)}
              className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm"
            >
              Start over
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-[hsl(var(--muted-foreground))]">{label}</label>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
      />
    </div>
  );
}

function FieldArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="mt-4">
      <label className="block text-xs text-[hsl(var(--muted-foreground))]">{label}</label>
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        rows={3}
        className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
      />
    </div>
  );
}
