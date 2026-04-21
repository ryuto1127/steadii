// Fire-and-forget detector that POSTs the browser's IANA timezone to
// /api/user/timezone with source="auto". The server only persists it when
// the stored value is NULL, so this can't overwrite a manual Settings
// choice. We cache the last-reported TZ in localStorage so we don't ping
// the endpoint on every chat send.

const STORAGE_KEY = "steadii:tz-last-reported";

export function reportDetectedTimezone(): void {
  if (typeof window === "undefined") return;
  let tz: string;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return;
  }
  if (!tz) return;
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === tz) return;
  } catch {
    // localStorage may be blocked (private mode, etc.) — proceed anyway,
    // the server dedupes on its end.
  }
  void fetch("/api/user/timezone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timezone: tz, source: "auto" }),
  })
    .then((res) => {
      if (res.ok) {
        try {
          window.localStorage.setItem(STORAGE_KEY, tz);
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {
      // Non-fatal: the agent falls back to UTC and the user can fix it in
      // Settings. No need to surface anything to the UI.
    });
}
