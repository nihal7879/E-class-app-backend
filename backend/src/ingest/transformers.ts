/**
 * Shared field-level parsers. Source-agnostic.
 *
 * Excel quirks this handles:
 *   - "2/26/26"   → "2026-02-26"   (M/D/YY American with 2-digit year)
 *   - "12:23:04"  → "12:23:04"     (validated, stored as TIME — used for both wall-clock and duration)
 *   - "0:04:19"   → "00:04:19"     (canonicalized to HH:MM:SS for MySQL TIME)
 *   - "66.67"     → 66.67          (numeric strings)
 *   - ""          → null           (empty cells)
 *
 * parseTimeToMs is kept around for the frontend / API consumers that want a numeric duration.
 * The DB itself stores the raw string via normalizeTime.
 */

export function nullIfEmpty(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function toInt(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function toFloat(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : fallback;
}

/**
 * "M/D/YY" or "M/D/YYYY" → "YYYY-MM-DD".
 * 2-digit year: 00-69 = 20xx, 70-99 = 19xx (rarely needed here but standard).
 * Returns null for blank or unparseable input.
 */
export function parseDate(v: unknown): string | null {
  const s = nullIfEmpty(v);
  if (!s) return null;

  // already ISO? e.g. "2026-02-26"
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;

  // M/D/YY[YY]
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    let yy = Number(m[3]);
    if (m[3].length === 2) {
      yy = yy <= 69 ? 2000 + yy : 1900 + yy;
    }
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${yy.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
  }

  return null;
}

/**
 * Validates "H:MM:SS" / "HH:MM:SS" / "H:MM" and returns the canonical "HH:MM:SS" string
 * that MySQL TIME columns accept directly. Works for both wall-clock and durations.
 *
 * Also accepts numeric input as milliseconds since midnight (LoginHistory_VideoUsage.json
 * encodes LoginTime/LogoutTime/SessionTime this way — e.g. 40808000 → "11:20:08").
 *
 * Returns null for blank or unparseable input — caller decides whether to skip the row.
 */
export function normalizeTime(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return msToHms(v);
  }
  const s = nullIfEmpty(v);
  if (!s) return null;

  // pure-number string ("40808000") → treat as ms since midnight
  if (/^\d+$/.test(s)) {
    return msToHms(Number(s));
  }

  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    const se = Number(m[3]);
    if (mi >= 60 || se >= 60) return null;
    return `${pad(h)}:${pad(mi)}:${pad(se)}`;
  }

  const m2 = /^(\d+):(\d{1,2})$/.exec(s);
  if (m2) {
    const h = Number(m2[1]);
    const mi = Number(m2[2]);
    if (mi >= 60) return null;
    return `${pad(h)}:${pad(mi)}:00`;
  }

  return null;
}

function msToHms(ms: number): string {
  let total = Math.floor(ms / 1000);
  const se = total % 60;
  total = Math.floor(total / 60);
  const mi = total % 60;
  const h = Math.floor(total / 60);
  return `${pad(h)}:${pad(mi)}:${pad(se)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * "H:MM:SS" or "HH:MM:SS" → milliseconds.
 * Kept for callers that need a numeric duration (e.g. frontend display helpers).
 * The DB layer no longer uses this — it stores the raw string via normalizeTime.
 * Returns null for blank or unparseable input.
 */
export function parseTimeToMs(v: unknown): number | null {
  const s = nullIfEmpty(v);
  if (!s) return null;

  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    const se = Number(m[3]);
    if (mi >= 60 || se >= 60) return null;
    return ((h * 60 + mi) * 60 + se) * 1000;
  }

  // "HH:MM" without seconds
  const m2 = /^(\d+):(\d{1,2})$/.exec(s);
  if (m2) {
    const h = Number(m2[1]);
    const mi = Number(m2[2]);
    if (mi >= 60) return null;
    return (h * 60 + mi) * 60 * 1000;
  }

  return null;
}
