import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { dailyAggregates, families, regions, submissions } from "../db/schema.js";
import { isoDate } from "../lib/dates.js";
import {
  MIN_REPORTS,
  severityColor,
  type SeverityColor,
} from "../lib/severity.js";

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
 * Overall status color for every region with reports on `date` (default today).
 * One vote per report (each submission carries a single severity), so no
 * fan-out inflation. Regions with no reports that day are omitted.
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
      avg: sql<string>`avg(${submissions.severity})`,
      count: sql<string>`count(${submissions.id})`,
    })
    .from(submissions)
    .innerJoin(regions, eq(submissions.regionId, regions.id))
    .where(eq(submissions.reportedOn, day))
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

export interface RegionFamily {
  family: string;
  label: string | null;
  avgSeverity: number;
  reportCount: number;
  color: SeverityColor | null;
}

/**
 * Per-family signal for one region on `date` (default today). This is what the
 * frontend reads to tell a user "people who share your <family> report X/6
 * today". Families with fewer than `MIN_REPORTS` reports are suppressed —
 * k-anonymity plus a statistical floor.
 */
export async function getRegionFamilies(
  regionId: number,
  date?: string,
): Promise<RegionFamily[]> {
  const day = date ?? isoDate();

  const rows = await db
    .select({
      family: dailyAggregates.familyId,
      label: families.label,
      sum: dailyAggregates.severitySum,
      count: dailyAggregates.reportCount,
    })
    .from(dailyAggregates)
    .leftJoin(families, eq(dailyAggregates.familyId, families.id))
    .where(
      and(
        eq(dailyAggregates.regionId, regionId),
        eq(dailyAggregates.date, day),
        gte(dailyAggregates.reportCount, MIN_REPORTS),
      ),
    )
    .orderBy(families.sort);

  return rows.map((r) => {
    const avg = r.sum / r.count;
    return {
      family: r.family,
      label: r.label,
      avgSeverity: avg,
      reportCount: r.count,
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
