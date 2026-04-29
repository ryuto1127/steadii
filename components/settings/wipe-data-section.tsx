"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { prettyBytes } from "@/lib/format/bytes";

type WipeCounts = {
  classes: number;
  syllabi: number;
  mistakes: number;
  assignments: number;
  chats: number;
  messages: number;
  inbox: number;
  proposals: number;
  integrations: number;
  blobs: number;
  blobBytes: number;
};

const REQUIRED_PHRASE = "DELETE";

export function WipeDataSection() {
  const tDanger = useTranslations("settings.danger_zone");
  const tModal = useTranslations("settings.danger_zone.wipe_modal");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<WipeCounts | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setCounts(null);
      setConfirm("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/wipe-counts");
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as WipeCounts;
        if (!cancelled) setCounts(data);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : tModal("load_failed")
        );
        if (!cancelled) setOpen(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tModal]);

  async function submit() {
    if (confirm !== REQUIRED_PHRASE) return;
    setBusy(true);
    try {
      const res = await fetch("/api/settings/wipe-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: REQUIRED_PHRASE }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(tModal("success_toast"));
      setOpen(false);
      router.push("/app");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tModal("wipe_failed"));
      setBusy(false);
    }
  }

  return (
    <>
      <p className="mb-2 text-small text-[hsl(var(--muted-foreground))]">
        {tDanger("account_placeholder")}
      </p>
      <p className="mb-3 text-small text-[hsl(var(--muted-foreground))]">
        {tDanger("wipe_data_description")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled
          className="inline-flex h-9 items-center rounded-md border border-[hsl(var(--border))] px-3 text-small text-[hsl(var(--muted-foreground))] opacity-60"
        >
          {tDanger("account_button")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center rounded-md border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--destructive)/0.06)] px-3 text-small font-medium text-[hsl(var(--destructive))] transition-hover hover:bg-[hsl(var(--destructive)/0.12)]"
        >
          {tDanger("wipe_data_button")}
        </button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 shadow-xl">
            <h2 className="text-h3 text-[hsl(var(--foreground))]">
              {tModal("title")}
            </h2>
            <p className="mt-3 text-small text-[hsl(var(--foreground))]">
              {tModal("list_header")}
            </p>
            {counts ? (
              <ul className="mt-2 space-y-1 text-small text-[hsl(var(--muted-foreground))]">
                <BulletItem
                  text={tModal("list_classes").replace(
                    "{count}",
                    String(counts.classes)
                  )}
                />
                <BulletItem
                  text={tModal("list_syllabi").replace(
                    "{count}",
                    String(counts.syllabi)
                  )}
                />
                <BulletItem
                  text={tModal("list_mistakes").replace(
                    "{count}",
                    String(counts.mistakes)
                  )}
                />
                <BulletItem
                  text={tModal("list_assignments").replace(
                    "{count}",
                    String(counts.assignments)
                  )}
                />
                <BulletItem
                  text={tModal("list_chats")
                    .replace("{count}", String(counts.chats))
                    .replace("{messages}", String(counts.messages))}
                />
                <BulletItem
                  text={tModal("list_inbox").replace(
                    "{count}",
                    String(counts.inbox)
                  )}
                />
                <BulletItem
                  text={tModal("list_proposals").replace(
                    "{count}",
                    String(counts.proposals)
                  )}
                />
                <BulletItem
                  text={tModal("list_integrations").replace(
                    "{count}",
                    String(counts.integrations)
                  )}
                />
                <BulletItem
                  text={tModal("list_blobs")
                    .replace("{count}", String(counts.blobs))
                    .replace("{size}", prettyBytes(counts.blobBytes))}
                />
              </ul>
            ) : (
              <ul className="mt-2 space-y-1 text-small text-[hsl(var(--muted-foreground))]">
                {Array.from({ length: 9 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[hsl(var(--muted-foreground)/0.3)]" />
                    <span className="h-3 w-40 animate-pulse rounded bg-[hsl(var(--surface-raised))]" />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-small text-[hsl(var(--muted-foreground))]">
              {tModal("stays_note")}
            </p>
            <p className="mt-1 text-small font-medium text-[hsl(var(--destructive))]">
              {tModal("irreversible")}
            </p>
            <label className="mt-4 block text-xs text-[hsl(var(--muted-foreground))]">
              {tModal("type_to_confirm")}
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={tModal("type_to_confirm_placeholder")}
                disabled={busy}
                autoFocus
                className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 font-mono text-sm"
              />
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="inline-flex h-9 items-center rounded-md px-3 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
              >
                {tModal("cancel")}
              </button>
              <button
                type="button"
                disabled={busy || confirm !== REQUIRED_PHRASE || counts === null}
                onClick={submit}
                className="inline-flex h-9 items-center rounded-md bg-[hsl(var(--destructive))] px-4 text-small font-medium text-white transition-hover hover:opacity-90 disabled:opacity-50"
              >
                {busy ? tModal("submitting") : tModal("submit")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function BulletItem({ text }: { text: string }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="h-1.5 w-1.5 shrink-0 translate-y-1.5 rounded-full bg-[hsl(var(--muted-foreground))]" />
      <span>{text}</span>
    </li>
  );
}
