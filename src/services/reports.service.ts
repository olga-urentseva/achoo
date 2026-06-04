import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { places, reports } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import type { CreateReportInput } from "../schemas.js";
import { refreshAggregate } from "./aggregate.service.js";

/**
 * Resolve the chosen place to the region it aggregates into and store one
 * anonymous report per reported allergen, then refresh each touched daily
 * rollup. Only the region, allergen, severity and date are persisted.
 */
export async function createReport(input: CreateReportInput) {
  const [place] = await db
    .select({ regionId: places.regionId })
    .from(places)
    .where(eq(places.id, input.placeId));
  if (!place) throw new NotFoundError("unknown place");

  const rows = await db
    .insert(reports)
    .values(
      input.reports.map((r) => ({
        regionId: place.regionId,
        allergen: r.allergen,
        severity: r.severity,
      })),
    )
    .returning();
  if (rows.length === 0) throw new Error("failed to insert report");

  // All rows share the same region and date; refresh each allergen bucket.
  for (const row of rows) {
    await refreshAggregate(row.regionId, row.allergen, row.reportedOn);
  }

  return rows;
}
