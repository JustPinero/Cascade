/**
 * Phase 17 — produce the user's LOCAL date as YYYY-MM-DD. Extracted
 * from the dashboard so it has a unit test (it's load-bearing for
 * the TZ fix shipped in Phase 14.1 / 15).
 *
 * `Intl` with the en-CA locale is the canonical way to get
 * YYYY-MM-DD across browsers and avoids the toLocaleDateString
 * quirks that include extra punctuation. No `timeZone` option means
 * the runtime's local TZ is used — exactly what we want for the
 * dashboard (browser-side). For server-side calls or explicit TZ,
 * pass `timeZone` via options.
 */
export function localToday(options: { timeZone?: string } = {}): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(new Date());
}
