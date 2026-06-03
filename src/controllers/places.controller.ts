import type { Context } from "hono";
import { validated } from "../lib/validated.js";
import type { PlaceSearchQuery } from "../schemas.js";
import * as placesService from "../services/places.service.js";

export async function searchPlaces(c: Context) {
  const { q, limit } = validated<PlaceSearchQuery>(c, "query");
  return c.json(await placesService.searchPlaces(q, limit));
}
