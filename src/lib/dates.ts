/** Returns a `YYYY-MM-DD` string for `daysAgo` days before now (UTC). */
export function isoDate(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}
