/**
 * Maps an average severity (1–6 scale) to a region status color.
 * Thresholds live here only — the API responses, the map, and any future
 * client share this single definition.
 */
export const SEVERITY_COLORS = ["green", "yellow", "red", "purple"] as const;

export type SeverityColor = (typeof SEVERITY_COLORS)[number];

/**
 * Suppression floor: never expose a family's number for a region/window with
 * fewer than this many reports. Set to 1 — every report counts — because the
 * client never displays the report count, so a single-report family can't be
 * recognized as one person (it reads the same as forty). The remaining guard is
 * that reports carry no identity.
 */
export const MIN_REPORTS = 1;

/**
 * How many days the "current signal" pools over — used by both the map
 * (`/regions/status`) and the per-family panel. A short rolling window (vs a
 * single day) smooths day-to-day noise and keeps a report you just filed
 * counting for a couple of days. Allergy severity is persistent over a few days,
 * so this trades a little freshness for a steadier, fuller signal.
 */
export const WINDOW_DAYS = 3;

export function severityColor(avg: number | null): SeverityColor | null {
  if (avg === null || Number.isNaN(avg)) return null;
  if (avg >= 5.0) return "purple"; // extreme — "don't go outside"
  if (avg >= 3.5) return "red";
  if (avg >= 2.0) return "yellow";
  return "green";
}
