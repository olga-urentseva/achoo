import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { allergens, places, submissions, UNKNOWN_FAMILY } from "../db/schema.js";
import { NotFoundError } from "../lib/errors.js";
import type { CreateSubmissionInput } from "../schemas.js";
import { bumpAggregate } from "./aggregate.service.js";

/**
 * Store one anonymous report. Privacy-first: the picked plants are resolved to
 * their distinct home families and folded into the daily rollups, then thrown
 * away — only the region, severity and date are persisted (in `submissions`).
 * An `unknown` report counts toward the `unknown` family bucket instead.
 */
export async function createSubmission(input: CreateSubmissionInput) {
  const [place] = await db
    .select({ regionId: places.regionId })
    .from(places)
    .where(eq(places.id, input.placeId));
  if (!place) throw new NotFoundError("unknown place");

  // Map the picked plants to their distinct home families. Reports are about
  // pollen only, so we match plant rows (those with a pollen `type`) — a food or
  // animal id can never resolve to a family. The plants are used only here and
  // are never written to the database.
  let families: string[];
  if (input.unknown) {
    families = [UNKNOWN_FAMILY];
  } else {
    const rows = await db
      .select({ familyId: allergens.familyId })
      .from(allergens)
      .where(
        and(inArray(allergens.id, input.plants), isNotNull(allergens.type)),
      );
    families = [
      ...new Set(
        rows.map((r) => r.familyId).filter((f): f is string => f !== null),
      ),
    ];
    if (families.length === 0) throw new NotFoundError("unknown plant");
  }

  const [submission] = await db
    .insert(submissions)
    .values({
      regionId: place.regionId,
      severity: input.severity,
      unknown: input.unknown ?? false,
    })
    .returning();
  if (!submission) throw new Error("failed to insert submission");

  // One vote per distinct family — birch + oak (both fagales) count once.
  for (const familyId of families) {
    await bumpAggregate(
      submission.regionId,
      familyId,
      submission.reportedOn,
      input.severity,
    );
  }

  return submission;
}
