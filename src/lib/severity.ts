/**
 * Maps an average severity (1–6 scale) to a region status color.
 * Thresholds live here only — the API responses, the map, and any future
 * client share this single definition.
 */
export const SEVERITY_COLORS = ["green", "yellow", "red", "purple"] as const;

export type SeverityColor = (typeof SEVERITY_COLORS)[number];

export function severityColor(avg: number | null): SeverityColor | null {
  if (avg === null || Number.isNaN(avg)) return null;
  if (avg >= 5.0) return "purple"; // extreme — "don't go outside"
  if (avg >= 3.5) return "red";
  if (avg >= 2.0) return "yellow";
  return "green";
}
