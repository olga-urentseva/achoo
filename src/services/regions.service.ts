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

/**
 * The nearest regions to a coordinate, within `radiusKm`, each carrying its
 * rolling-window status — INCLUDING regions with no reports (reportCount 0,
 * color null). This is what the map uses to plot the major cities around a
 * picked location: reported ones in their severity colour, the rest in grey.
 * Returns distinct region anchors only (suburbs roll up into their metro), so
 * Vancouver's neighbours are other metros, never its own suburbs.
 */
export async function getNearbyRegions(
  lat: number,
  lng: number,
  radiusKm: number,
  limit: number,
  date?: string,
): Promise<RegionStatus[]> {
  const { since, end } = windowRange(date);

  // Haversine in SQL; clamp the acos argument to [-1, 1] against float drift.
  const distanceKm = sql<number>`6371 * acos(least(1, greatest(-1,
    cos(radians(${lat})) * cos(radians(${regions.lat}))
      * cos(radians(${regions.lng}) - radians(${lng}))
    + sin(radians(${lat})) * sin(radians(${regions.lat}))
  )))`;

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
    .from(regions)
    .leftJoin(
      submissions,
      and(
        eq(submissions.regionId, regions.id),
        gte(submissions.reportedOn, since),
        lte(submissions.reportedOn, end),
      ),
    )
    .where(sql`${distanceKm} <= ${radiusKm}`)
    .groupBy(regions.id)
    .orderBy(distanceKm)
    .limit(limit);

  return rows.map((r) => {
    const count = Number(r.count);
    const avg = count > 0 ? Number(r.avg) : 0;
    return {
      regionId: r.regionId,
      name: r.name,
      admin1: r.admin1,
      country: r.country,
      lat: r.lat,
      lng: r.lng,
      date: end,
      reportCount: count,
      avgSeverity: avg,
      color: count > 0 ? severityColor(avg) : null,
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
