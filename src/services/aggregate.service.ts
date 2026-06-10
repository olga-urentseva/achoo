import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dailyAggregates } from "../db/schema.js";

/**
 * Fold one report's severity into the (region, family, day) rollup. Because the
 * aggregate stores `severity_sum` + `report_count` (not an average), this is a
 * single atomic upsert — no raw rows to scan or recompute. The picked plants
 * that resolved to this family are never stored.
 */
export async function bumpAggregate(
  regionId: number,
  familyId: string,
  day: string,
  severity: number,
): Promise<void> {
  await db
    .insert(dailyAggregates)
    .values({
      regionId,
      familyId,
      date: day,
      severitySum: severity,
      reportCount: 1,
    })
    .onConflictDoUpdate({
      target: [
        dailyAggregates.regionId,
        dailyAggregates.familyId,
        dailyAggregates.date,
      ],
      set: {
        severitySum: sql`${dailyAggregates.severitySum} + ${severity}`,
        reportCount: sql`${dailyAggregates.reportCount} + 1`,
      },
    });
}
