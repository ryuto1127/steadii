// engineer-56 — pure function for empirical working-window inference
// from a list of accepted-slot HH:MM samples. Extracted from
// `preferences.ts` so unit tests can import it without dragging in the
// `server-only` + DB-client + env-validation chain.
//
// Math: filter valid HH:MM strings, compute [min, max] in minutes,
// apply a 30-minute tolerance buffer on both ends, clamp to [00:00,
// 23:59]. Returns null when fewer than MIN_SAMPLES_TO_INFER valid
// samples exist (α scale: 3 samples is enough to start trusting a
// pattern; below that, we use the norm default).

export type InferredWorkingHoursLocal = {
  start: string;
  end: string;
  sampleCount: number;
};

export const MAX_ACCEPTED_SLOT_SAMPLES = 20;
export const MIN_SAMPLES_TO_INFER = 3;
export const EMPIRICAL_WINDOW_BUFFER_MIN = 30;

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidHhmmString(value: unknown): value is string {
  return typeof value === "string" && HHMM_RE.test(value);
}

export function hhmmToMinutes(hhmm: string): number {
  const m = HHMM_RE.exec(hhmm);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function computeInferredWindow(
  samples: readonly string[]
): InferredWorkingHoursLocal | null {
  const valid = samples.filter(isValidHhmmString);
  if (valid.length < MIN_SAMPLES_TO_INFER) return null;
  let minMin = Number.POSITIVE_INFINITY;
  let maxMin = Number.NEGATIVE_INFINITY;
  for (const s of valid) {
    const m = hhmmToMinutes(s);
    if (Number.isNaN(m)) continue;
    if (m < minMin) minMin = m;
    if (m > maxMin) maxMin = m;
  }
  if (!Number.isFinite(minMin) || !Number.isFinite(maxMin)) return null;
  const startMin = Math.max(0, minMin - EMPIRICAL_WINDOW_BUFFER_MIN);
  const endMin = Math.min(23 * 60 + 59, maxMin + EMPIRICAL_WINDOW_BUFFER_MIN);
  if (!(startMin < endMin)) return null;
  return {
    start: minutesToHhmm(startMin),
    end: minutesToHhmm(endMin),
    sampleCount: samples.length,
  };
}

function minutesToHhmm(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
}
