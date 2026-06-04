import { z } from "zod";
import { REPORT_ALLERGENS } from "./db/schema.js";

export const createReportSchema = z.object({
  // The user picks a place from the typeahead; the server resolves it to
  // the region it reports under, so clients can't post arbitrary regions.
  placeId: z.number().int().positive(),
  // A user can be reacting to several allergens at once, each at its own
  // severity (e.g. birch 5, grass 2). One submission fans out into one
  // stored report per allergen. `unknown` ("I don't know my allergens") is
  // just another value here — it may stand alone or sit alongside named ones.
  reports: z
    .array(
      z.object({
        allergen: z.enum(REPORT_ALLERGENS),
        severity: z.number().int().min(1).max(6),
      }),
    )
    .min(1)
    .max(REPORT_ALLERGENS.length)
    .refine(
      (items) => new Set(items.map((r) => r.allergen)).size === items.length,
      { message: "duplicate allergen" },
    ),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

export const placeSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type PlaceSearchQuery = z.infer<typeof placeSearchQuerySchema>;

export const statusQuerySchema = z.object({
  date: z.string().date().optional(),
});

export type StatusQuery = z.infer<typeof statusQuerySchema>;

export const nearestQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export type NearestQuery = z.infer<typeof nearestQuerySchema>;

export const trendsQuerySchema = z.object({
  allergen: z.enum(REPORT_ALLERGENS).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export type TrendsQuery = z.infer<typeof trendsQuerySchema>;
