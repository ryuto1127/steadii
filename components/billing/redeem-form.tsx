"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RedeemForm() {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<
    { tone: "ok" | "err"; text: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setMessage({
          tone: "err",
          text: (body?.message as string) || "Redemption failed.",
        });
      } else {
        setMessage({
          tone: "ok",
          text: `Applied ${body.type} · active until ${new Date(
            body.effectiveUntil
          ).toLocaleDateString()}`,
        });
        setCode("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="STEADII-F-XXXX-XXXX-XXXX"
        className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm font-mono tracking-tight"
      />
      <button
        type="submit"
        disabled={busy || !code.trim()}
        className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
      >
        {busy ? "…" : "Redeem"}
      </button>
      {message && (
        <p
          className={`mt-2 text-xs ${
            message.tone === "ok"
              ? "text-[hsl(var(--muted-foreground))]"
              : "text-[hsl(var(--destructive))]"
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
