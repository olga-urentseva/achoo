import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dailyAggregates, reports, type Allergen } from "../db/schema.js";

/**
 * Recompute the rollup for one (region, allergen, day) bucket from the raw
 * reports and upsert it. Always correct — at this scale recomputing the
 * single touched bucket on each insert is cheap and avoids drift.
 */
export async function refreshAggregate(
  regionId: number,
  allergen: Allergen,
  day: string,
): Promise<void> {
  const [agg] = await db
    .select({
      avg: sql<string>`avg(${reports.severity})`,
      count: sql<string>`count(*)`,
    })
    .from(reports)
    .where(
      and(
        eq(reports.regionId, regionId),
        eq(reports.allergen, allergen),
        eq(reports.reportedOn, day),
      ),
    );

  if (!agg) return;

  const avgSeverity = Number(agg.avg);
  const reportCount = Number(agg.count);

  await db
    .insert(dailyAggregates)
    .values({ regionId, allergen, date: day, avgSeverity, reportCount })
    .onConflictDoUpdate({
      target: [
        dailyAggregates.regionId,
        dailyAggregates.allergen,
        dailyAggregates.date,
      ],
      set: { avgSeverity, reportCount },
    });
}
