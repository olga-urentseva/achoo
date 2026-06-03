import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { places, reports } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import type { CreateReportInput } from "../schemas.js";
import { refreshAggregate } from "./aggregate.service.js";

/**
 * Resolve the chosen place to the region it aggregates into and store one
 * anonymous report, then refresh that region's daily rollup. Only the
 * region, allergen, severity and date are persisted.
 */
export async function createReport(input: CreateReportInput) {
  const [place] = await db
    .select({ regionId: places.regionId })
    .from(places)
    .where(eq(places.id, input.placeId));
  if (!place) throw new NotFoundError("unknown place");

  const [row] = await db
    .insert(reports)
    .values({
      regionId: place.regionId,
      allergen: input.allergen,
      severity: input.severity,
    })
    .returning();
  if (!row) throw new Error("failed to insert report");

  await refreshAggregate(row.regionId, row.allergen, row.reportedOn);

  return row;
}
