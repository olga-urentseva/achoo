import { z } from "zod";

export const createSubmissionSchema = z
  .object({
    // The user picks a place from the typeahead; the server resolves it to the
    // region it reports under, so clients can't post arbitrary regions.
    placeId: z.number().int().positive(),
    // One overall severity for the whole submission (not per allergen).
    severity: z.number().int().min(1).max(6),
    // The plants the user is allergic to. Used server-side only to work out the
    // affected families, then discarded — never stored. May be empty when
    // `unknown` is set ("I don't know which plant").
    plants: z.array(z.string().min(1)).max(64).default([]),
    unknown: z.boolean().optional(),
  })
  .refine((d) => d.unknown === true || d.plants.length > 0, {
    message: "pick at least one plant or set unknown",
  });

export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

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
  family: z.string().min(1).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export type TrendsQuery = z.infer<typeof trendsQuerySchema>;
