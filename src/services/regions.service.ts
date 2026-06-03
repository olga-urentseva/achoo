import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  dailyAggregates,
  regions,
  reports,
  type Allergen,
} from "../db/schema.js";
import { isoDate } from "../lib/dates.js";
import { severityColor, type SeverityColor } from "../lib/severity.js";

export interface RegionStatus {
  regionId: number;
  name: string;
  admin1: string;
  country: string;
  lat: number;
  lng: number;
  date: string;
  reportCount: number;
  avgSeverity: number;
  color: SeverityColor | null;
}

/**
 * Status color for every region with reports on `date` (default today),
 * including coordinates so the client can plot a dot per region on the map.
 * Regions with no reports that day are omitted.
 */
export async function getRegionStatus(date?: string): Promise<RegionStatus[]> {
  const day = date ?? isoDate();

  const rows = await db
    .select({
      regionId: regions.id,
      name: regions.name,
      admin1: regions.admin1,
      country: regions.country,
      lat: regions.lat,
      lng: regions.lng,
      avg: sql<string>`avg(${reports.severity})`,
      count: sql<string>`count(${reports.id})`,
    })
    .from(reports)
    .innerJoin(regions, eq(reports.regionId, regions.id))
    .where(eq(reports.reportedOn, day))
    .groupBy(regions.id)
    .orderBy(regions.name);

  return rows.map((r) => {
    const avg = Number(r.avg);
    return {
      regionId: r.regionId,
      name: r.name,
      admin1: r.admin1,
      country: r.country,
      lat: r.lat,
      lng: r.lng,
      date: day,
      reportCount: Number(r.count),
      avgSeverity: avg,
      color: severityColor(avg),
    };
  });
}

export interface TrendPoint {
  date: string;
  avgSeverity: number;
  reportCount: number;
  color: SeverityColor | null;
}

/**
 * Daily severity trend for one region from the pre-computed aggregates.
 * Without `allergen`, all allergens are combined via a count-weighted average.
 */
export async function getRegionTrends(
  regionId: number,
  allergen: Allergen | undefined,
  days: number,
): Promise<TrendPoint[]> {
  const since = isoDate(days);

  const rows = allergen
    ? await db
        .select({
          date: dailyAggregates.date,
          avg: dailyAggregates.avgSeverity,
          count: dailyAggregates.reportCount,
        })
        .from(dailyAggregates)
        .where(
          and(
            eq(dailyAggregates.regionId, regionId),
            eq(dailyAggregates.allergen, allergen),
            gte(dailyAggregates.date, since),
          ),
        )
        .orderBy(dailyAggregates.date)
    : await db
        .select({
          date: dailyAggregates.date,
          avg: sql<string>`sum(${dailyAggregates.avgSeverity} * ${dailyAggregates.reportCount}) / sum(${dailyAggregates.reportCount})`,
          count: sql<string>`sum(${dailyAggregates.reportCount})`,
        })
        .from(dailyAggregates)
        .where(
          and(
            eq(dailyAggregates.regionId, regionId),
            gte(dailyAggregates.date, since),
          ),
        )
        .groupBy(dailyAggregates.date)
        .orderBy(dailyAggregates.date);

  return rows.map((r) => {
    const avg = Number(r.avg);
    return {
      date: r.date,
      avgSeverity: avg,
      reportCount: Number(r.count),
      color: severityColor(avg),
    };
  });
}
