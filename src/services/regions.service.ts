import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dailyAggregates, families, regions, submissions } from "../db/schema.js";
import { isoDate } from "../lib/dates.js";
import {
  WINDOW_DAYS,
  MIN_REPORTS,
  severityColor,
  type SeverityColor,
} from "../lib/severity.js";

/** The `WINDOW_DAYS`-long date range ending on `date` (default today), as
 * `YYYY-MM-DD` bounds. Shared by the map and the per-family signal. */
function windowRange(date?: string): { since: string; end: string } {
  const end = date ?? isoDate();
  const start = new Date(`${end}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1));
  return { since: start.toISOString().slice(0, 10), end };
}

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
 * Overall status color for every region with reports over the rolling
 * `WINDOW_DAYS` window ending on `date` (default today). One vote per report
 * (each submission carries a single severity), so no fan-out inflation. Regions
 * with no reports in the window are omitted.
 */
export async function getRegionStatus(date?: string): Promise<RegionStatus[]> {
  const { since, end } = windowRange(date);

  const rows = await db
    .select({
      regionId: regions.id,
      name: regions.name,
      admin1: regions.admin1,
      country: regions.country,
      lat: regions.lat,
      lng: regions.lng,
      avg: sql<string>`avg(${submissions.severity})`,
      count: sql<string>`count(${submissions.id})`,
    })
    .from(submissions)
    .innerJoin(regions, eq(submissions.regionId, regions.id))
    .where(
      and(
        gte(submissions.reportedOn, since),
        lte(submissions.reportedOn, end),
      ),
    )
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
      date: end,
      reportCount: Number(r.count),
      avgSeverity: avg,
      color: severityColor(avg),
    };
  });
}

export interface RegionFamily {
  family: string;
  label: string | null;
  avgSeverity: number;
  reportCount: number;
  color: SeverityColor | null;
}

/**
 * Per-family signal for one region over a rolling window ending on `date`
 * (default today), `WINDOW_DAYS` long. This is what the frontend reads to
 * tell a user "people who share your <family> report X/6". Per-family daily
 * buckets are summed across the window, so a family's average is its pooled
 * severity_sum / report_count. Families below `MIN_REPORTS` over the window are
 * suppressed (currently a floor of 1, so only truly empty families drop out).
 */
export async function getRegionFamilies(
  regionId: number,
  date?: string,
): Promise<RegionFamily[]> {
  const { since, end } = windowRange(date);

  const rows = await db
    .select({
      family: dailyAggregates.familyId,
      label: families.label,
      sum: sql<string>`sum(${dailyAggregates.severitySum})`,
      count: sql<string>`sum(${dailyAggregates.reportCount})`,
    })
    .from(dailyAggregates)
    .leftJoin(families, eq(dailyAggregates.familyId, families.id))
    .where(
      and(
        eq(dailyAggregates.regionId, regionId),
        gte(dailyAggregates.date, since),
        lte(dailyAggregates.date, end),
      ),
    )
    .groupBy(dailyAggregates.familyId, families.label, families.sort)
    .having(sql`sum(${dailyAggregates.reportCount}) >= ${MIN_REPORTS}`)
    .orderBy(families.sort);

  return rows.map((r) => {
    const sum = Number(r.sum);
    const count = Number(r.count);
    const avg = sum / count;
    return {
      family: r.family,
      label: r.label,
      avgSeverity: avg,
      reportCount: count,
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
 * Daily severity trend for one region. With a `family`, reads the pre-computed
 * family rollup. Without one, the overall trend is computed from `submissions`
 * (one vote per report) so polysensitized people aren't double-counted across
 * families.
 */
export async function getRegionTrends(
  regionId: number,
  family: string | undefined,
  days: number,
): Promise<TrendPoint[]> {
  const since = isoDate(days);

  if (family) {
    const rows = await db
      .select({
        date: dailyAggregates.date,
        sum: dailyAggregates.severitySum,
        count: dailyAggregates.reportCount,
      })
      .from(dailyAggregates)
      .where(
        and(
          eq(dailyAggregates.regionId, regionId),
          eq(dailyAggregates.familyId, family),
          gte(dailyAggregates.date, since),
        ),
      )
      .orderBy(dailyAggregates.date);

    return rows.map((r) => {
      const avg = r.sum / r.count;
      return {
        date: r.date,
        avgSeverity: avg,
        reportCount: r.count,
        color: severityColor(avg),
      };
    });
  }

  const rows = await db
    .select({
      date: submissions.reportedOn,
      avg: sql<string>`avg(${submissions.severity})`,
      count: sql<string>`count(${submissions.id})`,
    })
    .from(submissions)
    .where(
      and(eq(submissions.regionId, regionId), gte(submissions.reportedOn, since)),
    )
    .groupBy(submissions.reportedOn)
    .orderBy(submissions.reportedOn);

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
