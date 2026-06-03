import { z } from "zod";
import { ALLERGENS } from "./db/schema.js";

export const createReportSchema = z.object({
  // The user picks a place from the typeahead; the server resolves it to
  // the region it reports under, so clients can't post arbitrary regions.
  placeId: z.number().int().positive(),
  allergen: z.enum(ALLERGENS),
  severity: z.number().int().min(1).max(6),
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

export const trendsQuerySchema = z.object({
  allergen: z.enum(ALLERGENS).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export type TrendsQuery = z.infer<typeof trendsQuerySchema>;
